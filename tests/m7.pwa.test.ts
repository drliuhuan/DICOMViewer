/**
 * M7 PWA 离线壳测试（FR-10.6）：
 * - manifest.webmanifest 为合法 JSON 且含 PWA 必备字段；
 * - sw.js 行为（在受控沙箱内执行真实脚本）：
 *   install 预缓存应用壳；activate 清理旧版本缓存并 claim；
 *   fetch 导航请求网络优先、断网回退缓存 index.html；静态资源缓存优先；
 *   仅回写 2xx；非 GET / 跨源请求放行不接管；
 * - registerServiceWorker 在非 PROD 测试环境静默跳过。
 */
import { describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from '../src/pwa/register';
import swSource from '../public/sw.js?raw';
import manifestRaw from '../public/manifest.webmanifest?raw';

const ORIGIN = 'http://localhost:4173';
const CACHE_NAME = 'dicom-viewer-v1';

interface ResponseLike {
  ok: boolean;
  status?: number;
  tag?: string;
  clone?: () => ResponseLike;
}

interface FakeRequest {
  url: string;
  method: string;
  mode: string;
}

type FetchMock = (request: FakeRequest) => Promise<ResponseLike>;

function makeRequest(path: string, overrides: { method?: string; mode?: string } = {}): FakeRequest {
  return {
    url: `${ORIGIN}${path}`,
    method: overrides.method ?? 'GET',
    mode: overrides.mode ?? 'same-origin',
  };
}

interface FakeCache {
  addAll(urls: readonly string[]): Promise<void>;
  put(key: string | { url: string }, response: ResponseLike): Promise<void>;
  match(key: string | { url: string }): Promise<ResponseLike | undefined>;
}

interface CachesApi {
  open(name: string): Promise<FakeCache>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
  addAllCalls: string[][];
  storeOf(name: string): Map<string, ResponseLike> | undefined;
}

/** 内存版 CacheStorage（键归一化：字符串或 Request.url） */
function makeCaches(): CachesApi {
  const stores = new Map<string, Map<string, ResponseLike>>();
  const addAllCalls: string[][] = [];
  const keyOf = (key: string | { url: string }): string =>
    typeof key === 'string' ? key : key.url;
  const open = async (name: string): Promise<FakeCache> => {
    let store = stores.get(name);
    if (store === undefined) {
      store = new Map<string, ResponseLike>();
      stores.set(name, store);
    }
    const cacheStore = store;
    return {
      addAll: async (urls) => {
        addAllCalls.push([...urls]);
        for (const url of urls) {
          cacheStore.set(url, { ok: true, clone: () => ({ ok: true }) });
        }
      },
      put: async (key, response) => {
        cacheStore.set(keyOf(key), response);
      },
      match: async (key) => cacheStore.get(keyOf(key)),
    };
  };
  return {
    addAllCalls,
    open,
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    storeOf: (name) => stores.get(name),
  };
}

type SwHandler = (event: unknown) => void;
type SwEventName = 'install' | 'activate' | 'fetch';

interface LoadedSw {
  listeners: Record<SwEventName, SwHandler | undefined>;
  claim: ReturnType<typeof vi.fn>;
  cachesApi: CachesApi;
  fetchMock: FetchMock;
}

/** 在受控沙箱中执行真实 sw.js 源码（不依赖 node:vm，避免引入 @types/node 之外的运行时差异） */
function loadSw(fetchMock: FetchMock): LoadedSw {
  const cachesApi = makeCaches();
  const listeners: LoadedSw['listeners'] = {
    install: undefined,
    activate: undefined,
    fetch: undefined,
  };
  const claim = vi.fn(async (): Promise<void> => undefined);
  const self = {
    addEventListener: (type: string, handler: SwHandler): void => {
      listeners[type as SwEventName] = handler;
    },
    location: { origin: ORIGIN },
    clients: { claim },
    __listeners: listeners,
  };
  const factory = new Function(
    'self',
    'caches',
    'fetch',
    'URL',
    `${swSource}\n;return self.__listeners;`,
  ) as (
    selfArg: typeof self,
    cachesArg: CachesApi,
    fetchArg: FetchMock,
    urlArg: typeof URL,
  ) => LoadedSw['listeners'];
  factory(self, cachesApi, fetchMock, URL);
  return { listeners, claim, cachesApi, fetchMock };
}

describe('manifest.webmanifest', () => {
  it('为合法 JSON 且含 PWA 必备字段', () => {
    const manifest = JSON.parse(manifestRaw) as {
      name?: string;
      short_name?: string;
      start_url?: string;
      display?: string;
      icons?: Array<{ src: string; sizes: string; type: string }>;
    };
    expect(manifest.name).toBeTruthy();
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons?.length ?? 0).toBeGreaterThan(0);
    expect(manifest.icons?.every((icon) => icon.src !== '' && icon.sizes !== '')).toBe(true);
  });
});

describe('sw.js（离线壳行为）', () => {
  it('注册 install / activate / fetch 三类监听', () => {
    const { listeners } = loadSw(vi.fn());
    expect(listeners.install).toBeTypeOf('function');
    expect(listeners.activate).toBeTypeOf('function');
    expect(listeners.fetch).toBeTypeOf('function');
  });

  it('install：预缓存应用壳资源', async () => {
    const { listeners, cachesApi } = loadSw(vi.fn());
    let waited: Promise<unknown> | undefined;
    listeners.install!({ waitUntil: (p: Promise<unknown>) => (waited = p) });
    await waited;
    expect(cachesApi.addAllCalls.length).toBe(1);
    expect(cachesApi.addAllCalls[0]).toEqual(
      expect.arrayContaining(['/', '/index.html', '/manifest.webmanifest', '/icon.svg']),
    );
  });

  it('activate：清理旧版本缓存并 claim 全部客户端', async () => {
    const { listeners, claim, cachesApi } = loadSw(vi.fn());
    await cachesApi.open('dicom-viewer-v0');
    await cachesApi.open(CACHE_NAME);
    let waited: Promise<unknown> | undefined;
    listeners.activate!({ waitUntil: (p: Promise<unknown>) => (waited = p) });
    await waited;
    expect(await cachesApi.keys()).toEqual([CACHE_NAME]);
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it('fetch(导航) 断网 → 回退缓存的 index.html', async () => {
    const fetchMock = vi.fn(async (): Promise<ResponseLike> => {
      throw new TypeError('offline');
    });
    const { listeners, cachesApi } = loadSw(fetchMock);
    const cache = await cachesApi.open(CACHE_NAME);
    await cache.put('/index.html', { ok: true, status: 200 });
    let responsePromise: Promise<unknown> | undefined;
    listeners.fetch!({
      request: makeRequest('/', { mode: 'navigate' }),
      respondWith: (p: Promise<unknown>) => (responsePromise = p),
    });
    const response = (await responsePromise) as ResponseLike;
    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetch(导航) 网络可用 → 返回网络响应并回写 index.html 缓存', async () => {
    const fetchMock = vi.fn(async (): Promise<ResponseLike> => ({
      ok: true,
      status: 200,
      clone: () => ({ ok: true, status: 200, tag: 'network-copy' }),
    }));
    const { listeners, cachesApi } = loadSw(fetchMock);
    let responsePromise: Promise<unknown> | undefined;
    listeners.fetch!({
      request: makeRequest('/', { mode: 'navigate' }),
      respondWith: (p: Promise<unknown>) => (responsePromise = p),
    });
    const response = (await responsePromise) as ResponseLike;
    expect(response.ok).toBe(true);
    expect(response.tag).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const stored = cachesApi.storeOf(CACHE_NAME)?.get('/index.html');
    expect(stored?.tag).toBe('network-copy');
  });

  it('fetch(同源静态资源) 缓存命中 → 直接返回缓存，不发网络请求', async () => {
    const fetchMock = vi.fn();
    const { listeners, cachesApi } = loadSw(fetchMock);
    const cache = await cachesApi.open(CACHE_NAME);
    await cache.put(`${ORIGIN}/assets/app.js`, { ok: true, tag: 'cached' });
    let responsePromise: Promise<unknown> | undefined;
    listeners.fetch!({
      request: makeRequest('/assets/app.js'),
      respondWith: (p: Promise<unknown>) => (responsePromise = p),
    });
    const response = (await responsePromise) as ResponseLike;
    expect(response.tag).toBe('cached');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetch(同源静态资源) 缓存未命中 → 走网络并回写（仅 2xx）', async () => {
    const fetchMock = vi.fn(async (): Promise<ResponseLike> => ({
      ok: true,
      status: 200,
      clone: () => ({ ok: true, tag: 'net' }),
    }));
    const { listeners, cachesApi } = loadSw(fetchMock);
    let responsePromise: Promise<unknown> | undefined;
    listeners.fetch!({
      request: makeRequest('/assets/new.js'),
      respondWith: (p: Promise<unknown>) => (responsePromise = p),
    });
    const response = (await responsePromise) as ResponseLike;
    expect(response.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cachesApi.storeOf(CACHE_NAME)?.get(`${ORIGIN}/assets/new.js`)?.tag).toBe('net');
  });

  it('非 2xx 响应不回写缓存', async () => {
    const fetchMock = vi.fn(async (): Promise<ResponseLike> => ({ ok: false, status: 500 }));
    const { listeners, cachesApi } = loadSw(fetchMock);
    let responsePromise: Promise<unknown> | undefined;
    listeners.fetch!({
      request: makeRequest('/assets/bad.js'),
      respondWith: (p: Promise<unknown>) => (responsePromise = p),
    });
    const response = (await responsePromise) as ResponseLike;
    expect(response.ok).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cachesApi.storeOf(CACHE_NAME)?.get(`${ORIGIN}/assets/bad.js`)).toBeUndefined();
  });

  it('非 GET 与跨源请求放行（不调用 respondWith）', () => {
    const { listeners } = loadSw(vi.fn());
    const respondPost = vi.fn();
    listeners.fetch!({
      request: makeRequest('/', { method: 'POST' }),
      respondWith: respondPost,
    });
    expect(respondPost).not.toHaveBeenCalled();

    const respondCross = vi.fn();
    listeners.fetch!({
      request: { url: 'https://cdn.example.com/a.js', method: 'GET', mode: 'same-origin' },
      respondWith: respondCross,
    });
    expect(respondCross).not.toHaveBeenCalled();
  });
});

describe('registerServiceWorker', () => {
  it('非 PROD 测试环境静默跳过（不抛错）', () => {
    expect(() => registerServiceWorker()).not.toThrow();
  });
});
