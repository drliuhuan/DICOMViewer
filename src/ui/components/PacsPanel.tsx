/**
 * PACS 联网面板（FR-13.1/13.2/13.3/13.4 P0）：
 * - 服务器配置（Base URL / QIDO 前缀 / WADO-RS 前缀 / 认证头 / 超时）增删改 + 连接测试；
 * - QIDO-RS 查询（患者姓名/ID、日期范围、模态、检查描述）→ 检查列表；
 * - 拉取检查（WADO-RS 逐实例）→ 进度/取消 → 交付 onStudiesFetched 入现有序列树（来源标记「远程」）。
 *
 * 从简实现：固定浮层面板，复用 .tool-button / 表单样式；网络层可注入（单测 mock）。
 *
 * TODO(FR-13.3, P1)：查询结果分页展示；
 * TODO(FR-13.1/13.2/13.3/13.4, P2)：传统 DICOM 网关（C-ECHO/C-FIND/C-MOVE）配置与执行。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  pickDefaultServer,
  sanitizePacsServer,
  validatePacsServer,
  type PacsServerConfig,
} from '../../features/pacs/config';
import {
  DicomwebError,
  queryStudies,
  retrieveStudy,
  testConnection,
  type DicomwebFetch,
  type QidoStudyInfo,
  type RetrieveStudyOptions,
} from '../../features/pacs/dicomweb';
import { toOpenedFiles } from '../../features/pacs/remoteInstances';
import type { OpenedDicomFile } from '../../features/loading/openDicomFiles';

interface PacsPanelProps {
  servers: readonly PacsServerConfig[];
  /** 配置变更（App 负责持久化） */
  onServersChange: (servers: PacsServerConfig[]) => void;
  /** 拉取完成的已解析实例（App 并入现有序列树） */
  onStudiesFetched: (opened: OpenedDicomFile[]) => void;
  onClose: () => void;
  /** 可注入网络层（缺省全局 fetch；单测注入 mock） */
  fetchImpl?: DicomwebFetch;
}

type PanelStatus =
  | { kind: 'idle' }
  | { kind: 'busy'; message: string }
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string };

interface ServerDraft {
  name: string;
  baseUrl: string;
  qidoPrefix: string;
  wadoPrefix: string;
  authHeaderName: string;
  authHeaderValue: string;
  timeoutMs: string;
}

function draftOf(server: PacsServerConfig | undefined): ServerDraft {
  return {
    name: server?.name ?? '',
    baseUrl: server?.baseUrl ?? '',
    qidoPrefix: server?.qidoPrefix ?? '',
    wadoPrefix: server?.wadoPrefix ?? '',
    authHeaderName: server?.authHeaderName ?? 'Authorization',
    authHeaderValue: server?.authHeaderValue ?? '',
    timeoutMs: String(server?.timeoutMs ?? 30000),
  };
}

function errorMessageOf(error: unknown): string {
  if (error instanceof DicomwebError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

const EMPTY_DRAFT: ServerDraft = {
  name: '',
  baseUrl: '',
  qidoPrefix: '/dicomweb/studies',
  wadoPrefix: '/dicomweb/studies',
  authHeaderName: 'Authorization',
  authHeaderValue: '',
  timeoutMs: '30000',
};

export function PacsPanel({
  servers,
  onServersChange,
  onStudiesFetched,
  onClose,
  fetchImpl,
}: PacsPanelProps) {
  const defaultId = pickDefaultServer(servers)?.id;
  const [selectedId, setSelectedId] = useState<string | undefined>(defaultId);
  const selected = servers.find((s) => s.id === selectedId) ?? servers[0];
  const [draft, setDraft] = useState<ServerDraft>(() => draftOf(selected));
  const [status, setStatus] = useState<PanelStatus>({ kind: 'idle' });
  const [results, setResults] = useState<QidoStudyInfo[]>([]);
  const [criteria, setCriteria] = useState({
    patientName: '',
    patientId: '',
    studyDateFrom: '',
    studyDateTo: '',
    modality: '',
    studyDescription: '',
  });
  const [fetching, setFetching] = useState<{ studyUid: string; done: number; total: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /** 切换选中服务器时草稿跟随（未保存的编辑丢弃，从简） */
  const selectServer = (id: string): void => {
    setSelectedId(id);
    setDraft(draftOf(servers.find((s) => s.id === id)));
    setStatus({ kind: 'idle' });
  };

  const validationError = selected !== undefined ? validatePacsServer(selected) : '请先添加服务器';
  const network = fetchImpl;

  const commitDraft = useCallback((): PacsServerConfig | null => {
    if (selected === undefined) {
      return null;
    }
    const next = sanitizePacsServer({ ...selected, ...draft, timeoutMs: Number(draft.timeoutMs) });
    const list = servers.map((s) => (s.id === selected.id ? next : s));
    onServersChange(list);
    setDraft(draftOf(next));
    return next;
  }, [selected, draft, servers, onServersChange]);

  const handleAdd = (): void => {
    const next = sanitizePacsServer({ ...EMPTY_DRAFT, isDefault: servers.length === 0 });
    onServersChange([...servers, next]);
    setSelectedId(next.id);
    setDraft(draftOf(next));
    setStatus({ kind: 'idle' });
  };

  const handleRemove = (): void => {
    if (selected === undefined) {
      return;
    }
    const list = servers.filter((s) => s.id !== selected.id);
    onServersChange(list);
    const fallback = pickDefaultServer(list);
    setSelectedId(fallback?.id);
    setDraft(draftOf(fallback));
  };

  const handleSetDefault = (): void => {
    if (selected === undefined) {
      return;
    }
    onServersChange(servers.map((s) => ({ ...s, isDefault: s.id === selected.id })));
  };

  const runTest = async (): Promise<void> => {
    const config = commitDraft();
    if (config === null) {
      return;
    }
    if (validatePacsServer(config) !== null) {
      setStatus({ kind: 'error', message: validatePacsServer(config) ?? '' });
      return;
    }
    setStatus({ kind: 'busy', message: '正在测试连接…' });
    try {
      const { message } = await testConnection(config, network);
      setStatus({ kind: 'ok', message });
    } catch (error) {
      setStatus({ kind: 'error', message: `连接测试失败：${errorMessageOf(error)}` });
    }
  };

  const runQuery = async (): Promise<void> => {
    const config = commitDraft();
    if (config === null) {
      return;
    }
    if (validatePacsServer(config) !== null) {
      setStatus({ kind: 'error', message: validatePacsServer(config) ?? '' });
      return;
    }
    setStatus({ kind: 'busy', message: '正在查询…' });
    setResults([]);
    try {
      const studies = await queryStudies(
        config,
        {
          patientName: criteria.patientName.trim() || undefined,
          patientId: criteria.patientId.trim() || undefined,
          studyDateFrom: criteria.studyDateFrom.trim() || undefined,
          studyDateTo: criteria.studyDateTo.trim() || undefined,
          modality: criteria.modality.trim() || undefined,
          studyDescription: criteria.studyDescription.trim() || undefined,
        },
        network,
      );
      setResults(studies);
      setStatus({ kind: 'ok', message: `查询完成：共 ${studies.length} 个检查` });
    } catch (error) {
      setStatus({ kind: 'error', message: `查询失败：${errorMessageOf(error)}` });
    }
  };

  const handleFetchStudy = async (studyUid: string): Promise<void> => {
    const config = commitDraft();
    if (config === null) {
      return;
    }
    if (validatePacsServer(config) !== null) {
      setStatus({ kind: 'error', message: validatePacsServer(config) ?? '' });
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setFetching({ studyUid, done: 0, total: 0 });
    setStatus({ kind: 'busy', message: '正在拉取检查…' });
    try {
      const result = await retrieveStudy(config, studyUid, {
        signal: controller.signal,
        fetchImpl: network,
        onProgress: (done, total) => setFetching({ studyUid, done, total }),
      } satisfies RetrieveStudyOptions);
      if (result.cancelled) {
        setStatus({ kind: 'ok', message: '已取消拉取' });
        return;
      }
      const { opened, failures } = toOpenedFiles(result.instances, {
        serverName: config.name,
        studyUid,
      });
      if (opened.length > 0) {
        onStudiesFetched(opened);
      }
      const parts = [`拉取完成：成功 ${opened.length} 个实例`];
      if (failures.length > 0) {
        parts.push(`失败 ${failures.length} 个（${failures[0]?.message ?? ''} 等）`);
      }
      setStatus({ kind: opened.length > 0 ? 'ok' : 'error', message: parts.join('；') });
    } catch (error) {
      setStatus({ kind: 'error', message: `拉取失败：${errorMessageOf(error)}` });
    } finally {
      setFetching(null);
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  };

  const handleCancelFetch = (): void => {
    abortRef.current?.abort();
  };

  const busy = status.kind === 'busy';
  const criteriaDraft = useMemo(
    () => JSON.stringify(criteria),
    [criteria],
  );

  return (
    <div className="pacs-panel" role="dialog" aria-label="PACS 联网">
      <div className="pacs-panel-header">
        <span>PACS 联网（DICOMweb）</span>
        <button type="button" className="tool-button" aria-label="关闭 PACS 面板" onClick={onClose}>
          ×
        </button>
      </div>

      {/* ── 服务器配置（FR-13.1/13.2） ── */}
      <div className="pacs-section">
        <div className="pacs-row">
          <label className="pacs-field">
            <span>服务器</span>
            <select
              value={selected?.id ?? ''}
              onChange={(event) => selectServer(event.target.value)}
              aria-label="选择 PACS 服务器"
            >
              {servers.length === 0 && <option value="">（未配置）</option>}
              {servers.map((server) => (
                <option key={server.id} value={server.id}>
                  {server.name}
                  {server.isDefault ? '（默认）' : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="pacs-row-actions">
            <button type="button" className="tool-button" onClick={handleAdd}>
              添加
            </button>
            <button
              type="button"
              className="tool-button"
              disabled={selected === undefined}
              onClick={handleRemove}
            >
              删除
            </button>
            <button
              type="button"
              className="tool-button"
              disabled={selected === undefined || selected.isDefault}
              onClick={handleSetDefault}
            >
              设为默认
            </button>
          </div>
        </div>

        {selected !== undefined && (
          <div className="pacs-form">
            <label className="pacs-field">
              <span>名称</span>
              <input
                type="text"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                aria-label="服务器名称"
              />
            </label>
            <label className="pacs-field">
              <span>Base URL</span>
              <input
                type="text"
                value={draft.baseUrl}
                placeholder="http://pacs.local:8080"
                onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                aria-label="服务器 Base URL"
              />
            </label>
            <label className="pacs-field">
              <span>QIDO 前缀</span>
              <input
                type="text"
                value={draft.qidoPrefix}
                placeholder="/dicomweb/studies"
                onChange={(event) => setDraft({ ...draft, qidoPrefix: event.target.value })}
                aria-label="QIDO-RS 前缀"
              />
            </label>
            <label className="pacs-field">
              <span>WADO-RS 前缀</span>
              <input
                type="text"
                value={draft.wadoPrefix}
                placeholder="/dicomweb/studies"
                onChange={(event) => setDraft({ ...draft, wadoPrefix: event.target.value })}
                aria-label="WADO-RS 前缀"
              />
            </label>
            <label className="pacs-field">
              <span>认证头名</span>
              <input
                type="text"
                value={draft.authHeaderName}
                placeholder="Authorization（留空不附加）"
                onChange={(event) => setDraft({ ...draft, authHeaderName: event.target.value })}
                aria-label="认证头名称"
              />
            </label>
            <label className="pacs-field">
              <span>认证头值</span>
              <input
                type="text"
                value={draft.authHeaderValue}
                placeholder="Basic xxx / Bearer xxx"
                onChange={(event) => setDraft({ ...draft, authHeaderValue: event.target.value })}
                aria-label="认证头值"
              />
            </label>
            <label className="pacs-field">
              <span>超时（毫秒）</span>
              <input
                type="number"
                min={1000}
                max={300000}
                step={1000}
                value={draft.timeoutMs}
                onChange={(event) => setDraft({ ...draft, timeoutMs: event.target.value })}
                aria-label="请求超时（毫秒）"
              />
            </label>
            <div className="pacs-row-actions">
              <button type="button" className="tool-button" onClick={() => commitDraft()}>
                保存配置
              </button>
              <button type="button" className="tool-button" disabled={busy} onClick={() => void runTest()}>
                测试连接
              </button>
            </div>
            {validationError !== null && (
              <div className="pacs-status pacs-status--error" role="alert">
                {validationError}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 状态提示 ── */}
      {status.kind !== 'idle' && (
        <div
          role={status.kind === 'error' ? 'alert' : 'status'}
          className={`pacs-status pacs-status--${status.kind}`}
        >
          {status.message}
        </div>
      )}

      {/* ── 查询（FR-13.3） ── */}
      <div className="pacs-section">
        <div className="pacs-section-title">查询</div>
        <div className="pacs-form">
          <label className="pacs-field">
            <span>患者姓名</span>
            <input
              type="text"
              value={criteria.patientName}
              onChange={(event) =>
                setCriteria({ ...criteria, patientName: event.target.value })
              }
              aria-label="患者姓名"
            />
          </label>
          <label className="pacs-field">
            <span>患者 ID</span>
            <input
              type="text"
              value={criteria.patientId}
              onChange={(event) => setCriteria({ ...criteria, patientId: event.target.value })}
              aria-label="患者 ID"
            />
          </label>
          <label className="pacs-field">
            <span>日期从</span>
            <input
              type="text"
              value={criteria.studyDateFrom}
              placeholder="YYYYMMDD"
              onChange={(event) => setCriteria({ ...criteria, studyDateFrom: event.target.value })}
              aria-label="检查日期从"
            />
          </label>
          <label className="pacs-field">
            <span>日期至</span>
            <input
              type="text"
              value={criteria.studyDateTo}
              placeholder="YYYYMMDD"
              onChange={(event) => setCriteria({ ...criteria, studyDateTo: event.target.value })}
              aria-label="检查日期至"
            />
          </label>
          <label className="pacs-field">
            <span>模态</span>
            <input
              type="text"
              value={criteria.modality}
              placeholder="CT / MR / US…"
              onChange={(event) => setCriteria({ ...criteria, modality: event.target.value })}
              aria-label="模态"
            />
          </label>
          <label className="pacs-field">
            <span>检查描述</span>
            <input
              type="text"
              value={criteria.studyDescription}
              onChange={(event) =>
                setCriteria({ ...criteria, studyDescription: event.target.value })
              }
              aria-label="检查描述"
            />
          </label>
          <div className="pacs-row-actions">
            <button type="button" className="tool-button" disabled={busy} onClick={() => void runQuery()}>
              查询
            </button>
          </div>
        </div>
      </div>

      {/* ── 查询结果（FR-13.3/13.4） ── */}
      {results.length > 0 && (
        <div className="pacs-section">
          <div className="pacs-section-title">检查结果（{results.length}）</div>
          <div className="pacs-results" data-criteria={criteriaDraft}>
            {results.map((study) => {
              const isFetching = fetching?.studyUid === study.studyUid;
              return (
                <div key={study.studyUid} className="pacs-study-row">
                  <div className="pacs-study-info">
                    <div className="pacs-study-line1">
                      <span className="pacs-study-date">{study.studyDate ?? '日期未知'}</span>
                      <span>
                        {study.patientName ?? '未知患者'}
                        {study.patientId ? `（${study.patientId}）` : ''}
                      </span>
                    </div>
                    <div className="pacs-study-line2">
                      {study.studyDescription ?? '未命名检查'} · {study.series.length} 序列 ·{' '}
                      {study.modalities.length > 0 ? study.modalities.join('/') : '模态未知'}
                    </div>
                  </div>
                  {isFetching && fetching !== null && (
                    <span className="pacs-progress" role="status">
                      拉取 {fetching.done}/{fetching.total === 0 ? '…' : fetching.total}
                    </span>
                  )}
                  {isFetching ? (
                    <button type="button" className="tool-button" onClick={handleCancelFetch}>
                      取消
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="tool-button"
                      disabled={busy}
                      onClick={() => void handleFetchStudy(study.studyUid)}
                    >
                      拉取
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
