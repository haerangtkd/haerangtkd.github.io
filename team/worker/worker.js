// 해랑 업무 서버 (도장 직원용 협업툴 · Cloudflare Workers 무료 요금제 + D1)
// 화면: https://haerangtkd.github.io/team/
// ─────────────────────────────────────────────
// 필요한 설정 (Cloudflare 대시보드 → 이 Worker → 설정)
//   1) D1 데이터베이스 바인딩: 변수 이름 DB  (업무 전용 데이터베이스 haerang-team)
//   2) (선택) 서비스 바인딩 ATT → haerang-attendance, 비밀 변수 SYNC_KEY ← 출석부 서버와 같은 값
//      → 등원표에 출석부 원생 이름을 쓰고, 채팅 '#등원 ○○ 결석'을 출석부 결석 예정으로 넣음
// 표(테이블)와 푸시 서명 키는 처음 실행될 때 자동으로 만듭니다.
// ─────────────────────────────────────────────

const SITE = 'https://haerangtkd.github.io';
const SESSION_DAYS = 180;
const MAX_FAIL = 5, LOCK_MS = 60 * 1000;
const TYPES = ['todo', 'sched', 'event', 'buy'];
const TYPE_KO = { todo: '할 일', sched: '일정', event: '행사표', buy: '구매표' };

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)',
  'CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, name TEXT, salt TEXT, pin TEXT, created INTEGER)',
  'CREATE TABLE IF NOT EXISTS sessions (tok TEXT PRIMARY KEY, mid TEXT, created INTEGER)',
  'CREATE TABLE IF NOT EXISTS subs (ep TEXT PRIMARY KEY, mid TEXT, p256 TEXT, auth TEXT, created INTEGER)',
  'CREATE TABLE IF NOT EXISTS msgs (id INTEGER PRIMARY KEY AUTOINCREMENT, mid TEXT, text TEXT, photo TEXT, refs TEXT, at INTEGER)',
  'CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, type TEXT, data TEXT, upd INTEGER, del INTEGER DEFAULT 0, mid TEXT)',
  'CREATE INDEX IF NOT EXISTS items_upd ON items (upd)',
  'CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, item TEXT, mid TEXT, text TEXT, at INTEGER)',
  'CREATE INDEX IF NOT EXISTS comments_at ON comments (at)',
  'CREATE TABLE IF NOT EXISTS pickup (day TEXT PRIMARY KEY, data TEXT, upd INTEGER)',
  'CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, full TEXT, thumb TEXT, created INTEGER)',
  'CREATE TABLE IF NOT EXISTS fails (ip TEXT PRIMARY KEY, n INTEGER, until INTEGER)',
  'CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, mid TEXT, kind TEXT, text TEXT, ref TEXT, at INTEGER)',
  'CREATE INDEX IF NOT EXISTS logs_at ON logs (at)',
];
// 예전 표에 새 칸 붙이기 (답장·반응·수정 시각) — 이미 있으면 그냥 넘어감
const ALTERS = ['ALTER TABLE msgs ADD COLUMN reply TEXT', 'ALTER TABLE msgs ADD COLUMN rx TEXT', 'ALTER TABLE msgs ADD COLUMN upd INTEGER'];
let ready = false;
async function setup(env) {
  if (ready) return;
  await env.DB.batch(SCHEMA.map(s => env.DB.prepare(s)));
  const cols = ((await env.DB.prepare('PRAGMA table_info(msgs)').all()).results || []).map(c => c.name);
  for (const a of ALTERS) if (!cols.includes(a.split(' ')[5])) { try { await env.DB.prepare(a).run(); } catch (_) {} }
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS msgs_upd ON msgs (upd)').run();
  ready = true;
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    try {
      await setup(env);
      return cors(await route(new URL(req.url).pathname, req, env, ctx));
    } catch (e) {
      return cors(json({ ok: false, error: String(e && e.message || e) }, 500));
    }
  },
};

const q = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
const all = async (env, sql, ...args) => (await q(env, sql, ...args).all()).results || [];
const one = (env, sql, ...args) => q(env, sql, ...args).first();
const run = (env, sql, ...args) => q(env, sql, ...args).run();
const J = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (_) { return d; } };
const rid = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

async function route(path, req, env, ctx) {
  const b = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const ip = req.headers.get('cf-connecting-ip') || 'x';
  if (!path.startsWith('/api/')) return json({ ok: true, app: '해랑 업무' });

  // ═════════ 로그인 전 ═════════
  if (path === '/api/vapid') return json({ ok: true, publicKey: (await getVapid(env)).publicKey });
  if (path === '/api/members') {
    const m = await all(env, 'SELECT id, name FROM members ORDER BY created');
    return json({ ok: true, members: m, needSetup: !m.length });
  }
  if (path === '/api/setup') { // 처음 한 번: 첫 사람 만들기 (아무도 없을 때만)
    if ((await one(env, 'SELECT COUNT(*) AS n FROM members')).n) return json({ ok: false, error: '이미 설정되어 있습니다' });
    const r = await addMember(env, b.name, b.pin); if (!r.ok) return json(r);
    return json({ ok: true, tok: await newSession(env, r.id), name: r.name });
  }
  if (path === '/api/login') {
    const f = await one(env, 'SELECT n, until FROM fails WHERE ip = ?', ip);
    if (f && f.until > Date.now()) return json({ ok: false, error: MAX_FAIL + '번 틀려서 잠겼어요. ' + Math.ceil((f.until - Date.now()) / 1000) + '초 뒤에 다시 해 주세요' }, 429);
    const m = await one(env, 'SELECT * FROM members WHERE id = ?', str(b.mid, 40));
    if (!m || !(await sameText(await pinHash(m.salt, b.pin), m.pin))) {
      const n = (f && f.until && f.until <= Date.now() ? 0 : (f ? f.n : 0)) + 1;
      await run(env, 'INSERT INTO fails (ip, n, until) VALUES (?, ?, ?) ON CONFLICT(ip) DO UPDATE SET n = excluded.n, until = excluded.until', ip, n, n >= MAX_FAIL ? Date.now() + LOCK_MS : 0);
      return json({ ok: false, error: n >= MAX_FAIL ? MAX_FAIL + '번 틀려서 1분 동안 잠겼어요' : 'PIN이 맞지 않아요 (' + n + '/' + MAX_FAIL + '번 틀림)' }, 401);
    }
    if (f) await run(env, 'DELETE FROM fails WHERE ip = ?', ip);
    return json({ ok: true, tok: await newSession(env, m.id), name: m.name });
  }

  // ═════════ 로그인 후 ═════════
  const me = await auth(env, b.tok);
  if (!me) return json({ ok: false, error: '다시 로그인해 주세요', relogin: true }, 401);
  // 알림 보내기 + (채팅 말고는) 알림 기록에 남기기
  const notify = (title, body, view, ref) => {
    ctx.waitUntil(pushAll(env, me.id, title, body, view).catch(() => {}));
    if (view !== 'chat') ctx.waitUntil(addLog(env, me.id, view, body, ref).catch(() => {}));
  };

  if (path === '/api/logout') { await run(env, 'DELETE FROM sessions WHERE tok = ?', str(b.tok, 64)); return json({ ok: true }); }
  if (path === '/api/member-add') {
    const r = await addMember(env, b.name, b.pin); if (r.ok) notify('해랑 업무 · ' + me.name, r.name + '님을 함께 쓰는 사람으로 추가했어요', 'member');
    return json(r);
  }
  if (path === '/api/member-pin') { // 내 PIN 바꾸기, 또는 다른 사람 PIN 새로 정하기
    const pin = String(b.pin || '');
    if (!/^\d{4,6}$/.test(pin)) return json({ ok: false, error: 'PIN은 숫자 4~6자리로 정해 주세요' });
    const mid = str(b.mid || me.id, 40), salt = rid(8);
    if (mid === me.id) { const m = await one(env, 'SELECT * FROM members WHERE id = ?', me.id); if (!(await sameText(await pinHash(m.salt, b.old), m.pin))) return json({ ok: false, error: '지금 PIN이 맞지 않아요' }); }
    await run(env, 'UPDATE members SET salt = ?, pin = ? WHERE id = ?', salt, await pinHash(salt, pin), mid);
    if (mid !== me.id) await run(env, 'DELETE FROM sessions WHERE mid = ?', mid);
    return json({ ok: true });
  }
  if (path === '/api/member-del') {
    const mid = str(b.mid, 40); if (mid === me.id) return json({ ok: false, error: '나는 지울 수 없어요' });
    await env.DB.batch([q(env, 'DELETE FROM members WHERE id = ?', mid), q(env, 'DELETE FROM sessions WHERE mid = ?', mid), q(env, 'DELETE FROM subs WHERE mid = ?', mid)]);
    return json({ ok: true });
  }
  if (path === '/api/push') { // 알림 켜기/끄기
    const s = b.subscription;
    if (s && s.endpoint && /^https:\/\//.test(s.endpoint) && s.keys) await run(env, 'INSERT INTO subs (ep, mid, p256, auth, created) VALUES (?, ?, ?, ?, ?) ON CONFLICT(ep) DO UPDATE SET mid = excluded.mid, p256 = excluded.p256, auth = excluded.auth', s.endpoint, me.id, s.keys.p256dh, s.keys.auth, Date.now());
    else if (b.endpoint) await run(env, 'DELETE FROM subs WHERE ep = ?', str(b.endpoint, 500));
    return json({ ok: true });
  }
  if (path === '/api/push-test') { const r = await pushTo(env, (await all(env, 'SELECT * FROM subs WHERE mid = ?', me.id)), '해랑 업무', '알림이 잘 와요 👍', 'home'); return json({ ok: true, ...r }); }

  // 처음 열 때 전부, 그다음엔 바뀐 것만 (since)
  if (path === '/api/sync') {
    const since = Math.max(0, Number(b.since) || 0), lastMsg = Math.max(0, b.lastMsg | 0), first = !since;
    const [members, msgs, items, comments, pickup, logs] = await Promise.all([
      all(env, 'SELECT id, name FROM members ORDER BY created'),
      first ? all(env, 'SELECT * FROM (SELECT id, mid, text, photo, refs, reply, rx, upd, at FROM msgs ORDER BY id DESC LIMIT 150) ORDER BY id') : all(env, 'SELECT id, mid, text, photo, refs, reply, rx, upd, at FROM msgs WHERE id > ? OR (upd > ? AND id <= ?) ORDER BY id LIMIT 300', lastMsg, since, lastMsg),
      all(env, 'SELECT id, type, data, upd, del, mid FROM items WHERE upd > ?' + (first ? ' AND del = 0' : ''), since),
      all(env, 'SELECT id, item, mid, text, at FROM comments WHERE at > ?', since),
      all(env, 'SELECT day, data, upd FROM pickup WHERE upd > ? AND day >= ?', since, addDays(kstDay(), -7)),
      first ? all(env, 'SELECT * FROM (SELECT id, mid, kind, text, ref, at FROM logs ORDER BY id DESC LIMIT 120) ORDER BY id') : all(env, 'SELECT id, mid, kind, text, ref, at FROM logs WHERE at > ? ORDER BY id LIMIT 200', since),
    ]);
    const kvs = await all(env, "SELECT k, v FROM kv WHERE k IN ('pickupDefault', 'notice')"), kv = k => (kvs.find(x => x.k === k) || {}).v;
    return json({ ok: true, now: Date.now(), me, members,
      msgs: msgs.map(fixMsg), logs, notice: J(kv('notice'), null),
      items: items.map(i => ({ id: i.id, type: i.type, del: !!i.del, upd: i.upd, mid: i.mid, ...J(i.data, {}) })),
      comments, pickup: pickup.map(p => ({ day: p.day, upd: p.upd, ...J(p.data, {}) })), pickupDefault: J(kv('pickupDefault'), {}) });
  }
  if (path === '/api/more-msgs') return json({ ok: true, msgs: (await all(env, 'SELECT id, mid, text, photo, refs, reply, rx, upd, at FROM msgs WHERE id < ? ORDER BY id DESC LIMIT 100', b.before | 0)).reverse().map(fixMsg) });

  // 채팅 (해시태그로 만든 항목은 refs 로 연결)
  if (path === '/api/msg') {
    const text = str(b.text, 2000).trim(), photo = /^[0-9a-f]{24}$/.test(b.photo || '') ? b.photo : '';
    if (!text && !photo) return json({ ok: false, error: '빈 메시지' });
    const st = [], refs = [];
    for (const it of (Array.isArray(b.items) ? b.items : []).slice(0, 5)) { const r = itemStmt(env, it, me); if (r) { st.push(r.stmt); refs.push({ id: r.id, type: r.type, title: r.title }); } }
    for (const p of (Array.isArray(b.pickups) ? b.pickups : []).slice(0, 3)) if (isDay(p.day)) st.push(q(env, 'INSERT INTO pickup (day, data, upd) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET data = excluded.data, upd = excluded.upd', p.day, JSON.stringify(cleanPickup(p)), Date.now()));
    if (st.length) await env.DB.batch(st);
    let reply = '';
    if (b.reply) { const o = await one(env, 'SELECT id, mid, text, photo FROM msgs WHERE id = ?', b.reply | 0); if (o) reply = JSON.stringify({ id: o.id, mid: o.mid, text: str(o.text || (o.photo ? '사진' : ''), 80) }); }
    const now = Date.now();
    const r = await run(env, 'INSERT INTO msgs (mid, text, photo, refs, reply, rx, upd, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', me.id, text, photo, JSON.stringify(refs), reply, '{}', now, now);
    for (const x of refs) ctx.waitUntil(addLog(env, me.id, x.type, TYPE_KO[x.type] + ' 추가: ' + x.title, x.id).catch(() => {}));
    // 출석부에 결석 예정 넣기 (#등원 ○○ 결석)
    if (Array.isArray(b.absences) && b.absences.length) ctx.waitUntil(attSync(env, '/sync/absence', { items: b.absences.slice(0, 10) }).catch(() => {}));
    notify(me.name, photo && !text ? '사진을 보냈어요' : text.slice(0, 120), 'chat');
    return json({ ok: true, id: r.meta && r.meta.last_row_id, refs });
  }
  if (path === '/api/msg-del') {
    const m = await one(env, 'SELECT mid, photo FROM msgs WHERE id = ?', b.id | 0);
    if (!m || m.mid !== me.id) return json({ ok: false, error: '내가 보낸 메시지만 지울 수 있어요' });
    await run(env, "UPDATE msgs SET text = '(지운 메시지)', photo = '', refs = '[]', rx = '{}', upd = ? WHERE id = ?", Date.now(), b.id | 0);
    if (m.photo) await run(env, 'DELETE FROM photos WHERE id = ?', m.photo);
    const n = J((await one(env, "SELECT v FROM kv WHERE k = 'notice'") || {}).v, null);
    if (n && n.id === (b.id | 0)) await run(env, "DELETE FROM kv WHERE k = 'notice'");
    return json({ ok: true });
  }
  if (path === '/api/msg-react') { // 반응 이모지 (한 번 더 누르면 취소)
    const e = ['❤️', '👍', '✅', '😊', '😮', '😭'].includes(b.e) ? b.e : null; if (!e) return json({ ok: false, error: '반응' });
    const m = await one(env, 'SELECT rx FROM msgs WHERE id = ?', b.id | 0); if (!m) return json({ ok: false, error: '지워진 메시지예요' });
    const rx = J(m.rx, {}), l = rx[e] || [];
    rx[e] = l.includes(me.id) ? l.filter(x => x !== me.id) : [...l, me.id]; if (!rx[e].length) delete rx[e];
    await run(env, 'UPDATE msgs SET rx = ?, upd = ? WHERE id = ?', JSON.stringify(rx), Date.now(), b.id | 0);
    return json({ ok: true, rx });
  }
  if (path === '/api/notice') { // 채팅 공지 (id 없으면 내리기)
    if (!b.id) { await run(env, "DELETE FROM kv WHERE k = 'notice'"); return json({ ok: true, notice: null }); }
    const m = await one(env, 'SELECT id, mid, text FROM msgs WHERE id = ?', b.id | 0); if (!m || !m.text) return json({ ok: false, error: '글이 있는 메시지만 공지로 올릴 수 있어요' });
    const n = { id: m.id, mid: m.mid, text: str(m.text, 500), by: me.name, at: Date.now() };
    await run(env, "INSERT INTO kv (k, v) VALUES ('notice', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", JSON.stringify(n));
    notify(me.name + ' · 공지', n.text.slice(0, 120), 'notice', String(m.id));
    return json({ ok: true, notice: n });
  }
  if (path === '/api/photo-up') {
    const full = String(b.full || ''), thumb = String(b.thumb || '');
    if (!/^[A-Za-z0-9+/=]+$/.test(full) || full.length > 1900000 || thumb.length > 300000) return json({ ok: false, error: '사진이 너무 커요' });
    const id = rid(12); await run(env, 'INSERT INTO photos (id, full, thumb, created) VALUES (?, ?, ?, ?)', id, full, thumb, Date.now());
    return json({ ok: true, id });
  }
  if (path === '/api/photo') { const r = await one(env, 'SELECT ' + (b.size === 'full' ? 'full' : 'thumb') + ' AS d FROM photos WHERE id = ?', str(b.id, 30)); return json(r ? { ok: true, data: r.d } : { ok: false }); }

  // 할 일 · 일정 · 행사표 · 구매표 저장 (what: 알림에 쓸 한 줄)
  if (path === '/api/item') {
    const r = itemStmt(env, b.item || {}, me); if (!r) return json({ ok: false, error: '제목을 적어 주세요' });
    await r.stmt.run();
    if (b.what !== false) notify(me.name, String(b.what || (b.item.id ? r.title + ' 수정' : TYPE_KO[r.type] + ' 추가: ' + r.title)).slice(0, 140), r.type, r.id);
    return json({ ok: true, id: r.id, upd: r.upd });
  }
  if (path === '/api/item-del') {
    const it = await one(env, 'SELECT type, data FROM items WHERE id = ?', str(b.id, 40)); if (!it) return json({ ok: true });
    await run(env, 'UPDATE items SET del = 1, upd = ? WHERE id = ?', Date.now(), str(b.id, 40));
    notify(me.name, TYPE_KO[it.type] + ' 지움: ' + (J(it.data, {}).title || ''), it.type, '');
    return json({ ok: true });
  }
  if (path === '/api/comment') {
    const it = await one(env, 'SELECT type, data FROM items WHERE id = ?', str(b.item, 40)); if (!it) return json({ ok: false, error: '지워진 항목이에요' });
    const text = str(b.text, 1000).trim(); if (!text) return json({ ok: false, error: '내용을 적어 주세요' });
    const id = rid(8), at = Date.now();
    await env.DB.batch([q(env, 'INSERT INTO comments (id, item, mid, text, at) VALUES (?, ?, ?, ?, ?)', id, str(b.item, 40), me.id, text, at), q(env, 'UPDATE items SET upd = ? WHERE id = ?', at, str(b.item, 40))]);
    notify(me.name + ' · 댓글', '[' + (J(it.data, {}).title || TYPE_KO[it.type]) + '] ' + text.slice(0, 100), 'comment', str(b.item, 40));
    return json({ ok: true, id, at });
  }

  // 등원표: 요일별 기본 명단 + 날짜별 (데리러 갈 아이, 체크, 결석, 메모)
  if (path === '/api/pickup-default') {
    const d = {}; for (const w of ['월', '화', '수', '목', '금']) d[w] = (Array.isArray(b.def && b.def[w]) ? b.def[w] : []).map(x => str(x, 20)).filter(Boolean).slice(0, 60);
    await run(env, "INSERT INTO kv (k, v) VALUES ('pickupDefault', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", JSON.stringify(d));
    return json({ ok: true });
  }
  if (path === '/api/pickup') {
    if (!isDay(b.day)) return json({ ok: false, error: '날짜' });
    const d = cleanPickup(b), upd = Date.now();
    await run(env, 'INSERT INTO pickup (day, data, upd) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET data = excluded.data, upd = excluded.upd', b.day, JSON.stringify(d), upd);
    if (b.what) notify(me.name + ' · 등원', String(b.what).slice(0, 140), 'pickup', b.day);
    return json({ ok: true, upd });
  }
  if (path === '/api/roster') { // 출석부 원생 이름 (등원표·행사표에서 고르기)
    const r = await attSync(env, '/sync/roster', {});
    return json(r.ok ? { ok: true, students: r.students.filter(s => s.status === '재원').map(s => s.name) } : { ok: false, students: [], error: r.error });
  }
  return json({ ok: false, error: 'not found' }, 404);
}

function itemStmt(env, it, me) {
  const type = TYPES.includes(it.type) ? it.type : null; if (!type) return null;
  const d = { ...(it || {}) }; delete d.id; delete d.type; delete d.del; delete d.upd; delete d.mid;
  d.title = str(d.title, 100).trim(); if (!d.title) return null;
  if (d.date && !isDay(d.date)) d.date = '';
  const s = JSON.stringify(d); if (s.length > 60000) return null;
  const id = str(it.id, 40) || rid(8), upd = Date.now();
  return { id, type, title: d.title, upd, stmt: q(env, 'INSERT INTO items (id, type, data, upd, del, mid) VALUES (?, ?, ?, ?, 0, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, upd = excluded.upd, del = 0', id, type, s, upd, me.id) };
}
function fixMsg(m) { return { ...m, refs: J(m.refs, []), reply: J(m.reply, null), rx: J(m.rx, {}) }; }
async function addLog(env, mid, kind, text, ref) {
  const now = Date.now();
  await run(env, 'INSERT INTO logs (mid, kind, text, ref, at) VALUES (?, ?, ?, ?, ?)', mid, str(kind, 12), str(text, 300), str(ref, 40), now);
  if (Math.random() < 0.02) await run(env, 'DELETE FROM logs WHERE at < ?', now - 90 * 86400e3); // 90일 지난 기록 정리
}
function cleanPickup(p) {
  const names = a => (Array.isArray(a) ? a : []).map(x => str(x, 20)).filter(Boolean).slice(0, 80);
  return { list: names(p.list), done: names(p.done), absent: names(p.absent), memos: (Array.isArray(p.memos) ? p.memos : []).slice(-30).map(m => ({ who: str(m.who, 12), text: str(m.text, 200), at: Number(m.at) || Date.now() })) };
}

// ─────────── 알림 보내기 (나를 뺀 모두) ───────────
async function pushAll(env, myId, title, body, view) {
  const subs = await all(env, 'SELECT * FROM subs WHERE mid <> ?', myId);
  return pushTo(env, subs, title, body, view);
}
async function pushTo(env, subs, title, body, view) {
  if (!subs.length) return { sent: 0, total: 0 };
  const vapid = await getVapid(env), auths = new Map();
  const tab = { chat: 'chat', notice: 'chat', sched: 'sched', event: 'table', buy: 'table', home: 'home', pickup: 'home', todo: 'home' }[view] || 'log';
  const payload = JSON.stringify({ title, body, url: SITE + '/team/#' + tab, tag: 'team-' + Date.now() });
  let sent = 0;
  await Promise.all(subs.slice(0, 12).map(async s => {
    try {
      const aud = new URL(s.ep).origin;
      if (!auths.has(aud)) auths.set(aud, vapidHeader(s.ep, vapid));
      const res = await webPush({ endpoint: s.ep, p256dh: s.p256, auth: s.auth }, payload, await auths.get(aud));
      if (res.status === 404 || res.status === 410) await run(env, 'DELETE FROM subs WHERE ep = ?', s.ep); else if (res.ok) sent++;
    } catch (_) {}
  }));
  return { sent, total: subs.length };
}

async function attSync(env, path, body) {
  if (!env.ATT || !env.SYNC_KEY) return { ok: false, error: '출석부가 연결되지 않았어요' };
  try { const r = await env.ATT.fetch('https://attendance' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sync-Key': env.SYNC_KEY }, body: JSON.stringify(body) }); return await r.json(); }
  catch (_) { return { ok: false, error: '출석부에 연결하지 못했어요' }; }
}

// ─────────── 로그인 ───────────
async function addMember(env, name, pin) {
  name = str(name, 12).trim(); pin = String(pin || '');
  if (!name) return { ok: false, error: '이름을 적어 주세요' };
  if (!/^\d{4,6}$/.test(pin)) return { ok: false, error: 'PIN은 숫자 4~6자리로 정해 주세요' };
  if (await one(env, 'SELECT id FROM members WHERE name = ?', name)) return { ok: false, error: '같은 이름이 이미 있어요' };
  const id = rid(8), salt = rid(8);
  await run(env, 'INSERT INTO members (id, name, salt, pin, created) VALUES (?, ?, ?, ?, ?)', id, name, salt, await pinHash(salt, pin), Date.now());
  return { ok: true, id, name };
}
async function newSession(env, mid) { const tok = rid(24); await run(env, 'INSERT INTO sessions (tok, mid, created) VALUES (?, ?, ?)', tok, mid, Date.now()); return tok; }
async function auth(env, tok) {
  if (!tok) return null;
  const s = await one(env, 'SELECT s.mid, s.created, m.name FROM sessions s JOIN members m ON m.id = s.mid WHERE s.tok = ?', str(tok, 64));
  if (!s || s.created < Date.now() - SESSION_DAYS * 86400e3) return null;
  if (s.created < Date.now() - 86400e3) await run(env, 'UPDATE sessions SET created = ? WHERE tok = ?', Date.now(), str(tok, 64)); // 쓰는 동안 로그인 유지
  return { id: s.mid, name: s.name };
}
async function pinHash(salt, pin) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc(salt + ':' + String(pin || ''))))); }
async function sameText(a, b) {
  const [x, y] = await Promise.all([a, b].map(v => crypto.subtle.digest('SHA-256', enc(String(v)))));
  const p = new Uint8Array(x), r = new Uint8Array(y); let d = 0; for (let i = 0; i < p.length; i++) d |= p[i] ^ r[i]; return d === 0;
}
function kstDay(d = new Date()) { return new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10); }
function addDays(day, n) { return new Date(Date.parse(day + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10); }

// ─────────── VAPID 키 ───────────
async function getVapid(env) {
  const row = await one(env, "SELECT v FROM kv WHERE k = 'vapid'");
  if (row) return JSON.parse(row.v);
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const v = { publicKey: b64u(raw), privateJwk: await crypto.subtle.exportKey('jwk', kp.privateKey) };
  await run(env, "INSERT OR IGNORE INTO kv (k, v) VALUES ('vapid', ?)", JSON.stringify(v));
  return JSON.parse((await one(env, "SELECT v FROM kv WHERE k = 'vapid'")).v); // 동시에 만들어져도 하나로
}

async function vapidHeader(endpoint, vapid) {
  const aud = new URL(endpoint).origin;
  const head = b64u(enc(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SITE })));
  const key = await crypto.subtle.importKey('jwk', vapid.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc(head + '.' + claims)));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${vapid.publicKey}`;
}

// ─────────── Web Push 암호화 (RFC 8291, aes128gcm) ───────────
async function encryptPayload(p256dhB64, authB64, text) {
  const uaPub = unb64u(p256dhB64);
  const authSecret = unb64u(authB64);
  const asKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));

  const prkKey = await hmac(authSecret, shared);
  const ikm = await hmac(prkKey, cat(enc('WebPush: info\0'), uaPub, asPub, [1]));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(enc('Content-Encoding: aes128gcm\0'), [1]))).slice(0, 16);
  const nonce = (await hmac(prk, cat(enc('Content-Encoding: nonce\0'), [1]))).slice(0, 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plain = cat(enc(text), [2]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain));
  const header = cat(salt, [0, 0, 16, 0], [asPub.length], asPub); // rs = 4096
  return cat(header, ct);
}

async function webPush(sub, text, authHeader) {
  const body = await encryptPayload(sub.p256dh, sub.auth, text);
  return fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL: '86400',
      Urgency: 'high',
      Authorization: authHeader,
    },
    body,
  });
}

// ─────────── 도구 ───────────
async function hmac(keyBytes, data) {
  const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
function enc(s) { return new TextEncoder().encode(s); }
function cat(...parts) {
  const arrs = parts.map(p => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
function b64u(bytes) {
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
function hex(b) { return [...b].map(x => x.toString(16).padStart(2, '0')).join(''); }
function json(o, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
function cors(r) {
  const h = new Headers(r.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type,X-Admin-Password');
  return new Response(r.body, { status: r.status, headers: h });
}
