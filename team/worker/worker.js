// 해랑 업무 서버 (도장 직원용 협업툴 · Cloudflare Workers 무료 요금제 + D1)
// 화면: https://haerangtkd.github.io/team/
// ─────────────────────────────────────────────
// 필요한 설정 (Cloudflare 대시보드 → 이 Worker → 설정)
//   1) D1 데이터베이스 바인딩: 변수 이름 DB  (업무 전용 데이터베이스 haerang-team)
//   2) (선택) 서비스 바인딩 ATT → haerang-attendance, 비밀 변수 SYNC_KEY ← 출석부 서버와 같은 값
//      → 등원표에 출석부 원생 이름을 쓰고, 채팅 '#등원 ○○ 결석'을 출석부 결석 예정으로 넣음, 원생 메뉴
//   3) (선택) 서비스 바인딩 NOTICE → haerang-push  → 첫 화면 '가입 승인 대기' 수
//      (학부모 앱 행사 신청은 알림 서버 쪽 TEAM 바인딩으로 이 서버를 부름)
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
  'CREATE TABLE IF NOT EXISTS joins (id TEXT PRIMARY KEY, name TEXT, salt TEXT, pin TEXT, status TEXT, mid TEXT, created INTEGER)',
  'CREATE TABLE IF NOT EXISTS reminders (item TEXT, at INTEGER, names TEXT, title TEXT, sent INTEGER DEFAULT 0, PRIMARY KEY (item, at))',
  'CREATE INDEX IF NOT EXISTS reminders_at ON reminders (sent, at)',
  'CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, mid TEXT, kind TEXT, text TEXT, ref TEXT, at INTEGER)',
  'CREATE INDEX IF NOT EXISTS logs_at ON logs (at)',
  'CREATE TABLE IF NOT EXISTS gdocs (path TEXT PRIMARY KEY, data TEXT, upd INTEGER, mid TEXT)', // 기네스 결과지 (guinness.html)
  // 학부모 앱에서 들어온 행사 신청 (ev: 행사표 id, kid: 제자 이름) — state '' 새로 들어옴(행사표에 아직 안 넣음) / 'in' 행사표에 넣음
  'CREATE TABLE IF NOT EXISTS esign (ev TEXT, kid TEXT, data TEXT, rel TEXT, cancel INTEGER DEFAULT 0, state TEXT DEFAULT \'\', at INTEGER, upd INTEGER, PRIMARY KEY (ev, kid))',
  'CREATE INDEX IF NOT EXISTS esign_upd ON esign (upd)',
  // 쉬는 시간에 모아서 보낼 휴대폰 알림
  'CREATE TABLE IF NOT EXISTS pushq (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT, at INTEGER)',
  // 청소 체크 (day: 날짜, task: 청소 이름, mid: 체크한 사람)
  'CREATE TABLE IF NOT EXISTS cleanchk (day TEXT, task TEXT, mid TEXT, at INTEGER, PRIMARY KEY (day, task))',
  // 학부모 앱 '사범님께 연락' (kind: 버튼 종류, act: absent 결석 / in·out 보호자 등·하원, ack: 확인한 직원)
  'CREATE TABLE IF NOT EXISTS pmsg (id INTEGER PRIMARY KEY AUTOINCREMENT, kid TEXT, kind TEXT, label TEXT, act TEXT, who TEXT, why TEXT, text TEXT, day TEXT, rel TEXT, at INTEGER, ack TEXT, ackAt INTEGER, applied INTEGER DEFAULT 0, upd INTEGER)',
  'CREATE INDEX IF NOT EXISTS pmsg_upd ON pmsg (upd)',
  'CREATE TABLE IF NOT EXISTS pushq2 (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT, at INTEGER)', // 밤 9시~아침 8시에 온 연락 → 아침에
  // 숙제 (mode: once 한 번 / daily 기간 동안 매일) + 학부모 체크
  'CREATE TABLE IF NOT EXISTS hw (id TEXT PRIMARY KEY, data TEXT, upd INTEGER, del INTEGER DEFAULT 0, mid TEXT)',
  'CREATE TABLE IF NOT EXISTS hwchk (hw TEXT, kid TEXT, day TEXT, at INTEGER, rel TEXT, PRIMARY KEY (hw, kid, day))',
];
// 학부모 앱 연락 버튼 기본값 (이아빈 계정에서 추가·수정·삭제) — ask: who 누가 / why 사유 / '' 없음, act: 확인할 때 할 일
const RELS = ['엄마', '아빠', '할머니', '할아버지', '이모', '고모', '삼촌', '기타'];
const PTPL0 = [
  { id: 'in', label: '보호자가 등원시킬게요', ask: 'who', act: 'in', reasons: [] },
  { id: 'out', label: '보호자가 하원시킬게요', ask: 'who', act: 'out', reasons: [] },
  { id: 'cond', label: '오늘 컨디션이 안 좋아요', ask: 'why', act: '', reasons: ['감기 기운이 있어요', '배가 아파요', '피곤해해요', '다친 곳이 있어요'] },
  { id: 'abs', label: '오늘 결석할게요', ask: 'why', act: 'absent', reasons: ['아파요', '가족 일정', '학교·학원 일정', '여행'] },
];
// 청소 기본 설정 (이사범님이 설정에서 바꿀 수 있음): 한 주씩 돌아가며, 요일별 청소 + 매일 쓰레기
const CLEAN0 = { start: '2026-11-09', names: ['한코치', '이사범', '김사범'], order: [],
  days: { 월: ['거울'], 화: ['화장실'], 수: ['정수기', '창가 서랍', '창가 근처 먼지 닦기'], 목: ['탈의실 청소', '사무실 바닥 청소'], 금: ['화장실'] },
  daily: ['여자 탈의실 쓰레기 비우기', '사무실 쓰레기 비우기', '화장실 쓰레기 비우기'] };
const ROLES0 = ['사범', '코치', '공용'];
// 학부모 신청 알림을 울려도 되는 때 (평일, 한국 시간): 12:00~14:00, 20:00~21:00 은 바로 / 14:00~20:00 은 쉬는 시간에만
const RING_OPEN = [[12 * 60, 14 * 60], [20 * 60, 21 * 60]];
const RING_BREAK = [[14 * 60 + 50, 15 * 60], [15 * 60 + 50, 16 * 60], [16 * 60 + 50, 17 * 60], [17 * 60 + 50, 18 * 60 + 40], [19 * 60 + 30, 20 * 60]];
function canRing(t = Date.now()) {
  const k = new Date(t + 9 * 3600e3), wd = k.getUTCDay(), m = k.getUTCHours() * 60 + k.getUTCMinutes();
  if (wd === 0 || wd === 6) return false;
  return [...RING_OPEN, ...RING_BREAK].some(([a, z]) => m >= a && m < z);
}
// 예전 표에 새 칸 붙이기 (답장·반응·수정 시각) — 이미 있으면 그냥 넘어감
const ALTERS = ['ALTER TABLE msgs ADD COLUMN reply TEXT', 'ALTER TABLE msgs ADD COLUMN rx TEXT', 'ALTER TABLE msgs ADD COLUMN upd INTEGER', 'ALTER TABLE msgs ADD COLUMN room TEXT'];
// 채팅방: '' = 직원 단체방, 'dm:<id>:<id>' = 1:1 (두 사람 id를 정렬해서)
const roomOk = (room, me) => room === '' || (/^dm:[0-9a-f]+:[0-9a-f]+$/.test(room) && room.split(':').includes(me));
let ready = false, migDone = false;
async function setup(env) {
  if (ready) { if (!migDone) await migrate2026(env).catch(() => {}); return; }
  await env.DB.batch(SCHEMA.map(s => env.DB.prepare(s)));
  const cols = ((await env.DB.prepare('PRAGMA table_info(msgs)').all()).results || []).map(c => c.name);
  for (const a of ALTERS) if (!cols.includes(a.split(' ')[5])) { try { await env.DB.prepare(a).run(); } catch (_) {} }
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS msgs_upd ON msgs (upd)').run();
  const mcols = ((await env.DB.prepare('PRAGMA table_info(members)').all()).results || []).map(c => c.name);
  if (!mcols.includes('asrc')) { try { await env.DB.prepare('ALTER TABLE members ADD COLUMN asrc TEXT').run(); } catch (_) {} } // 출석부 PIN(암호화 값)을 마지막으로 가져온 것
  // boss: 직원 관리 권한(이사범님) · role: 직책 · mustpin: 처음 들어오면 PIN 바꾸기 · aid: 출석부 사범님 id · shared: 공용 계정
  for (const [c, t] of [['boss', 'INTEGER DEFAULT 0'], ['role', 'TEXT'], ['mustpin', 'INTEGER DEFAULT 0'], ['aid', 'TEXT'], ['shared', 'INTEGER DEFAULT 0']])
    if (!mcols.includes(c)) { try { await env.DB.prepare('ALTER TABLE members ADD COLUMN ' + c + ' ' + t).run(); } catch (_) {} }
  ready = true;
  await migrate2026(env).catch(() => {});
}
// 한 번만: 이사범님 권한, 직책, 실명으로 이름 바꾸기, 공용 계정, 청소 순서
async function migrate2026(env) {
  if (await one(env, "SELECT v FROM kv WHERE k = 'mig2026a'")) { migDone = true; return; }
  const mem = await all(env, 'SELECT id, name, role, boss, aid, shared FROM members');
  if (!mem.length) return; // 처음 설정 전
  if (env.ATT) { // 출석부 사범님과 id로 묶기 (이름을 바꿔도 다시 생기지 않게)
    const r = await attSync(env, '/sync/teachers', {}); if (!r.ok) return; // 출석부가 안 되면 다음에 다시
    for (const t of r.teachers || []) { const m = mem.find(x => x.name === t.name && !x.aid); if (m) { m.aid = t.id; await run(env, 'UPDATE members SET aid = ? WHERE id = ?', t.id, m.id); } }
  }
  if (!mem.some(m => m.boss)) { const b = mem.find(m => m.name === '이사범' || m.name === '이아빈'); if (b) await run(env, 'UPDATE members SET boss = 1 WHERE id = ?', b.id); }
  const ROLE = { 이사범: '사범', 한코치: '코치', 김사범: '사범' }, NEW = { 이사범: '이아빈', 한코치: '한채원', 김사범: '김병수' };
  const ids = {};
  for (const m of mem) {
    if (ROLE[m.name] && !m.role) await run(env, 'UPDATE members SET role = ? WHERE id = ?', ROLE[m.name], m.id);
    if (NEW[m.name] && !mem.some(x => x.name === NEW[m.name])) { await renameMember(env, m.id, m.name, NEW[m.name]); ids[m.name] = m.id; }
    else if (NEW[m.name]) ids[m.name] = m.id;
  }
  if (!mem.some(m => m.shared)) { const salt = rid(8); await run(env, 'INSERT INTO members (id, name, salt, pin, created, role, shared) VALUES (?, ?, ?, ?, ?, ?, 1)', rid(8), '도장 공용', salt, await pinHash(salt, '0000'), Date.now(), '공용'); }
  if (!(await one(env, "SELECT v FROM kv WHERE k = 'clean'"))) {
    const c = { ...CLEAN0, since: kstDay(), order: CLEAN0.names.map(n => ids[n]).filter(Boolean) }; delete c.names;
    await run(env, "INSERT INTO kv (k, v) VALUES ('clean', ?)", JSON.stringify(c));
  }
  await run(env, "INSERT INTO kv (k, v) VALUES ('mig2026a', ?) ON CONFLICT(k) DO NOTHING", String(Date.now())); migDone = true;
}
// 이름 바꾸기: 업무의 담당자·알림 받을 사람 이름도 같이 바꿈
async function renameMember(env, id, from, to) {
  await run(env, 'UPDATE members SET name = ? WHERE id = ?', to, id);
  const st = [], now = Date.now();
  for (const it of await all(env, "SELECT id, data FROM items WHERE type = 'todo' AND del = 0")) {
    const d = J(it.data, {}); let ch = false;
    if (Array.isArray(d.whos) && d.whos.includes(from)) { d.whos = d.whos.map(n => n === from ? to : n); ch = true; }
    if (d.who === from) { d.who = to; ch = true; }
    for (const r of d.reminders || []) if (Array.isArray(r.to) && r.to.includes(from)) { r.to = r.to.map(n => n === from ? to : n); ch = true; }
    if (ch) st.push(q(env, 'UPDATE items SET data = ?, upd = ? WHERE id = ?', JSON.stringify(d), now, it.id));
  }
  for (const r of await all(env, 'SELECT item, at, names FROM reminders WHERE sent = 0')) { const n = J(r.names, []); if (n.includes(from)) st.push(q(env, 'UPDATE reminders SET names = ? WHERE item = ? AND at = ?', JSON.stringify(n.map(x => x === from ? to : x)), r.item, r.at)); }
  if (st.length) await env.DB.batch(st);
}

export default {
  // 5분마다: 때가 된 업무 알림 보내기 (Cloudflare → Triggers → Cron '*/5 * * * *')
  async scheduled(event, env, ctx) { ctx.waitUntil((async () => { await setup(env); await runReminders(env); await runPushQueue(env); await runTimed(env); })().catch(() => {})); },
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
  // ═════════ 알림 서버(학부모 앱)에서 부름 — 서비스 바인딩 + SYNC_KEY ═════════
  if (path.startsWith('/sync/')) {
    if (!env.SYNC_KEY || !(await sameText(req.headers.get('X-Sync-Key') || '', env.SYNC_KEY))) return json({ ok: false, error: 'sync key' }, 401);
    const kids = (Array.isArray(b.kids) ? b.kids : []).map(x => str(x, 20)).filter(Boolean).slice(0, 10);
    if (path === '/sync/events') return json({ ok: true, events: await openEvents(env, kids) });
    if (path === '/sync/ptpl') return json({ ok: true, tpl: await ptplGet(env), rels: RELS, msgs: kids.length ? (await all(env, 'SELECT id, kid, label, who, why, text, day, at, ack, ackAt FROM pmsg WHERE kid IN (' + kids.map(() => '?').join(',') + ') ORDER BY id DESC LIMIT 10', ...kids)).map(r => ({ ...r, ack: !!r.ack })) : [] });
    if (path === '/sync/pmsg-send') return json(await pmsgSend(env, b, kids, ctx));
    if (path === '/sync/hw') return json({ ok: true, hw: await hwFor(env, kids) });
    if (path === '/sync/hw-check') {
      const kid = str(b.kid, 20), id = str(b.hw, 40), day = isDay(b.day) ? b.day : kstDay(); if (!kids.includes(kid)) return json({ ok: false, error: '제자 이름을 확인해 주세요' });
      const h = await one(env, 'SELECT data FROM hw WHERE id = ? AND del = 0', id); if (!h) return json({ ok: false, error: '지워진 숙제예요' });
      const d = J(h.data, {}), key = d.mode === 'daily' ? day : '';
      if (d.mode === 'daily' && (day < d.start || (d.end && day > d.end) || day > kstDay())) return json({ ok: false, error: '숙제 기간이 아니에요' });
      if (b.on) await run(env, 'INSERT OR REPLACE INTO hwchk (hw, kid, day, at, rel) VALUES (?, ?, ?, ?, ?)', id, kid, key, Date.now(), str(b.rel, 10));
      else await run(env, 'DELETE FROM hwchk WHERE hw = ? AND kid = ? AND day = ?', id, kid, key);
      await run(env, 'UPDATE hw SET upd = ? WHERE id = ?', Date.now(), id);
      return json({ ok: true });
    }
    if (path === '/sync/esign-set') return json(await esignSet(env, b, kids));
    return json({ ok: false, error: 'not found' }, 404);
  }
  if (!path.startsWith('/api/')) return json({ ok: true, app: '해랑 업무' });

  // ═════════ 로그인 전 ═════════
  if (path === '/api/vapid') return json({ ok: true, publicKey: (await getVapid(env)).publicKey });
  if (path === '/api/members') {
    await importTeachers(env);
    const m = await all(env, 'SELECT id, name, role, shared FROM members ORDER BY shared, created');
    return json({ ok: true, members: m, needSetup: !m.length });
  }
  if (path === '/api/setup') { // 처음 한 번: 첫 사람 만들기 (아무도 없을 때만)
    if ((await one(env, 'SELECT COUNT(*) AS n FROM members')).n) return json({ ok: false, error: '이미 설정되어 있습니다' });
    const r = await addMember(env, b.name, b.pin); if (!r.ok) return json(r);
    return json({ ok: true, tok: await newSession(env, r.id), name: r.name });
  }
  // 새 사람: 이름·PIN으로 들어가기 요청 → 이미 있는 사람이 승인하면 들어감
  if (path === '/api/join-request') {
    if (await one(env, 'SELECT id FROM members LIMIT 1')) return json({ ok: false, error: '새 직원은 이사범님이 설정에서 등록해 드려요' }); // 직원 등록은 이사범님만
    const name = str(b.name, 12).trim(), pin = String(b.pin || '');
    if (!name) return json({ ok: false, error: '이름을 적어 주세요' });
    if (!/^\d{4,6}$/.test(pin)) return json({ ok: false, error: 'PIN은 숫자 4~6자리로 정해 주세요' });
    if (await one(env, 'SELECT id FROM members WHERE name = ?', name)) return json({ ok: false, error: '같은 이름이 이미 있어요. 그 이름을 눌러 PIN으로 들어가 주세요' });
    if ((await one(env, "SELECT COUNT(*) AS n FROM joins WHERE status = 'wait'")).n >= 10) return json({ ok: false, error: '요청이 너무 많아요. 잠시 뒤에 해 주세요' });
    await run(env, "DELETE FROM joins WHERE status = 'wait' AND name = ?", name);
    const id = rid(12), salt = rid(8);
    await run(env, 'INSERT INTO joins (id, name, salt, pin, status, mid, created) VALUES (?, ?, ?, ?, ?, ?, ?)', id, name, salt, await pinHash(salt, pin), 'wait', '', Date.now());
    ctx.waitUntil(pushAll(env, '', '해랑 업무 · 새 사람', name + '님이 들어오려고 해요. 대시보드에서 승인해 주세요', 'home').catch(() => {}));
    return json({ ok: true, id });
  }
  if (path === '/api/join-status') {
    const j = await one(env, 'SELECT * FROM joins WHERE id = ?', str(b.id, 30)); if (!j) return json({ ok: true, status: 'none' });
    if (j.status === 'ok' && j.mid) { await run(env, "UPDATE joins SET status = 'done' WHERE id = ?", j.id); return json({ ok: true, status: 'ok', tok: await newSession(env, j.mid), name: j.name }); }
    return json({ ok: true, status: j.status });
  }
  if (path === '/api/login') {
    const f = await one(env, 'SELECT n, until FROM fails WHERE ip = ?', ip);
    if (f && f.until > Date.now()) return json({ ok: false, error: MAX_FAIL + '번 틀려서 잠겼어요. ' + Math.ceil((f.until - Date.now()) / 1000) + '초 뒤에 다시 해 주세요' }, 429);
    let m = await one(env, 'SELECT * FROM members WHERE id = ?', str(b.mid, 40));
    if (m && !(await sameText(await pinHash(m.salt, b.pin), m.pin))) { await importTeachers(env, true).catch(() => {}); m = await one(env, 'SELECT * FROM members WHERE id = ?', m.id); } // 출석부에서 막 바꾼 PIN일 수 있음
    if (!m || !(await sameText(await pinHash(m.salt, b.pin), m.pin))) {
      const n = (f && f.until && f.until <= Date.now() ? 0 : (f ? f.n : 0)) + 1;
      await run(env, 'INSERT INTO fails (ip, n, until) VALUES (?, ?, ?) ON CONFLICT(ip) DO UPDATE SET n = excluded.n, until = excluded.until', ip, n, n >= MAX_FAIL ? Date.now() + LOCK_MS : 0);
      return json({ ok: false, error: n >= MAX_FAIL ? MAX_FAIL + '번 틀려서 1분 동안 잠겼어요' : 'PIN이 맞지 않아요 (' + n + '/' + MAX_FAIL + '번 틀림)' }, 401);
    }
    if (f) await run(env, 'DELETE FROM fails WHERE ip = ?', ip);
    return json({ ok: true, tok: await newSession(env, m.id), name: m.name, mustPin: !!m.mustpin });
  }

  // ═════════ 로그인 후 ═════════
  const me = await auth(env, b.tok);
  if (!me) return json({ ok: false, error: '다시 로그인해 주세요', relogin: true }, 401);
  if (me.mustpin && !['/api/member-pin', '/api/logout'].includes(path)) return json({ ok: false, mustPin: true, error: '처음 받은 PIN을 내 PIN으로 바꿔 주세요' });
  const needBoss = () => me.boss ? null : json({ ok: false, error: '직원 관리는 이사범님만 할 수 있어요' });
  // ═════════ 기네스 결과지 (team/guinness.html) — 문서 몇 개를 통째로 저장 (app/settings, app/data, app/comments, inputs/P2026-10 …) ═════════
  if (path === '/api/gdoc-get') { const r = await one(env, 'SELECT data FROM gdocs WHERE path = ?', str(b.path, 80)); return json({ ok: true, exists: !!r, data: r ? J(r.data, null) : null }); }
  if (path === '/api/gdoc-list') { const pre = str(b.coll, 30) + '/'; if (!/^[a-z]+\/$/.test(pre)) return json({ ok: false, error: '잘못된 요청' }); const rs = await all(env, 'SELECT path, data FROM gdocs WHERE substr(path, 1, ?) = ?', pre.length, pre); return json({ ok: true, docs: rs.map(r => ({ id: r.path.slice(pre.length), data: J(r.data, null) })) }); }
  if (path === '/api/gdoc-set') {
    const gp = str(b.path, 80); if (!/^(app|inputs)\/[\w-]{1,40}$/.test(gp)) return json({ ok: false, error: '잘못된 요청' });
    const d = JSON.stringify(b.data == null ? null : b.data); if (d.length > 900000) return json({ ok: false, error: '기록이 너무 커요' });
    await run(env, 'INSERT INTO gdocs (path, data, upd, mid) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET data = excluded.data, upd = excluded.upd, mid = excluded.mid', gp, d, Date.now(), me.id);
    return json({ ok: true });
  }
  // 알림 보내기 + (채팅 말고는) 알림 기록에 남기기
  const notify = (title, body, view, ref, to) => {
    ctx.waitUntil((to ? all(env, 'SELECT * FROM subs WHERE mid = ?', to).then(subs => pushTo(env, subs, title, body, view)) : pushAll(env, me.id, title, body, view)).catch(() => {}));
    if (view !== 'chat') ctx.waitUntil(addLog(env, me.id, view, body, ref).catch(() => {}));
  };

  if (path === '/api/logout') { await run(env, 'DELETE FROM sessions WHERE tok = ?', str(b.tok, 64)); return json({ ok: true }); }
  if (path === '/api/join-ok' || path === '/api/join-no') {
    const j = await one(env, "SELECT * FROM joins WHERE id = ? AND status = 'wait'", str(b.id, 30)); if (!j) return json({ ok: false, error: '이미 처리된 요청이에요' });
    if (path === '/api/join-no') { await run(env, "UPDATE joins SET status = 'no' WHERE id = ?", j.id); return json({ ok: true }); }
    if (await one(env, 'SELECT id FROM members WHERE name = ?', j.name)) { await run(env, "UPDATE joins SET status = 'no' WHERE id = ?", j.id); return json({ ok: false, error: '같은 이름이 이미 있어요' }); }
    const mid = rid(8);
    await env.DB.batch([q(env, 'INSERT INTO members (id, name, salt, pin, created) VALUES (?, ?, ?, ?, ?)', mid, j.name, j.salt, j.pin, Date.now()), q(env, "UPDATE joins SET status = 'ok', mid = ? WHERE id = ?", mid, j.id)]);
    notify('해랑 업무 · ' + me.name, j.name + '님이 들어왔어요', 'member');
    return json({ ok: true, name: j.name });
  }
  if (path === '/api/member-add') {
    const nb = needBoss(); if (nb) return nb;
    const r = await addMember(env, b.name, b.pin);
    if (r.ok) { await run(env, 'UPDATE members SET role = ?, mustpin = 1 WHERE id = ?', str(b.role, 20), r.id); notify('해랑 업무 · ' + me.name, r.name + '님을 직원으로 등록했어요', 'member'); }
    return json(r);
  }
  if (path === '/api/member-edit') { // 이사범님: 이름·직책 바꾸기
    const nb = needBoss(); if (nb) return nb;
    const m = await one(env, 'SELECT id, name FROM members WHERE id = ?', str(b.mid, 40)); if (!m) return json({ ok: false, error: '없는 사람이에요' });
    const name = str(b.name, 12).trim(); if (!name) return json({ ok: false, error: '이름을 적어 주세요' });
    if (name !== m.name) { if (await one(env, 'SELECT id FROM members WHERE name = ? AND id <> ?', name, m.id)) return json({ ok: false, error: '같은 이름이 이미 있어요' }); await renameMember(env, m.id, m.name, name); }
    await run(env, 'UPDATE members SET role = ? WHERE id = ?', str(b.role, 20), m.id);
    return json({ ok: true });
  }
  if (path === '/api/roles-set') { // 이사범님: 직책 목록 (추가·이름 바꾸기·삭제)
    const nb = needBoss(); if (nb) return nb;
    const roles = [...new Set((Array.isArray(b.roles) ? b.roles : []).map(x => str(x, 20).trim()).filter(Boolean))].slice(0, 20);
    await run(env, "INSERT INTO kv (k, v) VALUES ('roles', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", JSON.stringify(roles));
    if (b.from && b.to) await run(env, 'UPDATE members SET role = ? WHERE role = ?', str(b.to, 20), str(b.from, 20));
    return json({ ok: true });
  }
  if (path === '/api/clean-set') { // 이사범님: 청소 순서·목록
    const nb = needBoss(); if (nb) return nb;
    const c = b.clean || {}, list = a => (Array.isArray(a) ? a : []).map(x => str(x, 40).trim()).filter(Boolean).slice(0, 12);
    const v = { start: isDay(c.start) ? c.start : CLEAN0.start, since: isDay(c.since) ? c.since : kstDay(), order: list(c.order), days: {}, daily: list(c.daily) };
    for (const w of ['월', '화', '수', '목', '금']) v.days[w] = list((c.days || {})[w]);
    await run(env, "INSERT INTO kv (k, v) VALUES ('clean', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", JSON.stringify(v));
    notify(me.name + ' · 청소', '청소 순서·목록을 바꿨어요', 'home');
    return json({ ok: true });
  }
  if (path === '/api/ptpl-set') { // 이아빈: 학부모 연락 버튼 목록
    const nb = needBoss(); if (nb) return nb;
    const list = (Array.isArray(b.tpl) ? b.tpl : []).slice(0, 12).map(t => ({ id: str(t.id, 20) || rid(4), label: str(t.label, 30).trim(), ask: ['who', 'why', ''].includes(t.ask) ? t.ask : '', act: ['in', 'out', 'absent', ''].includes(t.act) ? t.act : '', reasons: (Array.isArray(t.reasons) ? t.reasons : []).map(x => str(x, 30).trim()).filter(Boolean).slice(0, 10) })).filter(t => t.label);
    await run(env, "INSERT INTO kv (k, v) VALUES ('ptpl', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", JSON.stringify(list));
    return json({ ok: true });
  }
  if (path === '/api/pmsg-ack') { // 학부모 연락 확인 (apply: 결석 → 출석부 결석 예정·픽업표 결석 / 등·하원 → 픽업표 메모)
    const m = await one(env, 'SELECT * FROM pmsg WHERE id = ?', b.id | 0); if (!m) return json({ ok: false, error: '없는 연락이에요' });
    let applied = m.applied;
    if (b.apply && !m.applied && m.act) {
      const why = [m.why, m.text].filter(Boolean).join(' · ').slice(0, 40) || '학부모 연락';
      if (m.act === 'absent') { const r = await attSync(env, '/sync/absence', { items: [{ name: m.kid, date: m.day, why }] }); if (!r.ok || !(r.added || []).length) return json({ ok: false, error: '출석부에 넣지 못했어요 (' + (r.error || '출석부에 없는 이름') + ')' }); }
      await pickupMark(env, m.day, m.kid, m.act, m.act === 'absent' ? '결석 (' + why + ')' : (m.who || m.rel || '보호자') + (m.act === 'in' ? ' 등원' : ' 하원') + (m.text ? ' · ' + m.text : ''), me.name);
      applied = 1;
    }
    await run(env, 'UPDATE pmsg SET ack = ?, ackAt = ?, applied = ?, upd = ? WHERE id = ?', me.name, Date.now(), applied, Date.now(), m.id);
    return json({ ok: true });
  }
  if (path === '/api/hw-save') {
    const d = b.hw || {}, id = str(d.id, 40) || rid(8);
    const v = { title: str(d.title, 60).trim(), body: str(d.body, 1000), mode: d.mode === 'daily' ? 'daily' : 'once', start: isDay(d.start) ? d.start : kstDay(), end: isDay(d.end) ? d.end : '', kids: (Array.isArray(d.kids) ? d.kids : []).map(x => str(x, 20)).filter(Boolean).slice(0, 200) };
    if (!v.title) return json({ ok: false, error: '숙제 이름을 적어 주세요' });
    if (v.end && v.end < v.start) return json({ ok: false, error: '끝나는 날이 시작일보다 빨라요' });
    if (v.mode === 'daily' && !v.end) return json({ ok: false, error: '매일 체크는 끝나는 날을 정해 주세요' });
    await run(env, 'INSERT INTO hw (id, data, upd, del, mid) VALUES (?, ?, ?, 0, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, upd = excluded.upd', id, JSON.stringify(v), Date.now(), me.id);
    notify(me.name + ' · 숙제', '📒 숙제 ' + (d.id ? '수정' : '올림') + ': ' + v.title, 'home');
    return json({ ok: true, id });
  }
  if (path === '/api/hw-notify') { // 학부모님께 숙제 알림 (6명씩 나눠서, 화면이 next 로 이어서 부름)
    const h = await one(env, 'SELECT data FROM hw WHERE id = ? AND del = 0', str(b.id, 40)); if (!h) return json({ ok: false, error: '없는 숙제예요' });
    const v = J(h.data, {});
    return json(await noticeSync(env, '/sync/broadcast', { title: '📒 숙제: ' + v.title, body: (v.mode === 'daily' ? (+v.start.slice(5, 7)) + '/' + (+v.start.slice(8)) + '~' + (+v.end.slice(5, 7)) + '/' + (+v.end.slice(8)) + ' 매일 · ' : '') + (v.body || '해 보면 좋아요. 학부모 앱에서 체크해 주세요').slice(0, 120), children: v.kids, offset: b.offset | 0 }));
  }
  if (path === '/api/hw-del') { await run(env, 'UPDATE hw SET del = 1, upd = ? WHERE id = ?', Date.now(), str(b.id, 40)); return json({ ok: true }); }
  if (path === '/api/clean-check') { // 그 주 청소 담당자만 체크
    const day = isDay(b.day) ? b.day : kstDay(), task = str(b.task, 40), c = await cleanConf(env), who = cleanWho(c, day);
    if (who !== me.id) return json({ ok: false, error: '이번 주 청소 담당자만 체크할 수 있어요' });
    if (!cleanTasks(c, day).includes(task)) return json({ ok: false, error: '없는 청소예요' });
    if (b.on) await run(env, 'INSERT OR REPLACE INTO cleanchk (day, task, mid, at) VALUES (?, ?, ?, ?)', day, task, me.id, Date.now());
    else await run(env, 'DELETE FROM cleanchk WHERE day = ? AND task = ?', day, task);
    await bumpKv(env);
    return json({ ok: true });
  }
  if (path === '/api/pickup-check') { // 오늘 등원·픽업 확인 (아무 직원 한 명)
    const day = isDay(b.day) ? b.day : kstDay();
    await run(env, 'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', 'pkchk:' + day, JSON.stringify(b.off ? null : { by: me.name, at: Date.now() }));
    await bumpKv(env);
    if (!b.off) ctx.waitUntil(addLog(env, me.id, 'pickup', '✓ ' + day.slice(5).replace('-', '/') + ' 등원·픽업 확인', day).catch(() => {}));
    return json({ ok: true });
  }
  // 내려받기 비밀번호 (출석부 서버에 보관) — 정하기는 이사범님만, 확인은 누구나
  if (path === '/api/dlpin-set') { const nb = needBoss(); if (nb) return nb; return json(await attSync(env, '/sync/dlpin-set', { pin: String(b.pin || '') })); }
  if (path === '/api/dl-check') return json(await attSync(env, '/sync/dlpin-check', { pin: String(b.pin || ''), who: me.name }));
  if (path === '/api/member-pin') { // 내 PIN 바꾸기, 또는 다른 사람 PIN 새로 정하기
    const pin = String(b.pin || '');
    if (!/^\d{4,6}$/.test(pin)) return json({ ok: false, error: 'PIN은 숫자 4~6자리로 정해 주세요' });
    const mid = str(b.mid || me.id, 40), salt = rid(8);
    if (mid !== me.id) { const nb = needBoss(); if (nb) return nb; }
    if (mid === me.id) { const m = await one(env, 'SELECT * FROM members WHERE id = ?', me.id); if (!(await sameText(await pinHash(m.salt, b.old), m.pin))) return json({ ok: false, error: '지금 PIN이 맞지 않아요' }); if (await sameText(await pinHash(m.salt, pin), m.pin)) return json({ ok: false, error: '지금과 다른 PIN으로 정해 주세요' }); }
    await run(env, 'UPDATE members SET salt = ?, pin = ?, mustpin = ? WHERE id = ?', salt, await pinHash(salt, pin), mid === me.id ? 0 : 1, mid);
    if (mid !== me.id) await run(env, 'DELETE FROM sessions WHERE mid = ?', mid);
    return json({ ok: true });
  }
  if (path === '/api/member-del') {
    const nbd = needBoss(); if (nbd) return nbd;
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
      all(env, 'SELECT id, name, role, boss, shared FROM members ORDER BY shared, created'),
      first ? all(env, 'SELECT * FROM (SELECT id, mid, text, photo, refs, reply, rx, upd, at, room FROM msgs WHERE (room IS NULL OR room = \'\' OR instr(room, ?) > 0) ORDER BY id DESC LIMIT 300) ORDER BY id', me.id) : all(env, 'SELECT id, mid, text, photo, refs, reply, rx, upd, at, room FROM msgs WHERE (id > ? OR (upd > ? AND id <= ?)) AND (room IS NULL OR room = \'\' OR instr(room, ?) > 0) ORDER BY id LIMIT 300', lastMsg, since, lastMsg, me.id),
      all(env, 'SELECT id, type, data, upd, del, mid FROM items WHERE upd > ?' + (first ? ' AND del = 0' : ''), since),
      all(env, 'SELECT id, item, mid, text, at FROM comments WHERE at > ?', since),
      all(env, 'SELECT day, data, upd FROM pickup WHERE upd > ? AND day >= ?', since, addDays(kstDay(), -7)),
      first ? all(env, 'SELECT * FROM (SELECT id, mid, kind, text, ref, at FROM logs ORDER BY id DESC LIMIT 120) ORDER BY id') : all(env, 'SELECT id, mid, kind, text, ref, at FROM logs WHERE at > ? ORDER BY id LIMIT 200', since),
    ]);
    const joins = await all(env, "SELECT id, name, created FROM joins WHERE status = 'wait' AND created > ?", Date.now() - 7 * 86400e3);
    const esigns = (await all(env, 'SELECT ev, kid, data, rel, cancel, state, at, upd FROM esign WHERE upd > ?', first ? Date.now() - 120 * 86400e3 : since)).map(r => ({ ...r, data: J(r.data, {}) }));
    const td = kstDay(), kvs = await all(env, "SELECT k, v FROM kv WHERE k IN ('pickupDefault', 'pickupTimes', 'notice', 'clean', 'roles', ?)", 'pkchk:' + td), kv = k => (kvs.find(x => x.k === k) || {}).v;
    const cleanchk = await all(env, 'SELECT day, task, mid, at FROM cleanchk WHERE day >= ?', addDays(td, -14));
    const pmsg = await all(env, 'SELECT * FROM pmsg WHERE upd > ? AND at > ?', since, Date.now() - 60 * 86400e3);
    const hws = await all(env, 'SELECT id, data, upd, del, mid FROM hw WHERE upd > ?', since), hwchk = hws.length ? await all(env, 'SELECT hw, kid, day, at, rel FROM hwchk WHERE hw IN (' + hws.map(() => '?').join(',') + ')', ...hws.map(h => h.id)) : [];
    return json({ ok: true, now: Date.now(), me, members,
      msgs: msgs.map(fixMsg), logs, joins, esigns, notice: J(kv('notice'), null),
      clean: J(kv('clean'), null), cleanchk, roles: J(kv('roles'), ROLES0), pmsg, ptpl: await ptplGet(env), rels: RELS,
      hw: hws.map(h => ({ id: h.id, upd: h.upd, del: !!h.del, mid: h.mid, ...J(h.data, {}), chk: hwchk.filter(c => c.hw === h.id) })), pkchk: { day: td, v: J(kv('pkchk:' + td), null) },
      items: items.map(i => ({ id: i.id, type: i.type, del: !!i.del, upd: i.upd, mid: i.mid, ...J(i.data, {}) })).map(i => canSee(i, me) ? i : { id: i.id, type: i.type, del: true, upd: i.upd }).filter(i => !(first && i.del)),
      comments, pickup: pickup.map(p => ({ day: p.day, upd: p.upd, ...J(p.data, {}) })), pickupDefault: J(kv('pickupDefault'), {}), pickupTimes: J(kv('pickupTimes'), {}) });
  }
  if (path === '/api/more-msgs') return json({ ok: true, msgs: (await all(env, 'SELECT id, mid, text, photo, refs, reply, rx, upd, at, room FROM msgs WHERE id < ? AND coalesce(room, \'\') = ? ORDER BY id DESC LIMIT 100', b.before | 0, roomOk(String(b.room || ''), me.id) ? String(b.room || '') : '')).reverse().map(fixMsg) });

  // 채팅 (해시태그로 만든 항목은 refs 로 연결)
  if (path === '/api/msg') {
    const text = str(b.text, 2000).trim(), photo = /^[0-9a-f]{24}$/.test(b.photo || '') ? b.photo : '', room = String(b.room || '');
    if (!roomOk(room, me.id)) return json({ ok: false, error: '채팅방' });
    if (!text && !photo) return json({ ok: false, error: '빈 메시지' });
    const st = [], refs = [];
    for (const it of (Array.isArray(b.items) ? b.items : []).slice(0, 5)) { const r = itemStmt(env, it, me); if (r) { st.push(r.stmt); refs.push({ id: r.id, type: r.type, title: r.title }); } }
    for (const p of (Array.isArray(b.pickups) ? b.pickups : []).slice(0, 3)) if (isDay(p.day)) st.push(q(env, 'INSERT INTO pickup (day, data, upd) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET data = excluded.data, upd = excluded.upd', p.day, JSON.stringify(cleanPickup(p)), Date.now()));
    if (st.length) await env.DB.batch(st);
    let reply = '';
    if (b.reply) { const o = await one(env, 'SELECT id, mid, text, photo FROM msgs WHERE id = ?', b.reply | 0); if (o) reply = JSON.stringify({ id: o.id, mid: o.mid, text: str(o.text || (o.photo ? '사진' : ''), 80) }); }
    const now = Date.now();
    const r = await run(env, 'INSERT INTO msgs (mid, text, photo, refs, reply, rx, upd, at, room) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', me.id, text, photo, JSON.stringify(refs), reply, '{}', now, now, room);
    for (const x of refs) ctx.waitUntil(addLog(env, me.id, x.type, TYPE_KO[x.type] + ' 추가: ' + x.title, x.id).catch(() => {}));
    // 출석부에 결석 예정 넣기 (#등원 ○○ 결석)
    if (Array.isArray(b.absences) && b.absences.length) ctx.waitUntil(attSync(env, '/sync/absence', { items: b.absences.slice(0, 10) }).catch(() => {}));
    const to = room ? room.split(':').slice(1).find(x => x !== me.id) : '';
    notify(room ? me.name + ' (1:1)' : me.name, photo && !text ? '사진을 보냈어요' : text.slice(0, 120), 'chat', '', to);
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
  if (path === '/api/msg-ref') { // 메시지로 만든 일정·업무를 그 메시지 아래에 연결
    const m = await one(env, 'SELECT refs FROM msgs WHERE id = ?', b.id | 0); const r = b.ref || {};
    if (!m || !TYPES.includes(r.type) || !(await one(env, 'SELECT id FROM items WHERE id = ?', str(r.id, 40)))) return json({ ok: false, error: '연결하지 못했어요' });
    const refs = J(m.refs, []).filter(x => x.id !== r.id).concat({ id: str(r.id, 40), type: r.type, title: str(r.title, 100) }).slice(-5);
    await run(env, 'UPDATE msgs SET refs = ?, upd = ? WHERE id = ?', JSON.stringify(refs), Date.now(), b.id | 0);
    return json({ ok: true, refs });
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

  // ═════════ 원생 (출석부 원생 기록을 그대로 읽고 씀) ═════════
  if (path === '/api/students') return json(await attSync(env, '/sync/students', {}));
  if (path === '/api/student-save') return json(await attSync(env, '/sync/student-save', { student: b.student, history: b.history, upd: b.upd, who: me.name }));
  if (path === '/api/student-history') return json(await attSync(env, '/sync/history', { sid: str(b.sid, 60) }));
  // 첫 화면 카드: 학부모 앱 가입 승인 대기 수
  if (path === '/api/dash') { const r = await noticeSync(env, '/sync/pending', {}); return json({ ok: true, pending: r.ok ? r.pending : null }); }

  // 할 일 · 일정 · 행사표 · 구매표 저장 (what: 알림에 쓸 한 줄)
  if (path === '/api/item') {
    const r = itemStmt(env, b.item || {}, me); if (!r) return json({ ok: false, error: '제목을 적어 주세요' });
    await r.stmt.run();
    if (r.type === 'event') { // 행사표에 들어간 학부모 신청은 '넣음'으로
      const names = (Array.isArray(b.item.rows) ? b.item.rows : []).map(x => str(x && x.name, 20)).filter(Boolean).slice(0, 200);
      if (names.length) await run(env, "UPDATE esign SET state = 'in' WHERE ev = ? AND state = '' AND kid IN (" + names.map(() => '?').join(',') + ')', r.id, ...names);
    }
    // 업무 알림 (앞으로 올 것만 다시 적음)
    const now0 = Date.now(), it0 = b.item;
    let rems = (Array.isArray(it0.reminders) ? it0.reminders : []).map(x => ({ ...x, at: Number(x.at) }));
    if (r.type === 'sched' && it0.repeat) rems = rems.map(x => { // 반복 일정: 지난 알림은 다음 회차로 옮겨서 다시 걸기
      let at = x.at; for (let i = 0; i < 800 && at < now0 - 60000; i++) { const day = new Date(at + 9 * 3600e3).toISOString().slice(0, 10), nd = nextDay(day, it0.repeat); if (!nd || (it0.repEnd && nd > addDays(it0.repEnd, 1))) { at = 0; break; } at += Date.parse(nd) - Date.parse(day); }
      return { ...x, at }; });
    rems = rems.filter(x => x.at > now0 - 60000).slice(0, 10);
    await env.DB.batch([q(env, 'DELETE FROM reminders WHERE item = ? AND sent = 0', r.id), ...(b.item.done ? [] : rems.map(x => q(env, 'INSERT OR REPLACE INTO reminders (item, at, names, title, sent) VALUES (?, ?, ?, ?, 0)', r.id, Number(x.at), JSON.stringify((Array.isArray(x.to) ? x.to : []).map(n => str(n, 12)).slice(0, 10)), r.title)))]);
    const sh = b.item.share || '';
    if (sh && b.what !== false) { // 나만/담당자만 보는 업무는 볼 수 있는 사람에게만 알림, 기록 안 남김
      const ok = (await all(env, 'SELECT id, name FROM members')).filter(m => m.id !== me.id && canSee({ ...b.item, mid: b.item.mid || me.id }, m)).map(m => m.id);
      if (ok.length) ctx.waitUntil(all(env, 'SELECT * FROM subs WHERE mid IN (' + ok.map(() => '?').join(',') + ')', ...ok).then(subs => pushTo(env, subs, me.name, String(b.what || r.title).slice(0, 140), r.type)).catch(() => {}));
      return json({ ok: true, id: r.id, upd: r.upd });
    }
    if (b.what !== false) notify(me.name, String(b.what || (b.item.id ? r.title + ' 수정' : TYPE_KO[r.type] + ' 추가: ' + r.title)).slice(0, 140), r.type, r.id);
    return json({ ok: true, id: r.id, upd: r.upd });
  }
  if (path === '/api/item-del') {
    const it = await one(env, 'SELECT type, data FROM items WHERE id = ?', str(b.id, 40)); if (!it) return json({ ok: true });
    await run(env, 'UPDATE items SET del = 1, upd = ? WHERE id = ?', Date.now(), str(b.id, 40));
    await run(env, 'DELETE FROM reminders WHERE item = ?', str(b.id, 40));
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
    if (b.times && typeof b.times === 'object') { // 요일별 데리러 가는 시간 {월: {이름: '13:30'}}
      const t = {}; for (const w of ['월', '화', '수', '목', '금']) { t[w] = {}; for (const n of d[w]) { const v = String((b.times[w] || {})[n] || ''); if (/^\d{2}:\d{2}$/.test(v)) t[w][n] = v; } }
      await run(env, "INSERT INTO kv (k, v) VALUES ('pickupTimes', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", JSON.stringify(t));
    }
    return json({ ok: true });
  }
  if (path === '/api/pickup') {
    if (!isDay(b.day)) return json({ ok: false, error: '날짜' });
    const d = cleanPickup(b), upd = Date.now();
    await run(env, 'INSERT INTO pickup (day, data, upd) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET data = excluded.data, upd = excluded.upd', b.day, JSON.stringify(d), upd);
    if (b.what) notify(me.name + ' · 등원', String(b.what).slice(0, 140), 'pickup', b.day);
    return json({ ok: true, upd });
  }
  if (path === '/api/pickup-absent') { // 등원표: 출석부에서 결석인 아이
    const r = await attSync(env, '/sync/day-absent', { day: isDay(b.day) ? b.day : kstDay() });
    return json(r.ok ? { ok: true, names: r.names || [] } : { ok: false, names: [] });
  }
  if (path === '/api/roster-all') { // 출석부 원생 회원 상태 (퇴관 포함) — 등원표에서 휴원·퇴관 빼기, 기네스 결과지 회원 상태
    const r = await attSync(env, '/sync/roster', { all: true });
    return json(r.ok ? { ok: true, students: r.students.map(s => ({ name: s.name, birth: s.birth || '', status: s.status || '재원' })) } : { ok: false, students: [], error: r.error });
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
// 출석부 사범님을 업무 앱 사람으로 (이름이 없으면 추가, 출석부와 같은 PIN). 10분에 한 번만 확인 (force면 바로)
// 출석부에서 PIN을 바꾸면 업무 앱 PIN도 따라 바뀜 (asrc = 마지막으로 가져온 출석부 PIN 값). 업무 앱에서 따로 바꾼 PIN은 출석부 PIN이 다시 바뀔 때까지 그대로.
async function importTeachers(env, force) {
  const k = await one(env, "SELECT v FROM kv WHERE k = 'tImport'"); if (!force && k && Date.now() - Number(k.v) < 600000) return;
  const r = await attSync(env, '/sync/teachers', {}); if (!r.ok || !Array.isArray(r.teachers)) return;
  await run(env, "INSERT INTO kv (k, v) VALUES ('tImport', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", String(Date.now()));
  const rows = await all(env, 'SELECT id, name, asrc, aid FROM members'), st = [];
  for (const t of r.teachers) {
    if (!t.name || !t.salt || !t.pin) continue; const src = t.salt + ':' + t.pin;
    const m = rows.find(x => x.aid && x.aid === t.id) || rows.find(x => !x.aid && x.name === t.name); // 이름을 바꿔도 출석부 사범님과 id로 이어짐
    if (!m) { if (rows.some(x => x.name === t.name)) continue; const id = rid(8); st.push(q(env, 'INSERT INTO members (id, name, salt, pin, created, asrc, aid) VALUES (?, ?, ?, ?, ?, ?, ?)', id, str(t.name, 12), t.salt, t.pin, Date.now(), src, str(t.id, 40))); rows.push({ id, name: t.name, asrc: src, aid: t.id }); }
    else if (m.asrc !== src) st.push(q(env, 'UPDATE members SET salt = ?, pin = ?, asrc = ?, aid = ? WHERE id = ?', t.salt, t.pin, src, str(t.id, 40), m.id));
    else if (!m.aid) st.push(q(env, 'UPDATE members SET aid = ? WHERE id = ?', str(t.id, 40), m.id));
  }
  if (st.length) await env.DB.batch(st);
}
// 공유: '' 모두 / 'members' 만든 사람+담당자 / 'private' 만든 사람만
function canSee(i, m) { const s = i.share || ''; if (!s || i.del) return true; if (i.mid === m.id) return true; if (s === 'members') return (Array.isArray(i.whos) ? i.whos : []).includes(m.name); return false; }
async function runReminders(env) {
  const now = Date.now(), due = await all(env, 'SELECT * FROM reminders WHERE sent = 0 AND at <= ? ORDER BY at LIMIT 20', now);
  if (!due.length) return;
  const members = await all(env, 'SELECT id, name FROM members');
  for (const r of due) {
    await run(env, 'UPDATE reminders SET sent = 1 WHERE item = ? AND at = ?', r.item, r.at);
    if (r.at < now - 3 * 3600e3) continue; // 너무 늦은 건 건너뜀
    const it = await one(env, 'SELECT type, data, del FROM items WHERE id = ?', r.item); if (!it || it.del) continue;
    const d = J(it.data, {}); if (d.done) continue;
    const sched = d.repeat && it.type === 'sched';
    if (sched) { // 반복 일정: 같은 시간 차이로 다음 회차 알림을 다시 걸어 둠
      const day = new Date(r.at + 9 * 3600e3).toISOString().slice(0, 10), nd = nextDay(day, d.repeat), at2 = nd ? r.at + (Date.parse(nd) - Date.parse(day)) : 0;
      if (at2 && (!d.repEnd || nd <= addDays(d.repEnd, 1))) await run(env, 'INSERT OR IGNORE INTO reminders (item, at, names, title, sent) VALUES (?, ?, ?, ?, 0)', r.item, at2, r.names, r.title);
    }
    let ids = members.filter(m => J(r.names, []).includes(m.name)).map(m => m.id); if (!ids.length) continue;
    const subs = await all(env, 'SELECT * FROM subs WHERE mid IN (' + ids.map(() => '?').join(',') + ')', ...ids);
    if (it.type === 'sched') await pushTo(env, subs, '⏰ 일정 알림', (d.title || r.title) + (d.time ? ' · ' + d.time : ''), 'sched');
    else await pushTo(env, subs, '⏰ 업무 알림', (d.title || r.title) + (d.due ? ' · ' + d.due.slice(5).replace('-', '/') + ' 까지' : ''), 'todo');
  }
  if (Math.random() < 0.05) await run(env, 'DELETE FROM reminders WHERE sent = 1 AND at < ?', now - 30 * 86400e3);
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
  if (env.TEST_PUSH) { env.TEST_PUSH.push({ title, body, to: subs.map(x => x.mid) }); return { sent: subs.length, total: subs.length }; } // 컴퓨터 시험용
  if (!subs.length) return { sent: 0, total: 0 };
  const vapid = await getVapid(env), auths = new Map();
  const tab = { chat: 'chat', notice: 'chat', sched: 'cal', event: 'table', buy: 'table', home: 'home', pickup: 'home', todo: 'home' }[view] || 'log';
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

async function noticeSync(env, path, body) {
  if (!env.NOTICE || !env.SYNC_KEY) return { ok: false, error: '알림 앱이 연결되지 않았어요' };
  try { const r = await env.NOTICE.fetch('https://notice' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sync-Key': env.SYNC_KEY }, body: JSON.stringify(body) }); return await r.json(); }
  catch (_) { return { ok: false, error: '알림 앱에 연결하지 못했어요' }; }
}

// ─────────── 학부모 앱 행사 신청 ───────────
// 행사표 설정: pub(학부모 앱에 신청 받기), openAt(신청 시작일), closeAt(신청 마감일), desc(안내)
function evWindow(d, day) {
  const close = d.closeAt || (d.date ? addDays(d.date, -1) : '');
  return { open: !d.openAt || d.openAt <= day, canEdit: !close || day <= close, close };
}
async function openEvents(env, kids) {
  const day = kstDay(), rows = await all(env, "SELECT id, data FROM items WHERE type = 'event' AND del = 0");
  const mine = kids.length ? await all(env, 'SELECT ev, kid, data, cancel, at FROM esign WHERE kid IN (' + kids.map(() => '?').join(',') + ')', ...kids) : [];
  const out = [];
  for (const r of rows) {
    const d = J(r.data, {}); if (!d.pub || d.closed || d.kind === 'goods') continue;
    const w = evWindow(d, day); if (!w.open || (d.date && d.date < day)) continue;
    const staff = new Set((d.rows || []).map(x => x.name));
    out.push({ id: r.id, title: d.title, date: d.date || '', desc: str(d.desc, 1000), base: +d.base || 0, products: (d.products || []).map(p => ({ n: p.n, p: +p.p || 0 })), options: (d.options || []).map(o => ({ n: o.n, c: o.c || [] })), van: !!d.van, close: w.close, canEdit: w.canEdit,
      mine: kids.map(k => { const m = mine.find(x => x.ev === r.id && x.kid === k); return { kid: k, applied: !!(m && !m.cancel) || (!m && staff.has(k)), byStaff: !m && staff.has(k), cancel: !!(m && m.cancel), data: m ? J(m.data, {}) : null }; }) });
  }
  return out.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
}
async function esignSet(env, b, kids) {
  const kid = str(b.kid, 20), ev = str(b.ev, 40);
  if (!kids.includes(kid)) return { ok: false, error: '제자 이름을 확인해 주세요' };
  const it = await one(env, "SELECT data FROM items WHERE id = ? AND type = 'event' AND del = 0", ev); if (!it) return { ok: false, error: '없어진 행사예요' };
  const d = J(it.data, {}), day = kstDay(), w = evWindow(d, day);
  if (!d.pub || d.closed || !w.open) return { ok: false, error: '지금은 신청을 받지 않아요' };
  if (!w.canEdit) return { ok: false, error: '신청 기간이 끝났어요. 바꾸실 내용은 도장에 문자로 알려 주세요' };
  const x = b.data || {}, ps = d.products || [];
  const data = { prods: (Array.isArray(x.prods) ? x.prods : []).map(n => n | 0).filter(n => n >= 0 && n < ps.length), opts: {}, van: x.van === true ? true : x.van === false ? false : null, memo: str(x.memo, 100) };
  for (const o of (d.options || [])) { const v = str((x.opts || {})[o.n], 30); if (v && (!o.c.length || o.c.includes(v))) data.opts[o.n] = v; }
  const cancel = b.cancel ? 1 : 0, now = Date.now(), had = await one(env, 'SELECT cancel FROM esign WHERE ev = ? AND kid = ?', ev, kid);
  if (cancel && !had) return { ok: true };
  await run(env, "INSERT INTO esign (ev, kid, data, rel, cancel, state, at, upd) VALUES (?, ?, ?, ?, ?, '', ?, ?) ON CONFLICT(ev, kid) DO UPDATE SET data = excluded.data, rel = excluded.rel, cancel = excluded.cancel, state = '', upd = excluded.upd", ev, kid, JSON.stringify(data), str(b.rel, 10), cancel, now, now);
  const what = kid + ' ' + (cancel ? '신청 취소' : had && !had.cancel ? '신청 내용 바꿈' : '신청') + ' (' + (str(b.rel, 10) || '학부모') + ')';
  await addLog(env, '', 'event', '🎟 ' + d.title + ': ' + what + ' · 학부모 앱', ev);
  await run(env, 'INSERT INTO pushq (text, at) VALUES (?, ?)', d.title + ' · ' + what, now);
  await bumpItem(env, ev); // 업무 앱이 새로 받아 가도록
  return { ok: true };
}
// ─────────── 학부모 연락 · 숙제 ───────────
async function ptplGet(env) { const r = await one(env, "SELECT v FROM kv WHERE k = 'ptpl'"); return r ? J(r.v, PTPL0) : PTPL0; }
async function pmsgSend(env, b, kids, ctx) {
  const kid = str(b.kid, 20); if (!kids.includes(kid)) return { ok: false, error: '제자 이름을 확인해 주세요' };
  const tpl = (await ptplGet(env)).find(t => t.id === str(b.tpl, 20)), text = str(b.text, 200).trim();
  if (!tpl && !text) return { ok: false, error: '보낼 내용을 적어 주세요' };
  const day = isDay(b.day) && b.day >= kstDay() && b.day <= addDays(kstDay(), 60) ? b.day : kstDay(), now = Date.now();
  const who = tpl && tpl.ask === 'who' ? str(b.who, 10) : '', why = tpl && tpl.ask === 'why' ? str(b.why, 30) : '';
  const label = tpl ? tpl.label : '직접 쓴 연락';
  if ((await one(env, 'SELECT COUNT(*) AS n FROM pmsg WHERE kid = ? AND at > ?', kid, now - 3600e3)).n >= 10) return { ok: false, error: '연락을 너무 많이 보냈어요. 잠시 뒤에 해 주세요' };
  await run(env, 'INSERT INTO pmsg (kid, kind, label, act, who, why, text, day, rel, at, upd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', kid, tpl ? tpl.id : 'text', label, tpl ? tpl.act : '', who, why, text, day, str(b.rel, 10), now, now);
  const line = kid + ' · ' + label.replace(/오늘 /, day === kstDay() ? '오늘 ' : (+day.slice(5, 7)) + '/' + (+day.slice(8)) + ' ') + (who ? ' (' + who + ')' : '') + (why ? ' · ' + why : '') + (text ? ' · ' + text : '');
  await addLog(env, '', 'pickup', '💬 ' + line + ' · ' + (str(b.rel, 10) || '학부모'), day);
  const h = new Date(now + 9 * 3600e3).getUTCHours();
  if (h >= 8 && h < 21) await pushAll(env, '', '💬 학부모 연락', line, 'home'); else await run(env, 'INSERT INTO pushq2 (text, at) VALUES (?, ?)', line, now);
  return { ok: true };
}
// 픽업표(그날)에 결석·보호자 등하원 적기
async function pickupMark(env, day, kid, act, memo, by) {
  const r = await one(env, 'SELECT data FROM pickup WHERE day = ?', day); let p = r ? J(r.data, {}) : null;
  if (!p) { const def = J((await one(env, "SELECT v FROM kv WHERE k = 'pickupDefault'") || {}).v, {}); p = { list: [...(def[dayW(day)] || [])], done: [], absent: [], memos: [] }; }
  p.list = p.list || []; p.absent = p.absent || []; p.memos = p.memos || []; p.done = p.done || [];
  if (act === 'absent' && !p.absent.includes(kid)) p.absent.push(kid);
  if (act === 'out' || act === 'in') p.memos.push({ who: by, text: kid + ': ' + memo + ' (학부모 연락)', at: Date.now() });
  if (act === 'absent') p.memos.push({ who: by, text: kid + ': ' + memo + ' (학부모 연락)', at: Date.now() });
  const d = cleanPickup(p);
  await run(env, 'INSERT INTO pickup (day, data, upd) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET data = excluded.data, upd = excluded.upd', day, JSON.stringify(d), Date.now());
}
async function hwFor(env, kids) {
  const day = kstDay(), out = [];
  for (const h of await all(env, 'SELECT id, data FROM hw WHERE del = 0')) {
    const d = J(h.data, {}); if (d.start > day || (d.end && d.end < addDays(day, -3))) continue;
    const mine = kids.filter(k => !(d.kids || []).length || d.kids.includes(k)); if (!mine.length) continue;
    const chk = await all(env, 'SELECT kid, day FROM hwchk WHERE hw = ? AND kid IN (' + mine.map(() => '?').join(',') + ')', h.id, ...mine);
    out.push({ id: h.id, title: d.title, body: d.body, mode: d.mode, start: d.start, end: d.end, kids: mine, chk });
  }
  return out.sort((a, b) => (a.end || '9999').localeCompare(b.end || '9999'));
}

// ─────────── 청소 ───────────
async function cleanConf(env) { const r = await one(env, "SELECT v FROM kv WHERE k = 'clean'"); return r ? J(r.v, null) : null; }
const KDAY = ['일', '월', '화', '수', '목', '금', '토'];
const dayW = day => KDAY[new Date(Date.parse(day + 'T00:00:00Z')).getUTCDay()];
function cleanWho(c, day) { if (!c || !(c.order || []).length) return ''; const mon = d => Date.parse(d + 'T00:00:00Z') - ((new Date(Date.parse(d + 'T00:00:00Z')).getUTCDay() + 6) % 7) * 864e5; const w = Math.floor((mon(day) - mon(c.start || day)) / (7 * 864e5)); return c.order[((w % c.order.length) + c.order.length) % c.order.length]; }
function cleanTasks(c, day) { const w = dayW(day); if (!c || !['월', '화', '수', '목', '금'].includes(w)) return []; return [...((c.days || {})[w] || []), ...(c.daily || [])]; }
async function bumpKv(env) { await run(env, "INSERT INTO kv (k, v) VALUES ('kvupd', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", String(Date.now())); }
// ─────────── 정해진 시각 알림 (5분 크론에서, 하루 한 번씩) ───────────
async function onceAt(env, key) { const r = await one(env, 'SELECT v FROM kv WHERE k = ?', key); if (r) return false; await run(env, 'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO NOTHING', key, '1'); return true; }
async function runTimed(env, now = Date.now()) {
  const k = new Date(now + 9 * 3600e3), day = k.toISOString().slice(0, 10), m = k.getUTCHours() * 60 + k.getUTCMinutes(), wd = k.getUTCDay();
  if (m >= 8 * 60 && m < 21 * 60) { const q2 = await all(env, 'SELECT id, text FROM pushq2 ORDER BY id LIMIT 30'); if (q2.length) { await run(env, 'DELETE FROM pushq2 WHERE id <= ?', q2[q2.length - 1].id); await pushAll(env, '', '💬 밤사이 학부모 연락 ' + q2.length + '건', q2.slice(0, 3).map(x => x.text).join('\n') + (q2.length > 3 ? '\n외 ' + (q2.length - 3) + '건' : ''), 'home'); } }
  if (wd === 0 || wd === 6) return;
  const win = h => m >= h && m < h + 20;
  const members = await all(env, 'SELECT id, name FROM members');
  const subsOf = async ids => ids.length ? all(env, 'SELECT * FROM subs WHERE mid IN (' + ids.map(() => '?').join(',') + ')', ...ids) : [];
  // 13:30 등원·픽업 확인
  if (win(13 * 60 + 30) && !(await one(env, 'SELECT v FROM kv WHERE k = ? AND v <> \'null\'', 'pkchk:' + day))) {
    const cl = await attSync(env, '/sync/closed', { day });
    if (!(cl.ok && cl.closed) && await onceAt(env, 'sent:' + day + ':pk')) await pushAll(env, '', '🚌 등원·픽업 확인', '아직 오늘 등원·픽업 확인을 안 했어요. 확인하고 눌러 주세요', 'home');
  }
  // 13시·18시·21시: 날짜 지난 업무 (담당자, 없으면 만든 사람) + 청소
  for (const h of [13, 18, 21]) {
    if (!win(h * 60) || !(await onceAt(env, 'sent:' + day + ':od' + h))) continue;
    const per = new Map(), add = (id, t) => { if (!id) return; if (!per.has(id)) per.set(id, []); per.get(id).push(t); };
    for (const it of await all(env, "SELECT data, mid FROM items WHERE type = 'todo' AND del = 0")) {
      const d = J(it.data, {}), st = d.status === '요청' ? '진행' : d.status || (d.done ? '완료' : '진행');
      if (st === '완료' || st === '보류' || d.done || !d.due || d.due >= day || d.share === 'private' && false) continue;
      const ws = Array.isArray(d.whos) && d.whos.length ? d.whos : d.who ? [d.who] : [];
      const ids = ws.map(n => (members.find(x => x.name === n) || {}).id).filter(Boolean);
      (ids.length ? ids : [it.mid]).forEach(id => add(id, '⏳ ' + d.title));
    }
    const c = await cleanConf(env);
    if (c) {
      const chk = d => all(env, 'SELECT task FROM cleanchk WHERE day = ?', d);
      if (h >= 18) { const done = new Set((await chk(day)).map(x => x.task)), l = cleanTasks(c, day).filter(t => !done.has(t)); if (l.length) add(cleanWho(c, day), '🧹 오늘 청소 ' + l.length + '개 남음' + (h === 21 ? ' (21시까지)' : '')); }
      if (h === 13) { let pd = new Date(Date.parse(day + 'T00:00:00Z') - 864e5).toISOString().slice(0, 10); while (['토', '일'].includes(dayW(pd))) pd = new Date(Date.parse(pd + 'T00:00:00Z') - 864e5).toISOString().slice(0, 10); const done = new Set((await chk(pd)).map(x => x.task)), l = pd >= (c.since || c.start) ? cleanTasks(c, pd).filter(t => !done.has(t)) : []; if (l.length) add(cleanWho(c, pd), '🧹 지난 청소 ' + l.length + '개 안 끝남 (' + pd.slice(5).replace('-', '/') + ')'); }
    }
    for (const [id, list] of per) await pushTo(env, await subsOf([id]), '⏰ 아직 안 끝난 일 ' + list.length + '개', list.slice(0, 4).join('\n') + (list.length > 4 ? '\n외 ' + (list.length - 4) + '개' : ''), 'todo');
  }
  if (Math.random() < 0.02) await run(env, "DELETE FROM kv WHERE (k LIKE 'sent:%' AND substr(k, 6, 10) < ?) OR (k LIKE 'pkchk:%' AND substr(k, 7, 10) < ?)", addDays(day, -30), addDays(day, -30));
}
// 반복 다음 날짜 (화면의 nextDue와 같음)
function nextDay(d, r) {
  const [y, mo, da] = d.split('-').map(Number), ld = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate(), f = (yy, mm, dd) => yy + '-' + String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
  if (r === 'day') return addDays(d, 1); if (r === 'week') return addDays(d, 7);
  if (r === 'wkday') { let n = addDays(d, 1); while ([0, 6].includes(new Date(Date.parse(n)).getUTCDay())) n = addDays(n, 1); return n; }
  if (r === 'month') { const yy = mo === 12 ? y + 1 : y, mm = mo === 12 ? 1 : mo + 1; return f(yy, mm, Math.min(da, ld(yy, mm))); }
  if (r === 'mend') { const yy = mo === 12 ? y + 1 : y, mm = mo === 12 ? 1 : mo + 1; return f(yy, mm, ld(yy, mm)); }
  if (r === 'year') return f(y + 1, mo, Math.min(da, ld(y + 1, mo)));
  return '';
}
async function bumpItem(env, id) { await run(env, 'UPDATE items SET upd = ? WHERE id = ?', Date.now(), id); }
// 5분마다: 울려도 되는 때면 모아 둔 신청 알림을 한 번에 보냄
async function runPushQueue(env) {
  if (!canRing()) return;
  const q0 = await all(env, 'SELECT id, text FROM pushq ORDER BY id LIMIT 50'); if (!q0.length) return;
  await run(env, 'DELETE FROM pushq WHERE id <= ?', q0[q0.length - 1].id);
  const body = q0.length === 1 ? q0[0].text : q0.slice(0, 3).map(x => x.text).join('\n') + (q0.length > 3 ? '\n외 ' + (q0.length - 3) + '건' : '');
  await pushAll(env, '', '🎟 학부모 앱 행사 신청 ' + q0.length + '건', body, 'event');
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
  const s = await one(env, 'SELECT s.mid, s.created, m.name, m.boss, m.role, m.mustpin, m.shared FROM sessions s JOIN members m ON m.id = s.mid WHERE s.tok = ?', str(tok, 64));
  if (!s || s.created < Date.now() - SESSION_DAYS * 86400e3) return null;
  if (s.created < Date.now() - 86400e3) await run(env, 'UPDATE sessions SET created = ? WHERE tok = ?', Date.now(), str(tok, 64)); // 쓰는 동안 로그인 유지
  return { id: s.mid, name: s.name, boss: !!s.boss, role: s.role || '', mustpin: !!s.mustpin, shared: !!s.shared };
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
