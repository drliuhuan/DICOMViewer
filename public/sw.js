/* DICOM 查看器 Service Worker（FR-10.6 PWA 离线壳）
 *
 * 策略：
 * - install：预缓存应用壳（index.html/manifest/图标）；
 * - activate：清理旧版本缓存并 claim 全部客户端；
 * - fetch：
 *   - 页面导航（navigate）：网络优先，失败时回退缓存的 index.html（断网可开应用壳）；
 *   - 同源静态资源：缓存优先，未命中走网络并回填（仅缓存 2xx 响应）；
 *   - 跨源/非 GET 一律放行（本地模式零网络，见 NFR-7）。
 *
 * 版本升级：修改 CACHE_VERSION 即可，activate 自动清理旧缓存。
 */
'use strict';

var CACHE_VERSION = 'dicom-viewer-v1';
var SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.addAll(SHELL_URLS);
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              return key !== CACHE_VERSION;
            })
            .map(function (key) {
              return caches.delete(key);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') {
    return;
  }
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(function (response) {
          var copy = response.clone();
          caches
            .open(CACHE_VERSION)
            .then(function (cache) {
              cache.put('/index.html', copy);
            })
            .catch(function () {});
          return response;
        })
        .catch(function () {
          return caches
            .open(CACHE_VERSION)
            .then(function (cache) {
              return cache.match('/index.html');
            });
        })
    );
    return;
  }

  event.respondWith(
    caches
      .open(CACHE_VERSION)
      .then(function (cache) {
        return cache.match(request);
      })
      .then(function (cached) {
        if (cached) {
          return cached;
        }
        return fetch(request).then(function (response) {
          if (response && response.ok) {
            var copy = response.clone();
            caches
              .open(CACHE_VERSION)
              .then(function (cache) {
                cache.put(request, copy);
              })
              .catch(function () {});
          }
          return response;
        });
      })
    );
});
