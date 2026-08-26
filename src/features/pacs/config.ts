/**
 * PACS 服务器配置（FR-13.1 子集：DICOMweb 多服务器配置 + 持久化 + 校验）。
 *
 * 纯逻辑 + 可注入 Storage，Node 下单测；持久化于 localStorage
 * （键 dicom-viewer.pacs.v1），读取失败/非法值一律回退默认。
 *
 * TODO(FR-13.1, P1)：传统 DICOM 网关配置（网关地址/目标 AE Title/本端 AE Title）；
 * TODO(FR-13.1, P2)：IndexedDB 持久化（当前与设置共用 localStorage 策略）。
 */
export interface PacsServerConfig {
  id: string;
  /** 显示名（FR-13.5 来源标记「所属服务器」） */
  name: string;
  /** 服务器 Base URL（http/https，如 http://pacs.local:8080） */
  baseUrl: string;
  /** QIDO-RS 检查级查询前缀（含 /studies 路径，如 Orthanc /dicomweb/studies） */
  qidoPrefix: string;
  /** WADO-RS 取像素前缀（多数服务器与 QIDO 相同） */
  wadoPrefix: string;
  /** 认证头名（空 = 不附加认证头；默认 Authorization） */
  authHeaderName: string;
  /** 认证头值（如 "Basic xxx" / "Bearer xxx"） */
  authHeaderValue: string;
  /** 单请求超时（毫秒），FR-13 错误处理与超时 */
  timeoutMs: number;
  /** 默认服务器（列表内至多一个） */
  isDefault: boolean;
}

export const PACS_STORAGE_KEY = 'dicom-viewer.pacs.v1';

export const DEFAULT_QIDO_PREFIX = '/dicomweb/studies';
export const DEFAULT_WADO_PREFIX = '/dicomweb/studies';
export const DEFAULT_PACS_TIMEOUT_MS = 30000;

const TIMEOUT_MIN_MS = 1000;
const TIMEOUT_MAX_MS = 300_000;

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function asBool(value: unknown): boolean {
  return value === true;
}

function clampTimeout(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_PACS_TIMEOUT_MS;
  return Math.min(TIMEOUT_MAX_MS, Math.max(TIMEOUT_MIN_MS, Math.round(n)));
}

/** 路径归一化：去首尾空白、保证以 / 开头、去掉尾部 /；空值回退默认前缀 */
export function normalizePrefix(raw: string, fallback: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return fallback;
  }
  const withLead = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const stripped = withLead.endsWith('/') ? withLead.slice(0, -1) : withLead;
  return stripped === '' ? fallback : stripped;
}

/** baseUrl 校验：仅接受绝对 http/https URL（FR-13.2 前置） */
export function isValidPacsBaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 混合内容提示（FR-13.9）：页面经 HTTPS 部署而服务器配置为 http:// 时，
 * 浏览器会拦截请求（Mixed Content）。返回中文提示；非该场景返回 null。
 * pageProtocol 缺省取当前页面协议（可注入，便于单测）。
 */
export function mixedContentWarning(
  config: PacsServerConfig,
  pageProtocol?: string,
): string | null {
  const protocol =
    pageProtocol ?? (typeof window !== 'undefined' ? window.location.protocol : 'http:');
  if (protocol === 'https:' && config.baseUrl.startsWith('http://')) {
    return (
      '应用以 HTTPS 部署，但服务器地址为 http://：浏览器将按混合内容（Mixed Content）拦截该请求。' +
      '请改用 HTTPS 地址（网关需支持 TLS 终结，见 FR-13.10）。'
    );
  }
  return null;
}

/** 校验配置可用性；返回中文错误原因，可用时返回 null */
export function validatePacsServer(config: PacsServerConfig): string | null {
  if (config.baseUrl === '') {
    return '未配置 Base URL';
  }
  if (!isValidPacsBaseUrl(config.baseUrl)) {
    return 'Base URL 必须是 http/https 地址';
  }
  return null;
}

/**
 * 任意未知输入 → 合法服务器配置（逐字段回退默认，与 sanitizeSettings 同策略）。
 * id 缺失时生成 uuid；baseUrl 非法（非 http/https）清空为 ''（由 validate 提示）。
 */
export function sanitizePacsServer(input: unknown): PacsServerConfig {
  const source =
    input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const rawBaseUrl = asString(source.baseUrl, '');
  const baseUrl = isValidPacsBaseUrl(rawBaseUrl) ? rawBaseUrl.replace(/\/+$/, '') : '';
  return {
    id: asString(source.id, '') || crypto.randomUUID(),
    name: asString(source.name, '').trim() || 'DICOMweb 服务器',
    baseUrl,
    qidoPrefix: normalizePrefix(asString(source.qidoPrefix, ''), DEFAULT_QIDO_PREFIX),
    wadoPrefix: normalizePrefix(asString(source.wadoPrefix, ''), DEFAULT_WADO_PREFIX),
    authHeaderName: asString(source.authHeaderName, 'Authorization'),
    authHeaderValue: asString(source.authHeaderValue, ''),
    timeoutMs: clampTimeout(source.timeoutMs),
    isDefault: asBool(source.isDefault),
  };
}

/** 读取持久化的服务器列表；损坏/缺省 → 空列表。至多保留一个默认（首个 isDefault 生效） */
export function loadPacsServers(storage?: Pick<Storage, 'getItem'>): PacsServerConfig[] {
  let raw: string | null = null;
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    raw = store?.getItem(PACS_STORAGE_KEY) ?? null;
  } catch {
    return [];
  }
  if (raw === null) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const servers = parsed.map((item) => sanitizePacsServer(item));
  let defaultSeen = false;
  for (const server of servers) {
    if (server.isDefault) {
      if (defaultSeen) {
        server.isDefault = false;
      } else {
        defaultSeen = true;
      }
    }
  }
  return servers;
}

export function savePacsServers(servers: readonly PacsServerConfig[], storage?: Pick<Storage, 'setItem'>): void {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    store?.setItem(PACS_STORAGE_KEY, JSON.stringify(servers));
  } catch {
    // 存储不可用（隐私模式等）：静默降级为仅内存配置
  }
}

/** 列表内取默认服务器；无默认标记时返回首个（UI 选中回退） */
export function pickDefaultServer(servers: readonly PacsServerConfig[]): PacsServerConfig | undefined {
  return servers.find((s) => s.isDefault) ?? servers[0];
}

// ── URL 构造（QIDO-RS / WADO-RS 路径模板） ─────────────────────────
/** 剥离尾部 / 的 baseUrl */
function baseOf(config: PacsServerConfig): string {
  return config.baseUrl.replace(/\/+$/, '');
}

/** QIDO-RS 检查列表 URL（不含查询参数） */
export function buildStudiesUrl(config: PacsServerConfig): string {
  return `${baseOf(config)}${config.qidoPrefix}`;
}

/** QIDO-RS 指定检查的序列列表 URL */
export function buildStudySeriesUrl(config: PacsServerConfig, studyUid: string): string {
  return `${buildStudiesUrl(config)}/${encodeURIComponent(studyUid)}/series`;
}

/** QIDO-RS 指定序列的实例列表 URL */
export function buildSeriesInstancesUrl(
  config: PacsServerConfig,
  studyUid: string,
  seriesUid: string,
): string {
  return `${buildStudySeriesUrl(config, studyUid)}/${encodeURIComponent(seriesUid)}`;
}

/** WADO-RS 单实例取像素 URL */
export function buildInstanceRetrieveUrl(
  config: PacsServerConfig,
  studyUid: string,
  seriesUid: string,
  sopInstanceUid: string,
): string {
  return `${baseOf(config)}${config.wadoPrefix}/${encodeURIComponent(studyUid)}/series/${encodeURIComponent(
    seriesUid,
  )}/instances/${encodeURIComponent(sopInstanceUid)}`;
}
