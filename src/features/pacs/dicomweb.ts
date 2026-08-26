/**
 * DICOMweb 客户端（FR-13.2 连接测试 / FR-13.3 QIDO-RS 查询 / FR-13.4 WADO-RS 拉取）。
 *
 * - 网络层全部走可注入 fetch（DicomwebFetch），单测以假实现断言调用链；
 * - 统一错误类型 DicomwebError（network/http/timeout/parse/auth/cancelled）；
 * - 每请求独立超时（AbortController + 计时器），外部取消信号可中止整次拉取；
 * - WADO-RS 取像素使用 `Accept: application/dicom`（单部分原始字节，
 *   避免 multipart/related 解析）。
 *
 * TODO(FR-13.3, P1)：结果分页展示（current/totalMatches）；
 * TODO(FR-13.4, P1)：超大检查按序列分批拉取与帧懒加载；
 * TODO(FR-13.2/13.3/13.4, P2)：传统 DICOM 网关 C-ECHO/C-FIND/C-MOVE 桥接。
 */
import {
  buildInstanceRetrieveUrl,
  buildSeriesInstancesUrl,
  buildStudySeriesUrl,
  buildStudiesUrl,
  type PacsServerConfig,
} from './config';

// ── 可注入网络层 ────────────────────────────────────────────────────
export interface DicomwebResponseLike {
  ok: boolean;
  status: number;
  statusText?: string;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

export interface DicomwebRequestInit {
  method?: 'GET';
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export type DicomwebFetch = (url: string, init: DicomwebRequestInit) => Promise<DicomwebResponseLike>;

/** 默认实现：包装全局 fetch（浏览器运行时注入） */
export const defaultDicomwebFetch: DicomwebFetch = (url, init) =>
  globalThis.fetch(url, {
    method: init.method ?? 'GET',
    headers: init.headers,
    signal: init.signal,
  });

export type DicomwebErrorKind =
  | 'network' // 网络层失败（DNS/连接拒绝/断网）
  | 'http' // 非 2xx 响应
  | 'timeout' // 超时
  | 'parse' // 响应内容无法解析（非 JSON / 非 DICOM 字节）
  | 'auth' // 401/403
  | 'cancelled'; // 用户取消

export class DicomwebError extends Error {
  readonly kind: DicomwebErrorKind;
  readonly status?: number;

  constructor(message: string, kind: DicomwebErrorKind, status?: number) {
    super(message);
    this.name = 'DicomwebError';
    this.kind = kind;
    this.status = status;
  }
}

function authHeaders(config: PacsServerConfig): Record<string, string> {
  const headers: Record<string, string> = {};
  if (config.authHeaderName !== '' && config.authHeaderValue !== '') {
    headers[config.authHeaderName] = config.authHeaderValue;
  }
  return headers;
}

/**
 * 带超时与外部取消的请求封装。
 * 超时/外部取消统一抛 DicomwebError（kind 区分），调用方按 kind 分支处理。
 */
async function requestWithTimeout(
  config: PacsServerConfig,
  url: string,
  fetchImpl: DicomwebFetch,
  externalSignal?: AbortSignal,
): Promise<DicomwebResponseLike> {
  if (externalSignal?.aborted) {
    throw new DicomwebError('操作已取消', 'cancelled');
  }
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.timeoutMs);
  const onExternalAbort = (): void => {
    controller.abort();
  };
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
  try {
    return await fetchImpl(url, {
      method: 'GET',
      headers: authHeaders(config),
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) {
      throw new DicomwebError(`请求超时（${config.timeoutMs} 毫秒）`, 'timeout');
    }
    if (externalSignal?.aborted) {
      throw new DicomwebError('操作已取消', 'cancelled');
    }
    throw new DicomwebError(
      error instanceof Error ? `网络请求失败：${error.message}` : '网络请求失败',
      'network',
    );
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

function errorMessageOf(error: unknown): string {
  if (error instanceof DicomwebError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

async function toDicomJson(
  config: PacsServerConfig,
  url: string,
  fetchImpl: DicomwebFetch,
  externalSignal?: AbortSignal,
): Promise<Record<string, unknown>[]> {
  const response = await requestWithTimeout(config, url, fetchImpl, externalSignal);
  if (response.status === 401 || response.status === 403) {
    throw new DicomwebError(`认证失败（HTTP ${response.status}），请检查认证头配置`, 'auth', response.status);
  }
  if (!response.ok) {
    throw new DicomwebError(
      `服务器返回 HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
      'http',
      response.status,
    );
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new DicomwebError('响应不是合法的 DICOMweb JSON', 'parse');
  }
  if (!Array.isArray(data)) {
    throw new DicomwebError('响应结构异常（期望 JSON 数组）', 'parse');
  }
  return data as Record<string, unknown>[];
}

// ── dicom+json 标签取值（PS3.18 资源端 JSON 模型） ─────────────────
interface DicomJsonObject {
  Value?: unknown;
}

function tagRaw(object: Record<string, unknown>, tag: string): unknown {
  const entry = object[tag];
  if (entry !== null && typeof entry === 'object') {
    return (entry as DicomJsonObject).Value;
  }
  return undefined;
}

/** 取标签首个字符串值（UI/CS/SH/DS 等单值或首值场景） */
function firstString(object: Record<string, unknown>, tag: string): string | undefined {
  const value = tagRaw(object, tag);
  if (typeof value === 'string' && value !== '') {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0] !== '') {
    return value[0];
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

/** 取标签全部字符串值（Modality 等多值 CS） */
function allStrings(object: Record<string, unknown>, tag: string): string[] {
  const value = tagRaw(object, tag);
  if (typeof value === 'string' && value !== '') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item !== '');
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return [String(value)];
  }
  return [];
}

function firstNumber(object: Record<string, unknown>, tag: string): number | undefined {
  const raw = firstString(object, tag);
  if (raw === undefined) {
    return undefined;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

// ── 查询结果模型 ────────────────────────────────────────────────────
export interface QidoSeriesInfo {
  seriesUid: string;
  modality: string | undefined;
  description: string | undefined;
  seriesNumber: number | undefined;
}

export interface QidoStudyInfo {
  studyUid: string;
  studyDate: string | undefined;
  studyDescription: string | undefined;
  patientId: string | undefined;
  patientName: string | undefined;
  modalities: string[];
  series: QidoSeriesInfo[];
}

function parseSeries(object: Record<string, unknown>): QidoSeriesInfo | undefined {
  const seriesUid = firstString(object, '0020000e');
  if (seriesUid === undefined) {
    return undefined;
  }
  return {
    seriesUid,
    modality: firstString(object, '00080060'),
    description: firstString(object, '0008103e'),
    seriesNumber: firstNumber(object, '00200011'),
  };
}

function parseStudy(object: Record<string, unknown>): QidoStudyInfo | undefined {
  const studyUid = firstString(object, '0020000d');
  if (studyUid === undefined) {
    return undefined;
  }
  const nestedSeries = object['Series'];
  const series: QidoSeriesInfo[] = [];
  if (Array.isArray(nestedSeries)) {
    for (const item of nestedSeries) {
      if (item !== null && typeof item === 'object') {
        const parsed = parseSeries(item as Record<string, unknown>);
        if (parsed !== undefined) {
          series.push(parsed);
        }
      }
    }
  }
  return {
    studyUid,
    studyDate: firstString(object, '00080020'),
    studyDescription: firstString(object, '00081030'),
    patientId: firstString(object, '00100020'),
    patientName: firstString(object, '00100010'),
    modalities: allStrings(object, '00080061'),
    series,
  };
}

// ── FR-13.2 连接测试 ────────────────────────────────────────────────
/**
 * 连通性探测：空 QIDO 检查查询（limit=1 + StudyInstanceUID 通配，
 * 兼容 dcm4chee 要求至少一个查询参数的约束）。
 * 成功返回中文提示；失败抛 DicomwebError（kind 区分原因）。
 */
export async function testConnection(
  config: PacsServerConfig,
  fetchImpl: DicomwebFetch = defaultDicomwebFetch,
): Promise<{ message: string }> {
  const url = `${buildStudiesUrl(config)}?limit=1&StudyInstanceUID=${encodeURIComponent('*')}`;
  await toDicomJson(config, url, fetchImpl);
  return { message: '连接成功' };
}

// ── FR-13.3 检索查询 ────────────────────────────────────────────────
export interface PacsQueryCriteria {
  patientName?: string;
  patientId?: string;
  /** YYYYMMDD */
  studyDateFrom?: string;
  /** YYYYMMDD */
  studyDateTo?: string;
  modality?: string;
  studyDescription?: string;
}

const QIDO_LIMIT = 200;

/** 查询条件 → QIDO-RS 查询串（仅包含非空条件） */
export function buildQidoQuery(criteria: PacsQueryCriteria): string {
  const params = new URLSearchParams();
  params.set('limit', String(QIDO_LIMIT));
  if (criteria.patientName) {
    params.set('PatientName', criteria.patientName);
  }
  if (criteria.patientId) {
    params.set('PatientID', criteria.patientId);
  }
  if (criteria.studyDateFrom) {
    params.set('StudyDate', `>=${criteria.studyDateFrom}`);
  }
  if (criteria.studyDateTo) {
    params.set('StudyDate', `<=${criteria.studyDateTo}`);
  }
  if (criteria.modality) {
    params.set('Modality', criteria.modality);
  }
  if (criteria.studyDescription) {
    params.set('StudyDescription', criteria.studyDescription);
  }
  return params.toString();
}

/** QIDO-RS 检查级查询（FR-13.3）；返回检查列表（含序列概要） */
export async function queryStudies(
  config: PacsServerConfig,
  criteria: PacsQueryCriteria = {},
  fetchImpl: DicomwebFetch = defaultDicomwebFetch,
  signal?: AbortSignal,
): Promise<QidoStudyInfo[]> {
  const query = buildQidoQuery(criteria);
  const url = `${buildStudiesUrl(config)}?${query}`;
  const objects = await toDicomJson(config, url, fetchImpl, signal);
  return objects
    .map((object) => parseStudy(object))
    .filter((study): study is QidoStudyInfo => study !== undefined);
}

/** QIDO-RS 指定检查的序列列表 */
export async function queryStudySeries(
  config: PacsServerConfig,
  studyUid: string,
  fetchImpl: DicomwebFetch = defaultDicomwebFetch,
  signal?: AbortSignal,
): Promise<QidoSeriesInfo[]> {
  const url = `${buildStudySeriesUrl(config, studyUid)}?limit=${QIDO_LIMIT}`;
  const objects = await toDicomJson(config, url, fetchImpl, signal);
  return objects
    .map((object) => parseSeries(object))
    .filter((series): series is QidoSeriesInfo => series !== undefined);
}

/** QIDO-RS 指定序列的实例列表（仅 SOPInstanceUID） */
export async function querySeriesInstances(
  config: PacsServerConfig,
  studyUid: string,
  seriesUid: string,
  fetchImpl: DicomwebFetch = defaultDicomwebFetch,
  signal?: AbortSignal,
): Promise<string[]> {
  const url = `${buildSeriesInstancesUrl(config, studyUid, seriesUid)}?limit=${QIDO_LIMIT * 10}`;
  const objects = await toDicomJson(config, url, fetchImpl, signal);
  const uids: string[] = [];
  for (const object of objects) {
    const uid = firstString(object, '00080018');
    if (uid !== undefined) {
      uids.push(uid);
    }
  }
  return uids;
}

// ── FR-13.4 拉取 ────────────────────────────────────────────────────
/** 校验响应字节为 DICOM Part-10（防服务器把错误页/HTML 当像素返回） */
function assertDicomBytes(buffer: ArrayBuffer): void {
  if (buffer.byteLength < 132) {
    throw new DicomwebError('拉取内容不是有效的 DICOM 文件（长度不足）', 'parse');
  }
  const magic = new Uint8Array(buffer, 128, 4);
  const isDicm =
    magic[0] === 0x44 && magic[1] === 0x49 && magic[2] === 0x43 && magic[3] === 0x4d;
  if (!isDicm) {
    throw new DicomwebError('拉取内容不是有效的 DICOM Part-10 文件（服务器可能返回了错误页）', 'parse');
  }
}

/** WADO-RS 取单实例像素（Accept: application/dicom → 原始 Part-10 字节） */
export async function retrieveInstanceBytes(
  config: PacsServerConfig,
  studyUid: string,
  seriesUid: string,
  sopInstanceUid: string,
  fetchImpl: DicomwebFetch = defaultDicomwebFetch,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const url = buildInstanceRetrieveUrl(config, studyUid, seriesUid, sopInstanceUid);
  const response = await requestWithTimeout(config, url, fetchImpl, signal);
  if (response.status === 401 || response.status === 403) {
    throw new DicomwebError(`认证失败（HTTP ${response.status}），请检查认证头配置`, 'auth', response.status);
  }
  if (!response.ok) {
    throw new DicomwebError(
      `服务器返回 HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
      'http',
      response.status,
    );
  }
  const buffer = await response.arrayBuffer();
  assertDicomBytes(buffer);
  return buffer;
}

export interface FetchedDicomInstance {
  seriesUid: string;
  sopUid: string;
  buffer: ArrayBuffer;
}

export interface RetrieveFailure {
  sopUid: string;
  message: string;
}

export interface RetrieveStudyOptions {
  /** 每取完一个实例回调一次：done = 已处理数，total = 实例总数 */
  onProgress?: (done: number, total: number) => void;
  /** 外部取消信号：abort 后停止后续拉取，cancelled=true 返回已完成部分 */
  signal?: AbortSignal;
  fetchImpl?: DicomwebFetch;
}

export interface RetrieveStudyResult {
  instances: FetchedDicomInstance[];
  failures: RetrieveFailure[];
  cancelled: boolean;
}

/**
 * 拉取整个检查（FR-13.4 P0）：
 * QIDO 序列 → 逐序列 QIDO 实例 → 逐实例 WADO-RS 取像素。
 * 单实例失败不中断整检查（记入 failures）；取消返回已完成部分。
 *
 * TODO(FR-13.4, P1)：超大检查按序列分批拉取、进度持久化；
 * TODO(FR-13.5, P1)：IndexedDB 缓存（当前仅内存，受 NFR-4 约束）。
 */
export async function retrieveStudy(
  config: PacsServerConfig,
  studyUid: string,
  options: RetrieveStudyOptions = {},
): Promise<RetrieveStudyResult> {
  const { onProgress, signal } = options;
  const fetchImpl = options.fetchImpl ?? defaultDicomwebFetch;
  try {
    const seriesList = await queryStudySeries(config, studyUid, fetchImpl, signal);
    if (seriesList.length === 0) {
      throw new DicomwebError('该检查下未查询到序列', 'parse');
    }
    const planned: Array<{ seriesUid: string; sopUid: string }> = [];
    for (const series of seriesList) {
      const sopUids = await querySeriesInstances(config, studyUid, series.seriesUid, fetchImpl, signal);
      for (const sopUid of sopUids) {
        planned.push({ seriesUid: series.seriesUid, sopUid });
      }
    }
    if (planned.length === 0) {
      throw new DicomwebError('该检查下未查询到实例', 'parse');
    }

    const instances: FetchedDicomInstance[] = [];
    const failures: RetrieveFailure[] = [];
    let cancelled = false;
    for (let index = 0; index < planned.length; index++) {
      if (signal?.aborted) {
        cancelled = true;
        break;
      }
      const target = planned[index];
      if (target === undefined) {
        break;
      }
      try {
        const buffer = await retrieveInstanceBytes(
          config,
          studyUid,
          target.seriesUid,
          target.sopUid,
          fetchImpl,
          signal,
        );
        instances.push({ seriesUid: target.seriesUid, sopUid: target.sopUid, buffer });
      } catch (error) {
        if (signal?.aborted) {
          cancelled = true;
          break;
        }
        failures.push({ sopUid: target.sopUid, message: errorMessageOf(error) });
      }
      onProgress?.(index + 1, planned.length);
    }
    return { instances, failures, cancelled };
  } catch (error) {
    if (error instanceof DicomwebError && error.kind === 'cancelled') {
      return { instances: [], failures: [], cancelled: true };
    }
    throw error;
  }
}
