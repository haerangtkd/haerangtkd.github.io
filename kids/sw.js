// 해랑경희 제자 앱 서비스 워커 (2026-11-15): 휴대폰 알림만 (선범단 도장 등)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: '해랑경희 제자', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(Promise.all([
    self.registration.showNotification(d.title || '해랑경희 제자', { body: d.body || '', icon: '/kids/icon-192.png', badge: '/notice/badge.png', tag: d.tag || undefined, renotify: !!d.tag, vibrate: [200, 100, 200], data: { url: d.url || '/kids/' } }),
    self.clients.matchAll({ type: 'window' }).then(cs => cs.forEach(c => c.postMessage({ type: 'push' }))),
  ]));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/kids/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) if (c.url.includes('/kids/') && 'focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
