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
    badgeUp(d.url), // 2026-11-16 사용자: 안 읽은 알림 수를 앱 아이콘에 숫자로
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

// 앱 아이콘 숫자 = 아직 열어 보지 않은 알림 수. 알림마다 어느 화면 것인지(주소 # 뒤) 적어 두고,
// 학부모 앱에서 그 화면을 열면 화면 쪽이 지움 (2026-11-16 사용자: 해당 부분을 열면 사라지게)
const BADGE_KEY = '/notice/__badge';
async function badgeUp(url) {
  try {
    const cache = await caches.open(INBOX);
    const r = await cache.match(BADGE_KEY);
    let list = []; try { list = r ? JSON.parse(await r.text()) : []; } catch (_) {}
    if (!Array.isArray(list)) list = [];
    const v = String(url || '').split('#')[1] || '';
    list.push({ v, at: Date.now() });
    list = list.filter(x => Date.now() - x.at < 14 * 864e5).slice(-99);
    await cache.put(BADGE_KEY, new Response(JSON.stringify(list)));
    if (self.navigator && self.navigator.setAppBadge) await self.navigator.setAppBadge(list.length);
  } catch (_) {}
}
