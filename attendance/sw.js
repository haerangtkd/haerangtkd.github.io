// 해랑 출석부 — 홈 화면 앱으로 설치되게 하는 최소한의 서비스 워커 (범위: /attendance/ 만)
// 화면 파일은 항상 새로 받고, 인터넷이 끊겼을 때만 저장해 둔 화면을 보여 줍니다.
const CACHE = 'haerang-att-v1';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', 'config.js', 'icon-192.png']))); });
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
