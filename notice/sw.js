// 해랑경희 알림 서비스 워커
const INBOX = 'haerang-inbox';
const INBOX_KEY = '/notice/__inbox';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: '해랑경희', body: e.data ? e.data.text() : '' }; }
  const title = d.title || '해랑경희';
  const opts = {
    body: d.body || '',
    icon: '/notice/icon-192.png',
    badge: '/notice/badge.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    vibrate: [200, 100, 200, 100, 200],   // 안드로이드: 진동과 함께 화면 위로 띄우는 데 도움
    silent: false,
    timestamp: Date.now(),
    data: { url: d.url || '/notice/' },
  };
  e.waitUntil(Promise.all([
    self.registration.showNotification(title, opts),
    saveInbox({ title, body: d.body || '', kind: d.kind || '공지', at: Date.now() }),
    self.clients.matchAll({ type: 'window' }).then(cs => cs.forEach(c => c.postMessage({ type: 'push' }))),
  ]));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/notice/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) if (c.url.includes('/notice/') && 'focus' in c) { c.navigate(url).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});

// 받은 알림 기록 (기기 안에만 저장, 최근 40개)
async function saveInbox(item) {
  try {
    const cache = await caches.open(INBOX);
    const r = await cache.match(INBOX_KEY);
    const list = r ? await r.json() : [];
    list.unshift(item);
    await cache.put(INBOX_KEY, new Response(JSON.stringify(list.slice(0, 40)), { headers: { 'Content-Type': 'application/json' } }));
  } catch (_) {}
}
