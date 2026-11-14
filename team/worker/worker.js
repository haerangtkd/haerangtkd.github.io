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
// 틀린 횟수 잠금은 failAdd (5번마다 1분·2분·3분…)
const TYPES = ['todo', 'sched', 'event', 'buy'];
const TYPE_KO = { todo: '할 일', sched: '일정', event: '행사표', buy: '구매표' };

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)',
  'CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, name TEXT, salt TEXT, pin TEXT, created INTEGER)',
  'CREATE TABLE IF NOT EXISTS sessions (tok TEXT PRIMARY KEY, mid TEXT, created INTEGER)',
  'CREATE TABLE IF NOT EXISTS subs (ep TEXT PRIMARY KEY, mid TEXT, p256 TEXT, auth TEXT, created INTEGER)',
  'CREATE TABLE IF NOT EXISTS msgs (id INTEGER PRIMARY KEY AUTOINCREMENT, mid TEXT, text TEXT, photo TEXT, refs TEXT, at INTEGER)',
  'CREATE TABLE IF NOT EXISTS mhide (mid TEXT, id INTEGER, at INTEGER, PRIMARY KEY (mid, id))', // '나만 삭제'한 메시지
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
  'CREATE TABLE IF NOT EXISTS exam (month TEXT, sid TEXT, name TEXT, data TEXT, upd INTEGER, mid TEXT, PRIMARY KEY (month, sid))', // 승급 심사 채점 (team/exam.html, 2026-11-14) — 제자(출석부 원생 id)마다 한 줄
  // 학부모 앱에서 들어온 행사 신청 (ev: 행사표 id, kid: 제자 이름) — state '' 새로 들어옴(행사표에 아직 안 넣음) / 'in' 행사표에 넣음
  'CREATE TABLE IF NOT EXISTS esign (ev TEXT, kid TEXT, data TEXT, rel TEXT, cancel INTEGER DEFAULT 0, state TEXT DEFAULT \'\', at INTEGER, upd INTEGER, PRIMARY KEY (ev, kid))',
  'CREATE INDEX IF NOT EXISTS esign_upd ON esign (upd)',
  // 쉬는 시간에 모아서 보낼 휴대폰 알림
  'CREATE TABLE IF NOT EXISTS pushq (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT, at INTEGER)',
  // 직원 알림은 평일 12:00~22:00 에만 울림 — 그 밖에 생긴 알림은 사람마다 모아 두었다가 다음 평일 12시에 (2026-11-12 사용자 결정)
  'CREATE TABLE IF NOT EXISTS pushhold (id INTEGER PRIMARY KEY AUTOINCREMENT, mid TEXT, title TEXT, body TEXT, view TEXT, at INTEGER)',
  // 청소 체크 (day: 날짜, task: 청소 이름, mid: 체크한 사람)
  'CREATE TABLE IF NOT EXISTS cleanchk (day TEXT, task TEXT, mid TEXT, at INTEGER, PRIMARY KEY (day, task))',
  // 학부모 앱 '사범님께 연락' (kind: 버튼 종류, act: absent 결석 / in·out 보호자 등·하원, ack: 확인한 직원)
  'CREATE TABLE IF NOT EXISTS pmsg (id INTEGER PRIMARY KEY AUTOINCREMENT, kid TEXT, kind TEXT, label TEXT, act TEXT, who TEXT, why TEXT, text TEXT, day TEXT, rel TEXT, at INTEGER, ack TEXT, ackAt INTEGER, applied INTEGER DEFAULT 0, upd INTEGER)',
  'CREATE INDEX IF NOT EXISTS pmsg_upd ON pmsg (upd)',
  'CREATE TABLE IF NOT EXISTS pushq2 (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT, at INTEGER)', // 밤 9시~아침 8시에 온 연락 → 아침에
  'CREATE TABLE IF NOT EXISTS contracts (id TEXT PRIMARY KEY, kind TEXT, name TEXT, birth TEXT, data TEXT, sign TEXT, at INTEGER, sid TEXT, upd INTEGER, del INTEGER DEFAULT 0)', // 태블릿 등록 서류 (기본정보 + 제자희망서 서명)
  // 미션 (mode: once 한 번 / daily 기간 동안 매일) + 학부모 체크
  'CREATE TABLE IF NOT EXISTS hw (id TEXT PRIMARY KEY, data TEXT, upd INTEGER, del INTEGER DEFAULT 0, mid TEXT)',
  'CREATE TABLE IF NOT EXISTS hwchk (hw TEXT, kid TEXT, day TEXT, at INTEGER, rel TEXT, PRIMARY KEY (hw, kid, day))',
];
// 학부모 앱 연락 버튼 기본값 (이아빈 계정에서 추가·수정·삭제) — ask: who 누가 / why 사유 / '' 없음, act: 확인할 때 할 일
const RELS = ['엄마', '아빠', '할머니', '할아버지', '이모', '고모', '삼촌', '기타'];
// 알림장 양식 (2026-11-13): 업무 앱 설정에서 직원이 관리 → 알림 관리 '알림장 쓰기'에서 골라 씀. {날짜} = 오늘 날짜
const JTPL0 = [
  { t: '오늘의 수련', title: '{날짜} 오늘의 수련', body: '오늘은 ○○을(를) 배웠어요.\n\n집에서도 한 번 해 보게 해 주세요.' },
  { t: '칭찬', title: '{날짜} 칭찬 한마디', body: '오늘 ○○이가 수련 시간에 ○○을(를) 아주 잘했어요. 많이 칭찬해 주세요!' },
  { t: '준비물', title: '{날짜} 준비물 안내', body: '○○일까지 ○○을(를) 챙겨 보내 주세요.' },
];
async function jtplGet(env) { const v = J((await one(env, "SELECT v FROM kv WHERE k = 'jtpl'") || {}).v, null); return Array.isArray(v) ? v : JTPL0; }
// 행사 신청 대상 분류 (2026-11-13, 관리자가 업무 앱 설정에서 고침): 한국 나이 a~b살
const EGRP0 = [{ n: '유치부', a: 5, b: 7 }, { n: '초등부', a: 8, b: 13 }, { n: '중등부', a: 14, b: 16 }, { n: '고등부', a: 17, b: 19 }];
async function egrpGet(env) { const v = J((await one(env, "SELECT v FROM kv WHERE k = 'egrps'") || {}).v, null); return Array.isArray(v) && v.length ? v : EGRP0; }
// 행사 대상: elig {mode:'age', from, to} 나이(한국 나이) / {mode:'grp', grps:[이름]} 분류 / 없으면 모두
function eligText(e, grps) { if (!e || !e.mode || e.mode === 'all') return ''; if (e.mode === 'kids') return '도장에서 고른 제자'; /* 학부모 앱에 다른 제자 이름은 안 보임 */ if (e.mode === 'age') return (e.from || '') + '~' + (e.to || '') + '살'; return (e.grps || []).join('·'); }
function eligOk(e, birth, year, grps, kid) {
  if (!e || !e.mode || e.mode === 'all') return true;
  if (e.mode === 'kids') return (e.kids || []).includes(kid); // 이름으로 고른 제자만 (2026-11-13, 심사처럼 도장에서 고른 사람만)
  const by = +String(birth || '').slice(0, 4); if (!by) return true; // 출생연도를 모르면 막지 않음
  const age = year - by + 1;
  if (e.mode === 'age') return (!e.from || age >= +e.from) && (!e.to || age <= +e.to);
  return (e.grps || []).some(n => { const g = grps.find(x => x.n === n); return g && age >= +g.a && age <= +g.b; });
}
async function kidBirths(env, kids) { const r = await attSync(env, '/sync/roster', {}); const m = {}; for (const s of (r.students || [])) if (kids.includes(s.name)) m[s.name] = s.birth || ''; return m; }
const PTPL0 = [
  { id: 'in', label: '보호자가 등원시킬게요', ask: 'who', act: 'in', reasons: [] },
  { id: 'out', label: '보호자가 하원시킬게요', ask: 'who', act: 'out', reasons: [] },
  { id: 'cond', label: '오늘은 운동을 살살 부탁드려요', ask: 'why', act: '', reasons: ['감기 기운이 있어요', '배가 아파요', '피곤해해요', '다친 곳이 있어요'] },
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
// 직원 알림이 울려도 되는 때 — 2026-11-14 사용자 결정: 시간 제한 없음(언제든 바로). 예전엔 평일 12~22시만, 밖이면 모아 두었다가 보냄.
// 예전에 모아 둔 알림(pushhold)은 runHeld 가 다음 5분 안에 보냄. 학부모 연락 밤 9시~아침 8시 모아 보내기는 따로(그대로).
function staffHours() { return true; }
function canRing(t = Date.now()) {
  const k = new Date(t + 9 * 3600e3), wd = k.getUTCDay(), m = k.getUTCHours() * 60 + k.getUTCMinutes();
  if (wd === 0 || wd === 6) return false;
  return [...RING_OPEN, ...RING_BREAK].some(([a, z]) => m >= a && m < z);
}
// 예전 표에 새 칸 붙이기 (답장·반응·수정 시각) — 이미 있으면 그냥 넘어감
const ALTERS = ['ALTER TABLE msgs ADD COLUMN reply TEXT', 'ALTER TABLE msgs ADD COLUMN rx TEXT', 'ALTER TABLE msgs ADD COLUMN upd INTEGER', 'ALTER TABLE msgs ADD COLUMN room TEXT', 'ALTER TABLE msgs ADD COLUMN ed INTEGER']; // ed: 고친 시각
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
  try { await env.DB.prepare('ALTER TABLE fails ADD COLUMN at INTEGER').run(); } catch (_) {} // 마지막으로 틀린 때 (잠금 시간 늘리기용)
  try { await env.DB.prepare('ALTER TABLE subs ADD COLUMN last INTEGER').run(); } catch (_) {} // 마지막으로 알림이 간 때 (2026-11-13)
  if (!mcols.includes('asrc')) { try { await env.DB.prepare('ALTER TABLE members ADD COLUMN asrc TEXT').run(); } catch (_) {} } // 출석부 PIN(암호화 값)을 마지막으로 가져온 것
  // boss: 직원 관리 권한(이사범님) · role: 직책 · mustpin: 처음 들어오면 PIN 바꾸기 · aid: 출석부 사범님 id · shared: 공용 계정
  for (const [c, t] of [['boss', 'INTEGER DEFAULT 0'], ['role', 'TEXT'], ['mustpin', 'INTEGER DEFAULT 0'], ['aid', 'TEXT'], ['shared', 'INTEGER DEFAULT 0'], ['ledger', 'INTEGER DEFAULT 0']])
    if (!mcols.includes(c)) { try { await env.DB.prepare('ALTER TABLE members ADD COLUMN ' + c + ' ' + t).run(); } catch (_) {} }
  ready = true;
  await migrate2026(env).catch(() => {});
}
// 한 번만: 이사범님 권한, 직책, 실명으로 이름 바꾸기, 공용 계정, 청소 순서
async function migrate2026(env) {
  if (await one(env, "SELECT v FROM kv WHERE k = 'mig2026a'")) {
    if (!(await one(env, "SELECT v FROM kv WHERE k = 'mig2026b'"))) { // 관리자 두 명 (이아빈·한채원)
      await run(env, "UPDATE members SET boss = 1 WHERE name IN ('이아빈', '한채원', '이사범', '한코치')");
      await run(env, "INSERT INTO kv (k, v) VALUES ('mig2026b', '1') ON CONFLICT(k) DO NOTHING");
    }
    migDone = true; return;
  }
  const mem = await all(env, 'SELECT id, name, role, boss, aid, shared FROM members');
  if (!mem.length) return; // 처음 설정 전
  if (env.ATT) { // 출석부 사범님과 id로 묶기 (이름을 바꿔도 다시 생기지 않게)
    const r = await attSync(env, '/sync/teachers', {}); if (!r.ok) return; // 출석부가 안 되면 다음에 다시
    for (const t of r.teachers || []) { const m = mem.find(x => x.name === t.name && !x.aid); if (m) { m.aid = t.id; await run(env, 'UPDATE members SET aid = ? WHERE id = ?', t.id, m.id); } }
  }
  if (!mem.some(m => m.boss)) for (const b of mem.filter(m => ['이사범', '이아빈', '한코치', '한채원'].includes(m.name))) await run(env, 'UPDATE members SET boss = 1 WHERE id = ?', b.id);
  await run(env, "INSERT INTO kv (k, v) VALUES ('mig2026b', '1') ON CONFLICT(k) DO NOTHING");
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
  // 2026-11-13: 하나가 실패해도 나머지는 돌게 각각 따로, 시간이 정해진 알림(runTimed)을 먼저
  async scheduled(event, env, ctx) { ctx.waitUntil((async () => { await setup(env); for (const f of [runTimed, runReminders, runPushQueue, runHeld, runChatRemind, rosterFollow]) { try { await f(env); } catch (_) {} } })().catch(() => {})); },
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
  // 서버끼리 부르는 길(/sync/)은 서비스 바인딩으로만 — 바깥(workers.dev 주소)에서 오면 주소 이름이 'team'가 아니라서 막힘 (2026-11-13 보안 보강)
  if (path.startsWith('/sync/') && new URL(req.url).hostname !== 'team') return json({ ok: false, error: 'not found' }, 404);
  const b = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const ip = req.headers.get('cf-connecting-ip') || 'x';
  if (path === '/api/widget') return json(await widgetData(env, new URL(req.url).searchParams.get('k') || b.k)); // 📱 위젯 (2026-11-14): 로그인 없이 위젯 열쇠로만 읽기
  // ═════════ 장부 서버에서 부름 — 서비스 바인딩으로만 (주소 이름이 'team'인 요청은 바깥에서 올 수 없음) ═════════
  if (path.startsWith('/ledger/')) {
    if (new URL(req.url).hostname !== 'team') return json({ ok: false, error: 'not found' }, 404);
    if (path === '/ledger/bk-check') { const t = J((await one(env, 'SELECT v FROM kv WHERE k = ?', 'bktok:' + str(b.bk, 40)) || {}).v, null); return json({ ok: !!(t && t.exp > Date.now()) }); }
    if (path === '/ledger/members') return json({ ok: true, members: (await all(env, 'SELECT id, name, boss, shared, ledger FROM members ORDER BY name')).map(m => ({ id: m.id, name: m.name, boss: !!m.boss, shared: !!m.shared, ledger: !!m.ledger })) });
    if (path === '/ledger/roster') { // 장부: 출석부 원생 번호·이름 (장부 회원을 원생 번호로 잇고 이름을 따라감, 2026-11-13)
      const r = await attSync(env, '/sync/students', {}); if (!r.ok) return json(r);
      return json({ ok: true, students: r.students.filter(x => x.name).map(x => ({ id: x.id, name: x.name, birth: x.birth || '', status: x.status || '재원', days: Array.isArray(x.days) ? x.days : [], joined: x.joined || '' })) }); // days·joined: 장부 '업무 앱에만 있는 원생' 등록 칸 채우기
    }
    if (path === '/ledger/families') { // 장부: 업무 앱 형제·자매 묶음 (확인 알림용, B안)
    if (new URL(req.url).hostname !== 'team') return json({ ok: false, error: 'not found' }, 404);
    const r = await attSync(env, '/sync/roster', { all: true, fam: true }); if (!r.ok) return json(r);
    const g = {}; for (const x of r.students || []) if (x.famId && x.status !== '퇴관') (g[x.famId] = g[x.famId] || []).push(x.name);
    return json({ ok: true, groups: Object.values(g).filter(a => a.length > 1) });
  }
  if (path === '/ledger/pin-check') {
      let m = await one(env, 'SELECT * FROM members WHERE id = ?', str(b.mid, 40));
      if (m && !(await sameText(await pinHash(m.salt, b.pin), m.pin))) { await importTeachers(env, true).catch(() => {}); m = await one(env, 'SELECT * FROM members WHERE id = ?', m.id); }
      if (!m || !(await sameText(await pinHash(m.salt, b.pin), m.pin))) return json({ ok: false });
      return json({ ok: true, id: m.id, name: m.name, boss: !!m.boss, shared: !!m.shared, ledger: !!m.ledger });
    }
    return json({ ok: false, error: 'not found' }, 404);
  }
  // ═════════ 알림 서버(학부모 앱)에서 부름 — 서비스 바인딩 + SYNC_KEY ═════════
  if (path.startsWith('/sync/')) {
    if (!env.SYNC_KEY || !(await sameText(req.headers.get('X-Sync-Key') || '', env.SYNC_KEY))) return json({ ok: false, error: 'sync key' }, 401);
    const kids = (Array.isArray(b.kids) ? b.kids : []).map(x => str(x, 20)).filter(Boolean).slice(0, 10);
    // 다른 앱(알림 관리·태블릿·장부)이 업무 앱 PIN으로 사람 확인 (2026-11-12 사용자 결정: 각자 PIN, 공용 기기는 공용 PIN)
    if (path === '/sync/members') return json({ ok: true, members: (await all(env, 'SELECT id, name, boss, shared FROM members ORDER BY shared, name')).map(m => ({ id: m.id, name: m.name, boss: !!m.boss, shared: !!m.shared })) });
    if (path === '/sync/pin-check') {
      let m = b.shared ? await one(env, 'SELECT * FROM members WHERE shared = 1 ORDER BY id LIMIT 1') : await one(env, 'SELECT * FROM members WHERE id = ?', str(b.mid, 40));
      if (!m) return json({ ok: false });
      if (!(await sameText(await pinHash(m.salt, b.pin), m.pin)) && !m.shared) { await importTeachers(env, true).catch(() => {}); m = await one(env, 'SELECT * FROM members WHERE id = ?', m.id); }
      if (!m || !(await sameText(await pinHash(m.salt, b.pin), m.pin))) return json({ ok: false });
      return json({ ok: true, id: m.id, name: m.name, boss: !!m.boss, shared: !!m.shared });
    }
    if (path === '/sync/events') return json({ ok: true, events: await openEvents(env, kids) });
    // 알림 관리 일정표 → 업무 앱 행사 신청표 (2026-11-13 사용자 결정: 도장 일정은 알림 관리에서, '🎟 신청표도 만들기')
    if (path === '/sync/ev-from-sched') {
      const title = str(b.title, 100).trim(), date = isDay(b.date) ? b.date : ''; if (!title) return json({ ok: false, error: '제목이 없어요' });
      const had = (await all(env, "SELECT id, data FROM items WHERE type = 'event' AND del = 0")).find(r => J(r.data, {}).sp === (b.sp | 0)); if (had) return json({ ok: true, id: had.id });
      const el = b.elig || {}, e = el.mode === 'age' ? { mode: 'age', from: +el.from || 0, to: +el.to || 0 } : el.mode === 'grp' ? { mode: 'grp', grps: (Array.isArray(el.grps) ? el.grps : []).map(x => str(x, 20)).slice(0, 10) } : el.mode === 'kids' ? { mode: 'kids', kids: [...new Set((Array.isArray(el.kids) ? el.kids : []).map(x => str(x, 20)).filter(Boolean))].slice(0, 200) } : null;
      const r = itemStmt(env, { type: 'event', kind: '', title, date, base: 0, products: [], options: [], checks: [], van: false, rows: [], pub: true, openAt: kstDay(), closeAt: '', desc: str(b.body, 1000), elig: e, sp: b.sp | 0 }, { id: '' });
      await r.stmt.run();
      await addLog(env, '', 'event', '🎟 행사 신청표 만듦 (알림 관리 일정표' + (b.who ? ' · ' + str(b.who, 12) : '') + '): ' + title, r.id);
      return json({ ok: true, id: r.id });
    }
    // 📩 봉투 ↔ 신청표 (2026-11-13): 봉투에서 '참가'를 누르면 신청표 명단으로 (학부모 앱 신청과 같은 길: esign → 신청표를 열면 명단에)
    if (path === '/sync/ev-tables') return json({ ok: true, items: (await all(env, "SELECT id, data FROM items WHERE type = 'event' AND del = 0")).map(r => ({ id: r.id, d: J(r.data, {}) })).filter(x => !x.d.closed && x.d.kind !== 'goods').map(x => ({ id: x.id, title: str(x.d.title, 100), date: x.d.date || '' })).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999')) });
    if (path === '/sync/ev-new') { // 봉투 제목으로 새 신청표 (학부모 앱 '행사 신청'에는 안 보임, 봉투로만 받음)
      const title = str(b.title, 100).trim(); if (!title) return json({ ok: false, error: '제목이 없어요' });
      const r = itemStmt(env, { type: 'event', kind: '', title, date: isDay(b.date) ? b.date : '', base: 0, products: [], options: [], checks: [], van: false, rows: [], pub: false, env: true }, { id: '' });
      await r.stmt.run(); await addLog(env, '', 'event', '📩 봉투 신청표 만듦 (알림 관리' + (b.who ? ' · ' + str(b.who, 12) : '') + '): ' + title, r.id);
      return json({ ok: true, id: r.id });
    }
    if (path === '/sync/env-reply') {
      const ev = str(b.ev, 40), kid = str(b.kid, 20), it = await one(env, "SELECT data FROM items WHERE id = ? AND type = 'event' AND del = 0", ev); if (!it || !kid) return json({ ok: false, error: '연결된 신청표가 없어요' });
      const d = J(it.data, {}), now = Date.now(), had = await one(env, 'SELECT cancel FROM esign WHERE ev = ? AND kid = ?', ev, kid), yes = b.ans === 'yes';
      if (!yes && !had) return json({ ok: true });
      await run(env, "INSERT INTO esign (ev, kid, data, rel, cancel, state, at, upd) VALUES (?, ?, '{}', ?, ?, '', ?, ?) ON CONFLICT(ev, kid) DO UPDATE SET rel = excluded.rel, cancel = excluded.cancel, state = '', upd = excluded.upd", ev, kid, str(b.rel, 10), yes ? 0 : 1, now, now);
      const what = kid + ' ' + (yes ? '참가' : '불참') + ' (' + (str(b.rel, 10) || '학부모') + ')';
      await addLog(env, '', 'event', '📩 ' + d.title + ': ' + what + ' · 봉투 답장', ev);
      await run(env, 'INSERT INTO pushq (text, at) VALUES (?, ?)', '📩 ' + d.title + ' · ' + what, now);
      await bumpItem(env, ev); ctx.waitUntil(runPushQueue(env).catch(() => {}));
      return json({ ok: true });
    }
    if (path === '/sync/egrps') return json({ ok: true, egrps: await egrpGet(env) }); // 알림 관리 일정표 '신청 대상' 분류
    if (path === '/sync/ev-sched-upd' || path === '/sync/ev-sched-del') { // 일정표에서 고치면 신청표 제목·날짜도 / 지우면 연결만 풂
      const it = await one(env, "SELECT data FROM items WHERE id = ? AND type = 'event' AND del = 0", str(b.ev, 40)); if (!it) return json({ ok: false, error: '업무 앱에서 지워진 신청표예요' });
      const d = J(it.data, {}), old = d.title + ' ' + (d.date || '');
      if (path === '/sync/ev-sched-del') delete d.sp; else { d.title = str(b.title, 100).trim() || d.title; if (isDay(b.date)) { d.date = b.date; if (d.closeAt && d.closeAt > d.date) d.closeAt = ''; } }
      await run(env, 'UPDATE items SET data = ?, upd = ? WHERE id = ?', JSON.stringify(d), Date.now(), str(b.ev, 40));
      await addLog(env, '', 'event', path === '/sync/ev-sched-del' ? '📣 알림 관리에서 \'' + str(b.title, 60) + '\' 일정을 지웠어요 (신청표는 그대로)' : '📣 알림 관리에서 일정을 고쳐 신청표도 바뀜: ' + old + ' → ' + d.title + ' ' + (d.date || ''), str(b.ev, 40));
      return json({ ok: true });
    }
    if (path === '/sync/kmode') { // 제자 모드 (2026-11-14): 내 띠·다음 띠까지(%)·선범단 여부 + 선범단 명단(모두) + 내 성장 측정 기록 — 📈 성장(gdocs)이 기준
      const name = str(b.name, 20), gd = async p => { const r = await one(env, 'SELECT data FROM gdocs WHERE path = ?', p); return r ? J(r.data, null) : null; };
      const data = await gd('app/data'), st = ((await gd('app/settings')) || {}).settings || {}, belts = st.belts || {}, sb = st.sb || {}, status = st.status || {};
      const L = data && Array.isArray(data.students) ? data.students.filter(k => k && k.name) : [], id = k => k.name + '|' + k.birth;
      const me = L.find(k => k.name === name), mid = me ? id(me) : '';
      let pct = null; if (me) { const per = await all(env, "SELECT path, data FROM gdocs WHERE path LIKE 'inputs/P%' ORDER BY path DESC"); for (const r of per) { const x = ((J(r.data, {}) || {}).kids || {})[mid]; if (x && x.beltPct != null && x.beltPct !== '') { pct = Math.max(0, Math.min(100, +x.beltPct)); break; } } }
      // 제자 모드 홈 (2026-11-14, 의견 정리 4·5번): 유치부 여부 · 목표 띠(업무 앱 원생 상세) · 심사 결과 · 이번 달 심사 준비 · 선 모으기(모두 봄)
      const kv = async k => J((await one(env, 'SELECT v FROM kv WHERE k = ?', k) || {}).v, null), mon = kstDay().slice(0, 7);
      const goals = (await kv('kgoal')) || {}, goal = me ? (goals[me.sid] || goals['n:' + name] || '') : '';
      const ex = me ? await examClosed(env) : {}, exams = me ? examList(ex, { sid: me.sid, name }) : [];
      const em = (await kv('exam:' + mon)) || {}, vids = (await kv('examvid')) || {}, myBelt = me ? (belts[mid] || me.belt0 || '') : '';
      const prep = { month: mon, date: em.date || '', closed: !!em.closed, notes: em.notes || {}, vid: vids[myBelt] || '' };
      const sun = ((await kv('sun:' + mon)) || []).map(x => ({ name: x.name, text: x.text, at: x.at }));
      return json({ ok: true, sid: me ? me.sid || '' : '', kinder: !!(me && String(me.grade || '').includes('유치')), goal, exams, prep, sun,
        belt: me ? (belts[mid] || me.belt0 || '') : '', beltPct: pct, sb: !!(me && sb[mid]),
        sbList: L.filter(k => sb[id(k)] && status[id(k)] !== '퇴관').map(k => ({ name: k.name, belt: belts[id(k)] || k.belt0 || '' })),
        events: data ? (data.events || []).map(e => ({ name: e.name, unit: e.unit, lower: !!e.lower, months: e.months, pf: !!e.pf })) : [], rec: me ? (me.rec || {}) : {} });
    }
    if (path === '/sync/grow') { // 학부모 앱 '성장 리포트' (2026-11-14): 내 제자 이름의 성장 측정 기록만 — 결과지가 완성된 달(4가지 평가 + 사범님 한마디)만 보냄 + 마감한 승급 심사 결과
      const names = (Array.isArray(b.names) ? b.names : []).map(x => str(x, 20)).filter(Boolean).slice(0, 10); if (!names.length) return json({ ok: true, events: [], kids: [] });
      const gd = async p => { const r = await one(env, 'SELECT data FROM gdocs WHERE path = ?', p); return r ? J(r.data, null) : null; };
      const data = (await gd('app/data')) || {}, st = ((await gd('app/settings')) || {}).settings || {}, studs = Array.isArray(data.students) ? data.students : [];
      const th = st.attTh || {}, hi = +(th.hi ?? 90), mid = +(th.mid ?? 75);
      const pct = i => (i.an != null && i.an !== '' && +i.at > 0) ? +i.an / +i.at * 100 : (i.rate != null && i.rate !== '') ? +i.rate : null;
      const bat = c => { const k = c.charCodeAt(c.length - 1) - 0xAC00; return k >= 0 && k <= 11171 && k % 28 > 0; };
      const callName = n => { n = String(n).trim(); const g = n.length >= 4 ? n.slice(2) : n.length === 3 ? n.slice(1) : n; return g && bat(g) ? g + '이' : g; };
      const fill = (t, n) => String(t || '').replace(/(\[아이 ?이름\]|\[이름\]|○○|ㅇㅇ)(이(?=[는가를의도랑와한]))?/g, callName(n));
      const per = studs.length ? await all(env, "SELECT path, data FROM gdocs WHERE path LIKE 'inputs/P%'") : [];
      const ex = await examClosed(env), exTh = examTh(st);
      const kids = names.map(n => {
        const k = studs.find(x => x && x.name === n), ps = [], who = { sid: k && k.sid, name: n };
        if (k) { const id = k.name + '|' + k.birth;
          per.forEach(r => { const x = ((J(r.data, {}) || {}).kids || {})[id]; if (!x) return; const mo = r.path.slice(8), a = [...(x.att || [null, null, null, null])], p = pct(x); if (p != null) a[1] = p >= hi ? '아주 잘해요' : p >= mid ? '잘해요' : '성장 중이에요';
            const au = examAuto(ex, who, mo.slice(0, 7), exTh); if (au.a0) a[0] = au.a0; if (au.a2) a[2] = au.a2; if (au.a3) a[3] = au.a3; // 심사 점수로 02·04·05 자동 (2026-11-14)
            if (a.every(Boolean) && String(x.cm || '').trim()) ps.push({ month: mo, att: a, cm: fill(x.cm, k.name).slice(0, 600), pct: p == null ? null : Math.round(p), an: x.an ?? null, at: x.at ?? null, exam: au.n || 0 }); });
          ps.sort((p, q) => p.month.localeCompare(q.month)); }
        return { name: n, rec: (k && k.rec) || {}, periods: ps, exams: examList(ex, who) };
      }).filter(x => x.periods.length || x.exams.length || studs.some(y => y && y.name === x.name));
      return json({ ok: true, events: (data.events || []).map(e => ({ name: e.name, unit: e.unit, lower: !!e.lower, months: e.months, pf: !!e.pf })), kids, examTh: exTh });
    }
    if (path === '/sync/done-events') { // 알림 관리 '알림장 쓰기': 완료한 행사표의 참가자 (2026-11-13 사용자 요청) — 완료한 지 30일 안, 최근 것부터
      const rows = await all(env, "SELECT id, data, upd FROM items WHERE type = 'event' AND del = 0 AND upd > ? ORDER BY upd DESC LIMIT 60", Date.now() - 30 * 864e5);
      return json({ ok: true, events: rows.map(r => ({ id: r.id, upd: r.upd, d: J(r.data, {}) })).filter(x => x.d.closed && x.d.kind !== 'goods').slice(0, 12)
        .map(x => ({ id: x.id, title: str(x.d.title, 100), date: x.d.date || '', names: [...new Set((x.d.rows || []).filter(y => y && y.name && !y.wait && !y.appCancel && !y.guest).map(y => str(y.name, 20)))] })) });
    }
    if (path === '/sync/jtpl') return json({ ok: true, tpl: await jtplGet(env) }); // 알림 관리 '알림장 쓰기' 양식
    if (path === '/sync/ptpl') return json({ ok: true, tpl: await ptplGet(env), rels: RELS, msgs: kids.length ? (await all(env, 'SELECT id, kid, kind, label, act, who, why, text, day, rel, at, ack, ackAt FROM pmsg WHERE kid IN (' + kids.map(() => '?').join(',') + ') ORDER BY id DESC LIMIT 10', ...kids)).map(r => ({ id: r.id, kid: r.kid, label: r.label, who: r.who, why: r.why, text: r.text, day: r.day, at: r.at, ack: !!r.ack, ackAt: r.ackAt, short: pmShort(r) })) : [] });
    if (path === '/sync/pmsg-send') return json(await pmsgSend(env, b, kids, ctx));
    if (path === '/sync/hw') return json({ ok: true, hw: await hwFor(env, kids) });
    if (path === '/sync/sb-names') return json({ ok: true, list: await sbNames(env) }); // 알림 관리 제자 탭 '선범단 카드' (2026-11-14)
    if (path === '/sync/contract-cfg') return json({ ok: true, fees: J((await one(env, "SELECT v FROM kv WHERE k = 'cfees'") || {}).v, null) });
    if (path === '/sync/contract-save') { // 태블릿 상담 모드에서 받은 등록 서류
      const rec = b.rec || {}, id = rid(8), now = Date.now(), name = str(rec.name, 20).replace(/\s+/g, '');
      if (!name) return json({ ok: false, error: '이름이 없어요' });
      await run(env, 'INSERT INTO contracts (id, kind, name, birth, data, sign, at, sid, upd, del) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 0)', id, rec.kind === 'adult' ? 'adult' : 'kid', name, str(rec.birth, 10), JSON.stringify(rec), String(b.sign || ''), now, now);
      await addLog(env, '', 'doc', '📝 새 등록 서류: ' + name + ' (' + (rec.kind === 'adult' ? '중고등·성인' : '초등부') + ' · ' + str(rec.type, 10) + ')', id);
      ctx.waitUntil((async () => pushTo(env, await all(env, 'SELECT s.* FROM subs s JOIN members m ON m.id = s.mid WHERE m.boss = 1'), '📝 새 등록 서류', name + ' 서류가 들어왔어요. 더보기 → 등록 서류에서 확인해 주세요', 'more'))().catch(() => {})); // 관리자에게만
      return json({ ok: true, id });
    }
    if (path === '/sync/kiosk-repeat') { // 태블릿 두 번째 등·하원 (여러 번 허용일 때) → 맞는지 확인할 일
      const name = str(b.name, 20), act = b.act === 'out' ? '하원' : '등원';
      const r = itemStmt(env, { type: 'todo', title: name + ' 오늘 두 번째 ' + act + ' (' + str(b.time, 20) + ') · 맞는지 확인', due: isDay(b.day) ? b.day : kstDay(), cat: '출결 확인', status: '진행', whos: [], checks: [], done: false }, { id: '' });
      await r.stmt.run(); await addLog(env, '', 'todo', '🔁 ' + name + ' 태블릿 두 번째 ' + act + ' · 확인해 주세요', r.id);
      return json({ ok: true });
    }
    if (path === '/sync/hw-check') {
      const kid = str(b.kid, 20), id = str(b.hw, 40), day = isDay(b.day) ? b.day : kstDay(); if (!kids.includes(kid)) return json({ ok: false, error: '제자 이름을 확인해 주세요' });
      const h = await one(env, 'SELECT data FROM hw WHERE id = ? AND del = 0', id); if (!h) return json({ ok: false, error: '지워진 미션이에요' });
      const d = J(h.data, {}), key = d.mode === 'daily' ? day : '';
      if (d.mode === 'daily' && (day < d.start || (d.end && day > d.end) || day > kstDay())) return json({ ok: false, error: '미션 기간이 아니에요' });
      if (b.on) await run(env, 'INSERT OR REPLACE INTO hwchk (hw, kid, day, at, rel) VALUES (?, ?, ?, ?, ?)', id, kid, key, Date.now(), str(b.rel, 10));
      else await run(env, 'DELETE FROM hwchk WHERE hw = ? AND kid = ? AND day = ?', id, kid, key);
      await run(env, 'UPDATE hw SET upd = ? WHERE id = ?', Date.now(), id);
      if (b.on) { // 학부모님이 '했어요' → 알림 기록 + 직원 휴대폰 알림 (행사 신청처럼 모아서 보냄, 2026-11-13 사용자 요청)
        const what = '🎯 ' + kid + ' 미션 했어요: ' + str(d.title, 60) + (b.rel ? ' (' + str(b.rel, 10) + ')' : '');
        await addLog(env, '', 'hw', what, id);
        await run(env, 'INSERT INTO pushq (text, at) VALUES (?, ?)', what, Date.now());
        ctx.waitUntil(runPushQueue(env).catch(() => {})); // 바로 알림 (2026-11-13)
      }
      return json({ ok: true });
    }
    if (path === '/sync/tok-check') { // 업무 앱에서 출석부·알림 관리 열 때 자동 로그인 (2026-11-14): 업무 앱 로그인 확인
      const m = await auth(env, str(b.tok, 64)); if (!m || m.mustpin) return json({ ok: false });
      return json({ ok: true, id: m.id, name: m.name, boss: m.boss, shared: m.shared });
    }
    if (path === '/sync/join-alert') { // 학부모 앱 새 가입 요청 → 직원 모두에게 바로 (2026-11-13)
      const who = (Array.isArray(b.kids) ? b.kids : []).map(x => str(x, 20)).join('·') + ' ' + str(b.rel, 10);
      await addLog(env, '', 'home', '👪 학부모 가입 요청: ' + who + (b.matched === false ? ' (번호 다름)' : '') + ' · 알림 관리에서 승인해 주세요', '');
      ctx.waitUntil(pushAll(env, '', '👪 학부모 가입 요청', who + ' · 눌러서 알림 관리 → 출결에서 승인해 주세요', 'parents').catch(() => {}));
      return json({ ok: true });
    }
    if (path === '/sync/esign-set') { const r = await esignSet(env, b, kids); ctx.waitUntil(runPushQueue(env).catch(() => {})); return json(r); } // 바로 알림 (2026-11-13)
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
    const lu = await lockUntil(env, ip);
    if (lu) return json({ ok: false, error: lockText(lu) }, 429);
    let m = await one(env, 'SELECT * FROM members WHERE id = ?', str(b.mid, 40));
    if (m && !(await sameText(await pinHash(m.salt, b.pin), m.pin))) { await importTeachers(env, true).catch(() => {}); m = await one(env, 'SELECT * FROM members WHERE id = ?', m.id); } // 출석부에서 막 바꾼 PIN일 수 있음
    if (!m || !(await sameText(await pinHash(m.salt, b.pin), m.pin))) {
      return json({ ok: false, error: failText('PIN이 맞지 않아요', await failAdd(env, ip)) }, 401);
    }
    await failClear(env, ip);
    return json({ ok: true, tok: await newSession(env, m.id), name: m.name, mustPin: !!m.mustpin });
  }

  // ═════════ 로그인 후 ═════════
  const me = await auth(env, b.tok);
  if (!me) return json({ ok: false, error: '다시 로그인해 주세요', relogin: true }, 401);
  if (me.mustpin && !['/api/member-pin', '/api/logout'].includes(path)) return json({ ok: false, mustPin: true, error: '처음 받은 PIN을 내 PIN으로 바꿔 주세요' });
  const needBoss = () => me.boss ? null : json({ ok: false, error: '관리자만 할 수 있어요' });
  // 🔑 제자 코드 만들기 (2026-11-14 사용자 결정): 더보기에서 이름 찾기 → 만들기 → 코드. 만든 사람 = 승인한 사범님. 도장 공용 계정은 안 됨
  if (path === '/api/kcode-list') return json(await noticeSync(env, '/sync/kcode-list', {}));
  if (path === '/api/kcode-new') {
    if (me.shared) return json({ ok: false, error: '도장 공용 계정으로는 못 만들어요. 내 PIN으로 로그인해 주세요' });
    const r = await noticeSync(env, '/sync/kcode-new', { name: str(b.name, 20) }); if (!r.ok) return json(r);
    const t = me.name + '님이 ' + r.name + ' 제자를 승인했어요';
    await addLog(env, me.id, 'home', '🥋 ' + t, '');
    ctx.waitUntil(pushAll(env, me.id, '🥋 제자 모드 승인', t, 'home').catch(() => {}));
    return json({ ok: true, code: r.code, name: r.name });
  }
  // ═════════ 기네스 결과지 (team/guinness.html) — 문서 몇 개를 통째로 저장 (app/settings, app/data, app/comments, inputs/P2026-10 …) ═════════
  if (path === '/api/gdoc-get') { const r = await one(env, 'SELECT data FROM gdocs WHERE path = ?', str(b.path, 80)); return json({ ok: true, exists: !!r, data: r ? J(r.data, null) : null }); }
  if (path === '/api/gdoc-list') { const pre = str(b.coll, 30) + '/'; if (!/^[a-z]+\/$/.test(pre)) return json({ ok: false, error: '잘못된 요청' }); const rs = await all(env, 'SELECT path, data FROM gdocs WHERE substr(path, 1, ?) = ?', pre.length, pre); return json({ ok: true, docs: rs.map(r => ({ id: r.path.slice(pre.length), data: J(r.data, null) })) }); }
  if (path === '/api/gdoc-set') {
    const gp = str(b.path, 80); if (!/^(app|inputs)\/[\w-]{1,40}$/.test(gp)) return json({ ok: false, error: '잘못된 요청' });
    if (gp === 'app/data' && b.data && Array.isArray(b.data.students)) { // 🏆 기네스 기록장에서 넣은 기록을 예전 화면이 덮어쓰지 않게: 서버에만 있는 기록 칸은 남김 (2026-11-14)
      const cur = J((await one(env, 'SELECT data FROM gdocs WHERE path = ?', 'app/data') || {}).data, null);
      if (cur && Array.isArray(cur.students)) b.data.students.forEach(k => { const o = cur.students.find(x => (k.sid && x.sid === k.sid) || (x.name === k.name && String(x.birth) === String(k.birth))); if (!o || !o.rec) return; k.rec = k.rec || {};
        Object.keys(o.rec).forEach(ev => { k.rec[ev] = k.rec[ev] || {}; Object.keys(o.rec[ev] || {}).forEach(mm => { if (k.rec[ev][mm] == null) k.rec[ev][mm] = o.rec[ev][mm]; }); }); });
    }
    const d = JSON.stringify(b.data == null ? null : b.data); if (d.length > 900000) return json({ ok: false, error: '기록이 너무 커요' });
    await run(env, 'INSERT INTO gdocs (path, data, upd, mid) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET data = excluded.data, upd = excluded.upd, mid = excluded.mid', gp, d, Date.now(), me.id);
    return json({ ok: true });
  }
  if (path === '/api/att-quarter') { // 📈 성장: 그 달이 든 분기의 출석(그 달까지) — 출석부 휴관일 + 알림 관리 일정표 '휴관'은 빼고 셈 (2026-11-14: 출석 횟수·출석 파일·휴무일 입력 없앰)
    const month = str(b.month, 7); if (!/^\d{4}-\d{2}$/.test(month)) return json({ ok: false, error: '잘못된 달이에요' });
    const y = +month.slice(0, 4), q0 = Math.floor((+month.slice(5) - 1) / 3) * 3 + 1, months = []; for (let m = q0; m <= +month.slice(5); m++) months.push(y + '-' + String(m).padStart(2, '0'));
    const from = months[0] + '-01', to = months[months.length - 1] + '-31', sc = await noticeSync(env, '/sync/schedule', { from, to }), closed = [];
    (sc.ok ? sc.items : []).filter(x => x.kind === '휴관').forEach(x => { let d = x.date; const e = x.end && x.end > d ? x.end : d; for (let n = 0; d <= e && n < 62; n++) { if (d >= from && d <= to) closed.push(d); d = new Date(Date.parse(d + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10); } });
    const r = await attSync(env, '/sync/month-stats', { months, closed }); if (!r.ok) return json({ ok: false, error: r.error || '출석부를 불러오지 못했어요' });
    return json({ ok: true, months, closed: r.closed || [], schedOk: !!sc.ok, kids: r.students.map(x => ({ id: x.id, name: x.name, m: x.m })) });
  }
  if (path === '/api/grow-notify') { // 📈 성장: 결과지를 마친 제자의 보호자에게 '3개월 성장 리포트가 도착했어요' (6명씩, 화면이 next 로 이어서 부름)
    const pk = str(b.period, 10), names = (Array.isArray(b.names) ? b.names : []).map(x => str(x, 20)).filter(Boolean).slice(0, 200);
    if (!/^P\d{4}-\d{2}$/.test(pk) || !names.length) return json({ ok: false, error: '보낼 제자가 없어요' });
    const r = await noticeSync(env, '/sync/broadcast', { title: '📈 ' + (+pk.slice(6)) + '월 성장 리포트가 도착했어요', body: '성장 측정 기록과 사범님 한마디를 학부모 앱 성장 리포트에서 볼 수 있어요', children: names, offset: b.offset | 0, view: 'grow', kind: '성장' });
    if (r.ok && !r.next) { await run(env, 'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', 'grownotify:' + pk, JSON.stringify({ at: Date.now(), by: me.name, n: names.length })); await addLog(env, me.id, 'grow', pk.slice(6).replace(/^0/, '') + '월 성장 리포트 알림을 보냈어요 · ' + names.length + '명', pk).catch(() => {}); }
    return json(r);
  }
  if (path === '/api/grow-notified') { const v = J((await one(env, 'SELECT v FROM kv WHERE k = ?', 'grownotify:' + str(b.period, 10)) || {}).v, null); return json({ ok: true, sent: v }); }
  // ═════════ 🏆 기네스 기록장 (team/record.html, 2026-11-14: GPT 기네스 앱 대신) — 기록은 📈 성장(gdocs app/data students[].rec[종목][월])에 바로 ═════════
  if (path === '/api/grec-get') {
    const r = await one(env, 'SELECT data, upd FROM gdocs WHERE path = ?', 'app/data'), d = r ? J(r.data, {}) : {};
    const at = await attSync(env, '/sync/students', {}); if (!at.ok) return json({ ok: false, error: at.error || '출석부를 불러오지 못했어요' });
    return json({ ok: true, events: d.events || [], upd: r ? r.upd : 0,
      students: (d.students || []).filter(k => k && k.name).map(k => ({ sid: k.sid || '', name: k.name, birth: k.birth || '', grade: k.grade || '', gender: k.gender || '', rec: k.rec || {} })),
      roster: at.students.filter(x => x.name && x.status !== '퇴관').map(x => ({ id: x.id, name: x.name, birth: x.birth || '', gender: x.gender || '', status: x.status || '재원' })) });
  }
  if (path === '/api/grec-set') { // 한 제자 한 칸만 바꿈 (동시에 여러 직원이 넣어도 안 겹치게 upd 확인 후 다시 시도)
    const ev = str(b.ev, 40), m = b.m | 0, sid = str(b.sid, 40), name = str(b.name, 20); if (!ev || m < 1 || m > 12 || !name) return json({ ok: false, error: '잘못된 요청' });
    let v = b.v; if (v != null && typeof v === 'object') v = { f: Math.max(0, +v.f || 0) }; else if (v != null && v !== '') { v = +v; if (!isFinite(v) || v < 0 || v > 100000) return json({ ok: false, error: '숫자를 확인해 주세요' }); } else v = null;
    for (let t = 0; t < 4; t++) {
      const r = await one(env, 'SELECT data, upd FROM gdocs WHERE path = ?', 'app/data'); if (!r) return json({ ok: false, error: '📈 성장 화면을 먼저 한 번 열어 주세요' });
      const d = J(r.data, {}); d.students = d.students || []; if (!(d.events || []).some(e => e.name === ev)) return json({ ok: false, error: '없는 종목이에요' });
      let k = (sid && d.students.find(x => x.sid === sid)) || d.students.find(x => !x.sid && x.name === name && String(x.birth || '').slice(0, 4) === String(b.birth || '').slice(0, 4));
      if (!k) { if (v == null) return json({ ok: true }); k = { belt0: '', name, birth: str(b.birth, 10), grade: str(b.grade, 10), gender: '', status: '재원', rec: {}, sid }; d.students.push(k); }
      if (sid && !k.sid) k.sid = sid; k.rec = k.rec || {}; k.rec[ev] = k.rec[ev] || {};
      if (v == null) delete k.rec[ev][m]; else k.rec[ev][m] = v;
      const now = Date.now(), w = await env.DB.prepare('UPDATE gdocs SET data = ?, upd = ?, mid = ? WHERE path = ? AND upd = ?').bind(JSON.stringify(d), now, me.id, 'app/data', r.upd).run();
      if (w.meta && w.meta.changes) return json({ ok: true, upd: now });
    }
    return json({ ok: false, error: '잠깐 뒤에 다시 저장해 주세요' });
  }
  if (path === '/api/whoami') return json({ ok: true, id: me.id, name: me.name, boss: !!me.boss, shared: !!me.shared }); // 📈 성장 등 따로 열린 화면이 관리자인지 확인
  if (path === '/api/exam-closed') { // 📈 성장 화면: 마감한 심사 점수 (02·04·05 자동 채우기용, 점수만)
    const ex = await examClosed(env), out = {}; Object.keys(ex).forEach(m => { out[m] = ex[m].rows.map(r => ({ sid: r.sid, name: r.name, sc: r.d.sc || {}, absent: !!r.d.absent })); });
    return json({ ok: true, ex: out });
  }
  // ═════════ 승급 심사 채점 (team/exam.html, 2026-11-14 사용자 결정) — 매달 한 번 모든 제자, 과목마다 1~5점, 합격·새 띠, 직원 누구나 채점·마감 ═════════
  if (path.startsWith('/api/exam-')) {
    const month = str(b.month, 7); if (!/^\d{4}-\d{2}$/.test(month)) return json({ ok: false, error: '잘못된 달이에요' });
    const kg = async k => J((await one(env, 'SELECT v FROM kv WHERE k = ?', k) || {}).v, null);
    const ks = (k, v) => run(env, 'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, JSON.stringify(v));
    const cfg = examCfg(await kg('examcfg')), mk = 'exam:' + month, meta = (await kg(mk)) || {};
    const gd = async p => { const r = await one(env, 'SELECT data FROM gdocs WHERE path = ?', p); return r ? J(r.data, null) : null; };
    if (path === '/api/exam-get') {
      const rows = (await all(env, 'SELECT sid, name, data, upd, mid FROM exam WHERE month = ?', month)).map(r => ({ sid: r.sid, name: r.name, data: J(r.data, {}), upd: r.upd, mid: r.mid }));
      const out = { ok: true, cfg, meta, rows, vid: (await kg('examvid')) || {} };
      if (b.full) { // 지금 띠: 📈 성장(gdocs app/data·app/settings)의 띠를 출석부 원생 번호(sid)로 찾아 줌
        const data = await gd('app/data'), st = ((await gd('app/settings')) || {}).settings || {}, belts = {};
        ((data && data.students) || []).forEach(k => { if (k && k.sid) belts[k.sid] = { belt: (st.belts || {})[k.name + '|' + k.birth] || '', kinder: String(k.grade || '').includes('유치') }; });
        out.belts = belts; const r = await attSync(env, '/sync/roster', { all: true });
        out.roster = r.ok ? r.students.filter(s => (s.status || '재원') !== '퇴관').map(s => ({ id: s.id, name: s.name, birth: s.birth || '', status: s.status || '재원' })) : []; if (!r.ok) out.rosterErr = r.error || '출석부를 불러오지 못했어요';
        const ms = await all(env, 'SELECT id, name FROM members'); out.names = Object.fromEntries(ms.map(m => [m.id, m.name]));
      }
      return json(out);
    }
    if (path === '/api/exam-notify') { // 마감한 심사 → 그 달 심사를 본 제자의 보호자에게 '심사 결과가 나왔어요' (6명씩, 화면이 next 로 이어서 부름)
      if (!meta.closed) return json({ ok: false, error: '마감한 뒤에 보낼 수 있어요' });
      const kidsN = (await all(env, 'SELECT name, data FROM exam WHERE month = ?', month)).filter(r => !J(r.data, {}).absent).map(r => r.name).filter(Boolean);
      if (!kidsN.length) return json({ ok: true, sent: 0, next: null });
      const r = await noticeSync(env, '/sync/broadcast', { title: '🏅 ' + (+month.slice(5)) + '월 심사 결과가 나왔어요', body: '성장 리포트 → 심사에서 점수와 결과를 볼 수 있어요', children: kidsN, offset: b.offset | 0, view: 'grow', kind: '심사' });
      if (r.ok && !r.next) { meta.closed.notified = Date.now(); await ks(mk, meta); }
      return json(r);
    }
    if (path === '/api/exam-set') {
      if (meta.closed) return json({ ok: false, error: '마감한 심사예요. 고치려면 마감을 풀어 주세요' });
      const sid = str(b.sid, 40); if (!sid) return json({ ok: false, error: '잘못된 요청' });
      const d = b.data || {}, sc = {}; cfg.subj.forEach(x => { const v = +((d.sc || {})[x.k]); if (v >= 1 && v <= 5) sc[x.k] = Math.round(v); });
      const clean = { sc, pass: d.pass !== false, nb: str(d.nb, 10), cur: str(d.cur, 10), absent: !!d.absent, memo: str(d.memo, 300), by: me.name };
      await run(env, 'INSERT INTO exam (month, sid, name, data, upd, mid) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(month, sid) DO UPDATE SET name = excluded.name, data = excluded.data, upd = excluded.upd, mid = excluded.mid', month, sid, str(b.name, 20), JSON.stringify(clean), Date.now(), me.id);
      return json({ ok: true, upd: Date.now() });
    }
    if (path === '/api/exam-meta') { // 이 달 심사 날짜 · 과목마다 이번 달 내용(예: 영어 문장) · 예절·태도 켜기
      if (Array.isArray(b.on)) { cfg.subj.forEach(x => { if (x.opt) x.on = b.on.includes(x.k); }); await ks('examcfg', cfg); }
      if (b.date !== undefined) meta.date = /^\d{4}-\d{2}-\d{2}$/.test(str(b.date, 10)) ? str(b.date, 10) : '';
      if (b.notes && typeof b.notes === 'object') { meta.notes = {}; cfg.subj.forEach(x => { const t = str(b.notes[x.k], x.k === 'speech' ? 1500 : 300).trim(); if (t) meta.notes[x.k] = t; }); }
      if (b.vid && typeof b.vid === 'object') { const v = {}; Object.keys(b.vid).slice(0, 30).forEach(k => { const u = str(b.vid[k], 300).trim(); if (/^https:\/\//.test(u)) v[str(k, 10)] = u; }); await ks('examvid', v); } // 띠별 품새 영상 (제자 모드 '심사 준비')
      await ks(mk, meta); return json({ ok: true, cfg, meta, vid: (await kg('examvid')) || {} });
    }
    if (path === '/api/exam-close' || path === '/api/exam-reopen') { // 마감 = 합격한 제자의 새 띠를 📈 성장에 넣음 / 마감 풀기 = 그때 바꾼 띠를 되돌림(그 뒤 손으로 바꾼 띠는 그대로)
      const sd = await gd('app/settings'), data = await gd('app/data');
      if (!sd || !data || !Array.isArray(data.students)) return json({ ok: false, error: '📈 성장 기록이 없어요. 성장 화면을 한 번 열어 주세요' });
      const st = sd.settings || (sd.settings = {}); st.belts = st.belts || {}; const bySid = {}; data.students.forEach(k => { if (k && k.sid) bySid[k.sid] = k; });
      const ym = (+month.slice(5)) + '월';
      if (path === '/api/exam-close') {
        if (meta.closed) return json({ ok: false, error: '이미 마감했어요' });
        const rows = await all(env, 'SELECT sid, name, data FROM exam WHERE month = ?', month), applied = [], miss = [];
        rows.forEach(r => { const d = J(r.data, {}); if (d.absent || d.pass === false || !d.nb) return; const k = bySid[r.sid]; if (!k) { miss.push(r.name); return; }
          const id = k.name + '|' + k.birth, prev = st.belts[id] || ''; if (prev === d.nb) return; st.belts[id] = d.nb; applied.push([id, prev, d.nb, r.name]); });
        await run(env, 'INSERT INTO gdocs (path, data, upd, mid) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET data = excluded.data, upd = excluded.upd, mid = excluded.mid', 'app/settings', JSON.stringify(sd), Date.now(), me.id);
        meta.closed = { at: Date.now(), by: me.name, applied, miss }; await ks(mk, meta);
        await addLog(env, me.id, 'exam', ym + ' 승급 심사를 마감했어요 · 띠 바뀐 제자 ' + applied.length + '명', month).catch(() => {});
        return json({ ok: true, meta, n: applied.length, miss });
      }
      if (!meta.closed) return json({ ok: false, error: '마감하지 않은 심사예요' });
      let back = 0; (meta.closed.applied || []).forEach(([id, prev, nb]) => { if (st.belts[id] !== nb) return; if (prev) st.belts[id] = prev; else delete st.belts[id]; back++; });
      await run(env, 'INSERT INTO gdocs (path, data, upd, mid) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET data = excluded.data, upd = excluded.upd, mid = excluded.mid', 'app/settings', JSON.stringify(sd), Date.now(), me.id);
      delete meta.closed; await ks(mk, meta);
      await addLog(env, me.id, 'exam', ym + ' 승급 심사 마감을 풀었어요 · 띠 ' + back + '명 되돌림', month).catch(() => {});
      return json({ ok: true, meta, n: back });
    }
    return json({ ok: false, error: 'not found' });
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
    if (typeof b.ledger === 'boolean') await run(env, 'UPDATE members SET ledger = ? WHERE id = ?', b.ledger ? 1 : 0, m.id); // 장부 '직원이에요' 허락
    if (typeof b.boss === 'boolean') { // 관리자 지정 (관리자가 한 명은 남아야 함)
      if (!b.boss && (await one(env, 'SELECT COUNT(*) AS n FROM members WHERE boss = 1 AND id <> ?', m.id)).n < 1) return json({ ok: false, error: '관리자가 한 명은 있어야 해요' });
      await run(env, 'UPDATE members SET boss = ? WHERE id = ?', b.boss ? 1 : 0, m.id);
    }
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
  if (path === '/api/kiosk-multi') { // 관리자: 태블릿 하루 여러 번 등·하원 허용 (방학)
    const nb = needBoss(); if (nb) return nb;
    const r = await noticeSync(env, '/sync/kiosk-multi', { on: !!b.on }); if (!r.ok) return json(r);
    await run(env, "INSERT INTO kv (k, v) VALUES ('kioskMulti', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", b.on ? '1' : '0');
    return json({ ok: true });
  }
  if (path === '/api/push-status') { // 관리자: 직원마다 알림 켠 기기 수 · 마지막으로 알림이 간 때 (2026-11-13)
    const nb = needBoss(); if (nb) return nb;
    return json({ ok: true, testOnly: J((await one(env, "SELECT v FROM kv WHERE k = 'testOnly'") || {}).v, null), list: await all(env, 'SELECT m.id, m.name, m.shared, COUNT(s.ep) AS n, MAX(s.last) AS last, MAX(s.created) AS reg FROM members m LEFT JOIN subs s ON s.mid = m.id GROUP BY m.id ORDER BY m.shared, m.name') });
  }
  if (path === '/api/test-push') { // 🧪 시험 모드 (관리자, 2026-11-13 사용자 요청): 켜 두면 직원 휴대폰 알림이 고른 한 사람에게만 감
    const nb = needBoss(); if (nb) return nb;
    const m = b.mid ? await one(env, 'SELECT id, name FROM members WHERE id = ?', str(b.mid, 40)) : null;
    if (b.mid && !m) return json({ ok: false, error: '직원을 찾지 못했어요' });
    if (m) await run(env, "INSERT INTO kv (k, v) VALUES ('testOnly', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", JSON.stringify({ mid: m.id, name: m.name, by: me.name, at: Date.now() }));
    else await run(env, "DELETE FROM kv WHERE k = 'testOnly'");
    await addLog(env, me.id, 'set', m ? '🧪 시험 모드 켬: 직원 알림은 ' + m.name + '님에게만 (' + me.name + ')' : '🧪 시험 모드 끔: 직원 알림이 다시 모두에게 (' + me.name + ')', '');
    await bumpKv(env);
    return json({ ok: true, testOnly: m ? { mid: m.id, name: m.name } : null });
  }
  if (path === '/api/egrps-set') { // 행사 신청 대상 분류 (관리자, 2026-11-13)
    const nb = needBoss(); if (nb) return nb;
    const L = (Array.isArray(b.grps) ? b.grps : []).slice(0, 20).map(g => ({ n: str(g.n, 12).trim(), a: Math.max(1, Math.min(99, +g.a || 0)), b: Math.max(1, Math.min(99, +g.b || 0)) })).filter(g => g.n && g.a && g.b && g.a <= g.b);
    if (!L.length) return json({ ok: false, error: '분류를 하나 이상 넣어 주세요' });
    if (new Set(L.map(g => g.n)).size !== L.length) return json({ ok: false, error: '같은 이름이 두 개 있어요' });
    await run(env, "INSERT INTO kv (k, v) VALUES ('egrps', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", JSON.stringify(L));
    await bumpKv(env); await addLog(env, me.id, 'set', me.name + '님이 행사 신청 분류를 바꿨어요', '');
    return json({ ok: true, grps: L });
  }
  if (path === '/api/cats-set') { // 업무 카테고리 (관리자): 순서·이름·색, 이름을 바꾸면 그 카테고리 업무도 같이 (2026-11-13)
    const nb = needBoss(); if (nb) return nb;
    const cats = (Array.isArray(b.cats) ? b.cats : []).slice(0, 20).map(c => ({ n: str(c.n, 20).trim(), c: /^#[0-9A-Fa-f]{6}$/.test(c.c || '') ? c.c : '' })).filter(c => c.n);
    if (new Set(cats.map(c => c.n)).size !== cats.length) return json({ ok: false, error: '같은 이름이 두 개 있어요' });
    const ren = (Array.isArray(b.renames) ? b.renames : []).map(r => [str(r[0], 20), str(r[1], 20).trim()]).filter(r => r[0] && r[1] && r[0] !== r[1]);
    await run(env, "INSERT INTO kv (k, v) VALUES ('cats', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", JSON.stringify(cats));
    let moved = 0;
    if (ren.length) { const now = Date.now(); for (const it of await all(env, "SELECT id, data FROM items WHERE type = 'todo' AND del = 0")) { const d = J(it.data, {}), r = ren.find(x => x[0] === d.cat); if (r) { d.cat = r[1]; moved++; await run(env, 'UPDATE items SET data = ?, upd = ? WHERE id = ?', JSON.stringify(d), now, it.id); } } }
    await bumpKv(env); await addLog(env, me.id, 'set', me.name + '님이 업무 카테고리를 바꿨어요', '');
    return json({ ok: true, moved });
  }
  if (path === '/api/jtpl') return json({ ok: true, tpl: await jtplGet(env) });
  if (path === '/api/jtpl-set') { // 알림장 양식: 직원 누구나 (공용 계정은 안 됨)
    if (me.shared) return json({ ok: false, error: '공용 계정은 바꿀 수 없어요' });
    const list = (Array.isArray(b.tpl) ? b.tpl : []).slice(0, 20).map(x => ({ t: str(x.t, 20).trim(), title: str(x.title, 100).trim(), body: str(x.body, 2000) })).filter(x => x.t && (x.title || x.body));
    await run(env, "INSERT INTO kv (k, v) VALUES ('jtpl', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", JSON.stringify(list));
    await addLog(env, me.id, 'set', me.name + '님이 알림장 양식을 고쳤어요', '');
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
      // 조율할게요: 날짜·누가·내용을 고쳐서 넣기
      const day = isDay(b.day) ? b.day : m.day, who = b.who != null ? str(b.who, 10) : m.who, text = b.text != null ? str(b.text, 200) : m.text;
      const why = [m.why, text].filter(Boolean).join(' · ').slice(0, 40) || '학부모 연락';
      if (m.act === 'absent') { const r = await attSync(env, '/sync/absence', { items: [{ name: m.kid, date: day, why }] }); if (!r.ok || !(r.added || []).length) return json({ ok: false, error: '출석부에 넣지 못했어요 (' + (r.error || '출석부에 없는 이름') + ')' }); await pickupMark(env, day, m.kid, 'absent', '결석 (' + why + ')', me.name); }
      if (m.act === 'in') await pickupMark(env, day, m.kid, 'in', (who || m.rel || '보호자') + ' 등원' + (text ? ' · ' + text : ''), me.name);
      if (m.act === 'out') { // 보호자 하원 → 할 일 (그 제자 수업 끝나기 5분 전에 알림)
        const r = itemStmt(env, { type: 'todo', title: m.kid + ' · ' + (who || m.rel || '보호자') + ' 하원' + (text ? ' (' + text + ')' : ''), due: day, cat: '하원', status: '진행', whos: [], checks: [], done: false, pickupKid: m.kid }, me);
        await r.stmt.run();
      }
      if (day !== m.day || who !== m.who || text !== m.text) await run(env, 'UPDATE pmsg SET day = ?, who = ?, text = ? WHERE id = ?', day, who, text, m.id);
      applied = 1;
    }
    await run(env, 'UPDATE pmsg SET ack = ?, ackAt = ?, applied = ?, upd = ? WHERE id = ?', me.name, Date.now(), applied, Date.now(), m.id);
    // 학부모 휴대폰에도 '도장에서 확인했어요 · 11/12 엄마 하원' (처음 확인할 때 한 번, 가족 추가 요청은 빼고)
    if (!m.ack && m.label !== '가족 추가 요청') {
      const n = await one(env, 'SELECT * FROM pmsg WHERE id = ?', m.id);
      ctx.waitUntil(noticeSync(env, '/sync/notify', { name: m.kid, title: '✅ 도장에서 확인했어요', body: (+n.day.slice(5, 7)) + '/' + (+n.day.slice(8)) + ' ' + m.kid + ' · ' + pmShort(n), view: 'home' }).catch(() => {}));
    }
    return json({ ok: true });
  }
  // ── 등록 서류 (태블릿 상담 모드) ──
  if (path.startsWith('/api/contract') && !me.boss) return json({ ok: false, error: '등록 서류는 관리자만 볼 수 있어요' }, 403); // 2026-11-13 사용자 요청
  if (path === '/api/contracts') {
    const L = await all(env, 'SELECT id, kind, name, birth, data, at, sid FROM contracts WHERE del = 0 ORDER BY at DESC LIMIT 300');
    return json({ ok: true, items: L.map(r => { const d = J(r.data, {}); return { id: r.id, kind: r.kind, name: r.name, birth: r.birth, at: r.at, sid: r.sid || '', type: d.type || '', signer: d.signer || '', signerRel: d.signerRel || '', photoNo: !!d.photoNo }; }), fees: J((await one(env, "SELECT v FROM kv WHERE k = 'cfees'") || {}).v, null) });
  }
  if (path === '/api/contract-get') {
    const r = await one(env, 'SELECT * FROM contracts WHERE id = ? AND del = 0', str(b.id, 30)); if (!r) return json({ ok: false, error: '지워진 서류예요' });
    return json({ ok: true, item: { ...J(r.data, {}), id: r.id, sid: r.sid || '', at: r.at, sign: r.sign } });
  }
  if (path === '/api/contract-link') { // 출석부 원생과 연결 (sid '' 이면 연결 풀기)
    const r = await one(env, 'SELECT name FROM contracts WHERE id = ? AND del = 0', str(b.id, 30)); if (!r) return json({ ok: false, error: '지워진 서류예요' });
    await run(env, 'UPDATE contracts SET sid = ?, upd = ? WHERE id = ?', str(b.sid, 60) || null, Date.now(), str(b.id, 30));
    if (b.sid) await addLog(env, me.id, 'doc', '📝 ' + r.name + ' 등록 서류를 원생과 연결했어요', str(b.id, 30));
    return json({ ok: true });
  }
  if (path === '/api/contract-del') {
    const nb = needBoss(); if (nb) return nb;
    await run(env, 'UPDATE contracts SET del = 1, sign = NULL, data = NULL, upd = ? WHERE id = ?', Date.now(), str(b.id, 30)); return json({ ok: true });
  }
  if (path === '/api/cfees-set') { // 관리자: 등록 서류 비용표 금액
    const nb = needBoss(); if (nb) return nb;
    const clean = l => (Array.isArray(l) ? l : []).slice(0, 12).map(f => ({ n: str(f.n, 30), p: Math.max(0, Math.min(10000000, +f.p | 0)), ...(f.g ? { g: str(f.g, 20) } : {}) })).filter(f => f.n);
    const v = { kid: clean((b.fees || {}).kid), adult: clean((b.fees || {}).adult) };
    await run(env, "INSERT INTO kv (k, v) VALUES ('cfees', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", JSON.stringify(v)); return json({ ok: true });
  }
  if (path === '/api/hw-save') {
    const d = b.hw || {}, id = str(d.id, 40) || rid(8);
    const v = { title: str(d.title, 60).trim(), body: str(d.body, 1000), mode: d.mode === 'daily' ? 'daily' : 'once', start: isDay(d.start) ? d.start : kstDay(), end: isDay(d.end) ? d.end : '', kids: (Array.isArray(d.kids) ? d.kids : []).map(x => str(x, 20)).filter(Boolean).slice(0, 200), who: d.who === 'self' ? 'self' : 'with', sb: !!d.sb };
    if (v.sb) v.kids = []; // 선범단 전용 = 그때그때 선범단 모두 (2026-11-14)
    if (!v.title) return json({ ok: false, error: '미션 이름을 적어 주세요' });
    if (v.end && v.end < v.start) return json({ ok: false, error: '끝나는 날이 시작일보다 빨라요' });
    if (v.mode === 'daily' && !v.end) return json({ ok: false, error: '매일 체크는 끝나는 날을 정해 주세요' });
    await run(env, 'INSERT INTO hw (id, data, upd, del, mid) VALUES (?, ?, ?, 0, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, upd = excluded.upd', id, JSON.stringify(v), Date.now(), me.id);
    notify(me.name + ' · 미션', '🎯 미션 ' + (d.id ? '수정' : '올림') + ': ' + v.title, 'home');
    return json({ ok: true, id });
  }
  if (path === '/api/hw-notify') { // 학부모님께 미션 알림 (6명씩 나눠서, 화면이 next 로 이어서 부름)
    const h = await one(env, 'SELECT data FROM hw WHERE id = ? AND del = 0', str(b.id, 40)); if (!h) return json({ ok: false, error: '없는 미션이에요' });
    const v = J(h.data, {});
    if (v.sb && !(await sbNames(env)).length) return json({ ok: true, sent: 0, next: null }); // 선범단이 없으면 아무에게도 안 보냄 (빈 명단 = 모두가 되지 않게)
    return json(await noticeSync(env, '/sync/broadcast', { title: '🎯 미션: ' + v.title, body: (v.mode === 'daily' ? (+v.start.slice(5, 7)) + '/' + (+v.start.slice(8)) + '~' + (+v.end.slice(5, 7)) + '/' + (+v.end.slice(8)) + ' 매일 · ' : '') + (v.body || '해 보면 좋아요. 학부모 앱에서 체크해 주세요').slice(0, 120), children: v.sb ? (await sbNames(env)).map(x => x.name) : v.kids, offset: b.offset | 0 })); // 선범단 미션은 선범단 보호자만
  }
  if (path === '/api/read-set') { // 채팅 읽은 곳을 직원마다 서버에 (2026-11-14): 같은 사람의 휴대폰·태블릿끼리 맞춤 + 다시 알림·위젯이 씀
    const cur = J((await one(env, 'SELECT v FROM kv WHERE k = ?', 'read:' + me.id) || {}).v, {}) || {};
    Object.entries(b.read && typeof b.read === 'object' ? b.read : {}).slice(0, 60).forEach(([r, id]) => { r = str(r, 60); if (roomOk(r, me.id)) cur[r] = Math.max(cur[r] | 0, id | 0); });
    await run(env, 'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', 'read:' + me.id, JSON.stringify(cur));
    return json({ ok: true, readAt: cur });
  }
  if (path === '/api/widget-key-get') { const k = J((await one(env, 'SELECT v FROM kv WHERE k = ?', 'wk:' + me.id) || {}).v, ''); return json({ ok: true, key: k || '' }); }
  if (path === '/api/widget-key') { // 위젯 열쇠 새로 만들기(예전 열쇠는 못 씀) · 끄기
    if (me.shared) return json({ ok: false, error: '도장 공용 계정은 위젯을 만들 수 없어요. 본인 이름으로 들어와 주세요' });
    const old = J((await one(env, 'SELECT v FROM kv WHERE k = ?', 'wk:' + me.id) || {}).v, ''); if (old) await run(env, 'DELETE FROM kv WHERE k = ?', 'wkey:' + old);
    if (b.off) { await run(env, 'DELETE FROM kv WHERE k = ?', 'wk:' + me.id); return json({ ok: true, key: '' }); }
    const k = rid(16);
    await env.DB.batch([q(env, 'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', 'wk:' + me.id, JSON.stringify(k)), q(env, 'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', 'wkey:' + k, JSON.stringify(me.id))]);
    return json({ ok: true, key: k });
  }
  if (path === '/api/hw-check') { // 도장(사범님 확인)에서 미션 했어요 (2026-11-14, 폰 없는 친구)
    const kid = str(b.kid, 20), id = str(b.hw, 40), day = isDay(b.day) ? b.day : kstDay();
    const h = await one(env, 'SELECT data FROM hw WHERE id = ? AND del = 0', id); if (!h || !kid) return json({ ok: false, error: '지워진 미션이에요' });
    const d = J(h.data, {}), key = d.mode === 'daily' ? day : '';
    if (b.on) await run(env, 'INSERT OR REPLACE INTO hwchk (hw, kid, day, at, rel) VALUES (?, ?, ?, ?, ?)', id, kid, key, Date.now(), '도장 · ' + me.name);
    else await run(env, 'DELETE FROM hwchk WHERE hw = ? AND kid = ? AND day = ?', id, kid, key);
    await run(env, 'UPDATE hw SET upd = ? WHERE id = ?', Date.now(), id);
    return json({ ok: true });
  }
  if (path === '/api/kgoal-get') { const g = J((await one(env, "SELECT v FROM kv WHERE k = 'kgoal'") || {}).v, {}); return json({ ok: true, goal: g[str(b.sid, 40)] || '' }); }
  if (path === '/api/kgoal-set') { // 제자 모드 '목표 띠' (사범님이 제자마다, 비우면 기본: 유치부 밤띠 · 초등부 이상 빨간띠 · 빨간띠 넘으면 4품)
    const sid = str(b.sid, 40); if (!sid) return json({ ok: false, error: '원생 번호가 없어요' });
    const g = J((await one(env, "SELECT v FROM kv WHERE k = 'kgoal'") || {}).v, {}), belt = str(b.belt, 10);
    if (belt) g[sid] = belt; else delete g[sid];
    await run(env, "INSERT INTO kv (k, v) VALUES ('kgoal', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", JSON.stringify(g));
    await addLog(env, me.id, 'member', '🎯 ' + str(b.name, 20) + ' 제자 모드 목표 띠: ' + (belt || '기본'), '');
    return json({ ok: true });
  }
  if (path === '/api/sun-list' || path === '/api/sun-add' || path === '/api/sun-del') { // ⭐ 선범단 선 모으기 (2026-11-14): 사범님이 넣고, 제자 모드에서 모든 제자가 봄
    const mon = /^\d{4}-\d{2}$/.test(str(b.month, 7)) ? str(b.month, 7) : kstDay().slice(0, 7), k = 'sun:' + mon;
    let L = J((await one(env, 'SELECT v FROM kv WHERE k = ?', k) || {}).v, []); if (!Array.isArray(L)) L = [];
    if (path === '/api/sun-add') {
      const name = str(b.name, 20), text = str(b.text, 80).trim(); if (!name || !text) return json({ ok: false, error: '한 줄을 적어 주세요' });
      if (L.length >= 600) return json({ ok: false, error: '이번 달 기록이 너무 많아요' });
      L.push({ id: rid(4), name, text, at: Date.now(), by: me.name });
    }
    if (path === '/api/sun-del') { const x = L.find(y => y.id === str(b.id, 20)); if (!x) return json({ ok: false, error: '이미 지워졌어요' }); if (x.by !== me.name && !me.boss) return json({ ok: false, error: '넣은 사람이나 관리자만 지울 수 있어요' }); L = L.filter(y => y !== x); }
    if (path !== '/api/sun-list') await run(env, 'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, JSON.stringify(L));
    return json({ ok: true, month: mon, list: L, sb: await sbNames(env) });
  }
  if (path === '/api/hw-del') { await run(env, 'UPDATE hw SET del = 1, upd = ? WHERE id = ?', Date.now(), str(b.id, 40)); return json({ ok: true }); }
  if (path === '/api/clean-check') { // 그 주 청소 담당자만 체크
    const wk = /^w:\d{4}-\d{2}-\d{2}$/.test(String(b.day || '')), day = wk ? b.day : isDay(b.day) ? b.day : kstDay(), task = str(b.task, 40), c = await cleanConf(env), who = cleanWho(c, wk ? day.slice(2) : day);
    if (who !== me.id) return json({ ok: false, error: '이번 주 청소 담당자만 체크할 수 있어요' });
    if (!(wk ? (c.daily || []) : cleanTasks(c, day)).includes(task)) return json({ ok: false, error: '없는 청소예요' });
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
  // 한 파일 백업 (관리자 + 관리자 비밀번호) — 화면이 표마다 나눠 받아서 zip 하나로 묶음
  if (path === '/api/backup-start') {
    const nb = needBoss(); if (nb) return nb;
    const r = await attSync(env, '/sync/dlpin-check', { pin: str(b.pw, 100), who: me.name }); if (!r.ok) return json(r);
    const bk = rid(16); await run(env, 'INSERT INTO kv (k, v) VALUES (?, ?)', 'bktok:' + bk, JSON.stringify({ mid: me.id, exp: Date.now() + 30 * 60e3 }));
    await run(env, "DELETE FROM kv WHERE k LIKE 'bktok:%' AND json_extract(v, '$.exp') < ?", Date.now());
    const nt = await noticeSync(env, '/sync/bk-tables', {});
    return json({ ok: true, bk, team: await bkTables(env), notice: nt.ok ? nt.tables : [], noticeErr: nt.ok ? '' : nt.error || '' });
  }
  if (path === '/api/backup-part' || path === '/api/backup-done') {
    const t = J((await one(env, 'SELECT v FROM kv WHERE k = ?', 'bktok:' + str(b.bk, 40)) || {}).v, null);
    if (!t || t.mid !== me.id || t.exp < Date.now()) return json({ ok: false, error: '시간이 지났어요. 처음부터 다시 받아 주세요' });
    if (path === '/api/backup-done') {
      const ym = kstDay().slice(0, 7);
      await run(env, "INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", 'bk:' + ym, JSON.stringify({ at: Date.now(), name: me.name }));
      if (kstDay().slice(8) <= '10') await run(env, 'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO NOTHING', 'bk:' + addDays(kstDay().slice(0, 8) + '01', -1).slice(0, 7), JSON.stringify({ at: Date.now(), name: me.name }));
      await run(env, 'DELETE FROM kv WHERE k = ?', 'bktok:' + str(b.bk, 40));
      for (const r of await all(env, "SELECT k, v FROM kv WHERE k LIKE 'rstok:%'")) { const v = J(r.v, {}); if (v.bk === str(b.bk, 40)) { v.saved = true; await run(env, 'UPDATE kv SET v = ? WHERE k = ?', JSON.stringify(v), r.k); } } // 백업 다시 넣기 전 '지금 상태 받기'를 마침
      await addLog(env, me.id, 'backup', me.name + '님이 앱 전체 백업 파일을 받았어요', '');
      return json({ ok: true });
    }
    if (b.app === 'att') return json(await attSync(env, '/sync/export', {}));
    if (b.app === 'notice') return json(await noticeSync(env, '/sync/bk-dump', { table: str(b.table, 30), after: b.after }));
    return json(await bkDump(env, str(b.table, 30), b.after));
  }
  // 백업 다시 넣기 (2026-11-13): 관리자 + 관리자 비밀번호 → 지금 상태를 먼저 백업으로 받아야(backup-done) 넣을 수 있음
  if (path === '/api/restore-start') {
    const nb = needBoss(); if (nb) return nb;
    const r = await attSync(env, '/sync/dlpin-check', { pin: str(b.pw, 100), who: me.name }); if (!r.ok) return json(r);
    const bk = rid(16), rs = rid(16);
    await run(env, "DELETE FROM kv WHERE (k LIKE 'bktok:%' OR k LIKE 'rstok:%') AND json_extract(v, '$.exp') < ?", Date.now());
    await run(env, 'INSERT INTO kv (k, v) VALUES (?, ?)', 'bktok:' + bk, JSON.stringify({ mid: me.id, exp: Date.now() + 30 * 60e3 }));
    await run(env, 'INSERT INTO kv (k, v) VALUES (?, ?)', 'rstok:' + rs, JSON.stringify({ mid: me.id, exp: Date.now() + 60 * 60e3, bk, saved: false }));
    const nt = await noticeSync(env, '/sync/rs-count', {});
    return json({ ok: true, bk, rs, team: await bkTables(env), notice: nt.ok ? nt.tables : [], noticeErr: nt.ok ? '' : nt.error || '', counts: { team: await rsCounts(env), notice: nt.ok ? nt.counts : {} }, pks: { team: await rsPks(env), notice: nt.ok ? nt.pks : {} } });
  }
  if (path === '/api/restore-part' || path === '/api/restore-done') {
    const nb = needBoss(); if (nb) return nb;
    const t = J((await one(env, 'SELECT v FROM kv WHERE k = ?', 'rstok:' + str(b.rs, 40)) || {}).v, null);
    if (!t || t.mid !== me.id || t.exp < Date.now()) return json({ ok: false, error: '시간이 지났어요. 처음부터 다시 해 주세요' });
    if (!t.saved) return json({ ok: false, error: '지금 상태 백업을 먼저 받아 주세요' });
    if (path === '/api/restore-done') {
      await run(env, 'DELETE FROM kv WHERE k = ?', 'rstok:' + str(b.rs, 40));
      await run(env, "INSERT INTO kv (k, v) VALUES ('restoredAt', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", String(Date.now())); // 열려 있는 업무 앱은 다시 불러옴
      await bumpKv(env); // 백업의 rosterIds가 남아 있어서, 그 뒤 출석부에서 바뀐 이름은 10분 맞춤 때 따라감
      if ((b.apps || []).includes('notice')) await noticeSync(env, '/sync/rs-done', {});
      await addLog(env, me.id, 'backup', me.name + '님이 백업 파일을 다시 넣었어요 (' + (b.apps || []).map(a => a === 'notice' ? '알림' : '업무').join('·') + (b.from ? ' · ' + str(b.from, 30) : '') + ')', '');
      return json({ ok: true });
    }
    const app = b.app === 'notice' ? 'notice' : 'team', table = str(b.table, 30);
    if (app === 'notice') return json(await noticeSync(env, b.keep ? '/sync/rs-sweep' : '/sync/rs-put', b.keep ? { table, keep: b.keep, n: b.n } : { table, rows: b.rows }));
    return json(b.keep ? await rsSweep(env, table, b.keep, b.n) : await rsPut(env, table, b.rows));
  }
  if (path === '/api/dl-check') { if (!me.boss) return json({ ok: false, error: '백업 파일은 관리자만 받을 수 있어요' }); return json(await attSync(env, '/sync/dlpin-check', { pin: String(b.pin || ''), who: me.name })); } // 성장 측정 백업: 관리자 + 관리자 비밀번호
  if (path === '/api/member-pin') { // 내 PIN 바꾸기, 또는 다른 사람 PIN 새로 정하기
    const pin = String(b.pin || '');
    if (!/^\d{4,6}$/.test(pin)) return json({ ok: false, error: 'PIN은 숫자 4~6자리로 정해 주세요' });
    const mid = str(b.mid || me.id, 40), salt = rid(8);
    if (mid !== me.id) { const nb = needBoss(); if (nb) return nb; }
    if (mid === me.id && me.shared) return json({ ok: false, error: '공용 계정 PIN은 관리자만 바꿀 수 있어요' });
    if (mid === me.id) { const m = await one(env, 'SELECT * FROM members WHERE id = ?', me.id); if (!(await sameText(await pinHash(m.salt, b.old), m.pin))) return json({ ok: false, error: '지금 PIN이 맞지 않아요' }); if (await sameText(await pinHash(m.salt, pin), m.pin)) return json({ ok: false, error: '지금과 다른 PIN으로 정해 주세요' }); }
    const tgt = await one(env, 'SELECT shared FROM members WHERE id = ?', mid);
    await run(env, 'UPDATE members SET salt = ?, pin = ?, mustpin = ? WHERE id = ?', salt, await pinHash(salt, pin), mid === me.id || (tgt && tgt.shared) ? 0 : 1, mid);
    if (mid !== me.id) await run(env, 'DELETE FROM sessions WHERE mid = ?', mid);
    return json({ ok: true });
  }
  if (path === '/api/member-del') {
    const nbd = needBoss(); if (nbd) return nbd;
    const mid = str(b.mid, 40); if (mid === me.id) return json({ ok: false, error: '나는 지울 수 없어요' });
    await env.DB.batch([q(env, 'DELETE FROM members WHERE id = ?', mid), q(env, 'DELETE FROM sessions WHERE mid = ?', mid), q(env, 'DELETE FROM subs WHERE mid = ?', mid)]);
    ctx.waitUntil(attSync(env, '/sync/staff-gone', { mid }).catch(() => {})); // 출석부 로그인도 끝
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
      all(env, 'SELECT id, name, role, boss, shared, ledger FROM members ORDER BY shared, created'),
      first ? all(env, 'SELECT * FROM (SELECT id, mid, text, photo, refs, reply, rx, upd, at, room, ed FROM msgs WHERE (room IS NULL OR room = \'\' OR instr(room, ?) > 0) ORDER BY id DESC LIMIT 300) ORDER BY id', me.id) : all(env, 'SELECT id, mid, text, photo, refs, reply, rx, upd, at, room, ed FROM msgs WHERE (id > ? OR (upd > ? AND id <= ?)) AND (room IS NULL OR room = \'\' OR instr(room, ?) > 0) ORDER BY id LIMIT 300', lastMsg, since, lastMsg, me.id),
      all(env, 'SELECT id, type, data, upd, del, mid FROM items WHERE upd > ?' + (first ? ' AND del = 0' : ''), since),
      all(env, 'SELECT id, item, mid, text, at FROM comments WHERE at > ?', since),
      all(env, 'SELECT day, data, upd FROM pickup WHERE upd > ? AND day >= ?', since, addDays(kstDay(), -7)),
      first ? all(env, 'SELECT * FROM (SELECT id, mid, kind, text, ref, at FROM logs ORDER BY id DESC LIMIT 120) ORDER BY id') : all(env, 'SELECT id, mid, kind, text, ref, at FROM logs WHERE at > ? ORDER BY id LIMIT 200', since),
    ]);
    const joins = await all(env, "SELECT id, name, created FROM joins WHERE status = 'wait' AND created > ?", Date.now() - 7 * 86400e3);
    const hidden = (await all(env, 'SELECT id FROM mhide WHERE mid = ? AND at > ?', me.id, since)).map(r => r.id);
    const esigns = (await all(env, 'SELECT ev, kid, data, rel, cancel, state, at, upd FROM esign WHERE upd > ?', first ? Date.now() - 120 * 86400e3 : since)).map(r => ({ ...r, data: J(r.data, {}) }));
    const td = kstDay(), kvs = await all(env, "SELECT k, v FROM kv WHERE k IN ('pickupDefault', 'pickupTimes', 'notice', 'clean', 'roles', 'kioskMulti', 'restoredAt', 'cats', 'egrps', 'testOnly', ?)", 'pkchk:' + td), kv = k => (kvs.find(x => x.k === k) || {}).v;
    const cleanchk = await all(env, 'SELECT day, task, mid, at FROM cleanchk WHERE day >= ?', addDays(td, -14));
    const pmsg = (await all(env, 'SELECT * FROM pmsg WHERE upd > ? AND at > ?', since, Date.now() - 60 * 86400e3)).map(r => ({ ...r, short: pmShort(r) }));
    const hws = await all(env, 'SELECT id, data, upd, del, mid FROM hw WHERE upd > ?', since), hwchk = hws.length ? await all(env, 'SELECT hw, kid, day, at, rel FROM hwchk WHERE hw IN (' + hws.map(() => '?').join(',') + ')', ...hws.map(h => h.id)) : [];
    const bkYm = addDays(td, 1).slice(8) === '01' ? td.slice(0, 7) : td.slice(8) <= '10' ? addDays(td.slice(0, 8) + '01', -1).slice(0, 7) : ''; // 말일 ~ 다음 달 10일
    const bkDue = me.boss && bkYm && !(await one(env, 'SELECT v FROM kv WHERE k = ?', 'bk:' + bkYm)) ? bkYm : '';
    const readAt = J((await one(env, 'SELECT v FROM kv WHERE k = ?', 'read:' + me.id) || {}).v, null);
    return json({ ok: true, now: Date.now(), me, members, bkDue, readAt, restoredAt: kv('restoredAt') || '', cats: J(kv('cats'), null), egrps: (v => Array.isArray(v) && v.length ? v : EGRP0)(J(kv('egrps'), null)), testOnly: J(kv('testOnly'), null), outReq: (await all(env, "SELECT v FROM kv WHERE k LIKE 'outreq:%'")).map(r => J(r.v, null)).filter(Boolean), delReq: (await all(env, "SELECT v FROM kv WHERE k LIKE 'delreq:%'")).map(r => J(r.v, null)).filter(Boolean),
      msgs: msgs.map(fixMsg), hidden, logs, joins, docNew: me.boss ? ((await one(env, 'SELECT COUNT(*) AS n FROM contracts WHERE del = 0 AND sid IS NULL')) || {}).n || 0 : 0, esigns, notice: J(kv('notice'), null),
      clean: J(kv('clean'), null), cleanchk, roles: J(kv('roles'), ROLES0), kioskMulti: kv('kioskMulti') === '1', pmsg, ptpl: await ptplGet(env), rels: RELS,
      hw: hws.map(h => ({ id: h.id, upd: h.upd, del: !!h.del, mid: h.mid, ...J(h.data, {}), chk: hwchk.filter(c => c.hw === h.id) })), pkchk: { day: td, v: J(kv('pkchk:' + td), null) },
      items: items.map(i => ({ id: i.id, type: i.type, del: !!i.del, upd: i.upd, mid: i.mid, ...J(i.data, {}) })).map(i => canSee(i, me) ? i : { id: i.id, type: i.type, del: true, upd: i.upd }).filter(i => !(first && i.del)),
      comments, pickup: pickup.map(p => ({ day: p.day, upd: p.upd, ...J(p.data, {}) })), pickupDefault: J(kv('pickupDefault'), {}), pickupTimes: J(kv('pickupTimes'), {}) });
  }
  if (path === '/api/more-msgs') return json({ ok: true, msgs: (await all(env, 'SELECT id, mid, text, photo, refs, reply, rx, upd, at, room, ed FROM msgs WHERE id < ? AND coalesce(room, \'\') = ? ORDER BY id DESC LIMIT 100', b.before | 0, roomOk(String(b.room || ''), me.id) ? String(b.room || '') : '')).reverse().map(fixMsg) });

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
  if (path === '/api/msg-edit') { // 내가 보낸 글 고치기
    const m = await one(env, 'SELECT mid, text FROM msgs WHERE id = ?', b.id | 0), text = str(b.text, 2000).trim();
    if (!m || m.mid !== me.id) return json({ ok: false, error: '내가 보낸 메시지만 고칠 수 있어요' });
    if (m.text === '(지운 메시지)') return json({ ok: false, error: '지운 메시지예요' });
    if (!text) return json({ ok: false, error: '내용을 적어 주세요' });
    const now = Date.now(); await run(env, 'UPDATE msgs SET text = ?, ed = ?, upd = ? WHERE id = ?', text, now, now, b.id | 0);
    const n = J((await one(env, "SELECT v FROM kv WHERE k = 'notice'") || {}).v, null);
    if (n && n.id === (b.id | 0)) await run(env, "UPDATE kv SET v = ? WHERE k = 'notice'", JSON.stringify({ ...n, text }));
    return json({ ok: true, ed: now });
  }
  if (path === '/api/msg-hide') { // 나만 삭제 (내 화면에서만 안 보이게, 다른 사람은 그대로)
    await run(env, 'INSERT INTO mhide (mid, id, at) VALUES (?, ?, ?) ON CONFLICT(mid, id) DO NOTHING', me.id, b.id | 0, Date.now());
    return json({ ok: true });
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
  if (path === '/api/students') { const r = await attSync(env, '/sync/students', {}); if (r.ok && !me.boss) r.students = r.students.filter(s => s.status !== '퇴관'); return json(r); } // 퇴관 명단은 관리자만
  if (path === '/api/student-delete') { // 🗑 원생 삭제 (2026-11-14 사용자 결정: 관리자만, 한쪽에서 지우면 다 같이) — dry: 무엇이 지워지는지 먼저 보여 줌
    const nb = needBoss(); if (nb) return nb;
    const sid = str(b.sid, 60), r = await attSync(env, '/sync/student-delete', { sid, dry: !!b.dry }); if (!r.ok) return json(r);
    if (!b.dry) {
      if (!r.same) { // 등원·픽업 기본 명단·시간에서 이름 빼기 (같은 이름 원생이 남아 있으면 그대로)
        const d = J((await one(env, "SELECT v FROM kv WHERE k = 'pickupDefault'") || {}).v, {}), t = J((await one(env, "SELECT v FROM kv WHERE k = 'pickupTimes'") || {}).v, {});
        for (const w of Object.keys(d)) if (Array.isArray(d[w])) d[w] = d[w].filter(x => x !== r.name);
        for (const w of Object.keys(t)) if (t[w] && typeof t[w] === 'object') delete t[w][r.name];
        await run(env, "INSERT INTO kv (k, v) VALUES ('pickupDefault', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", JSON.stringify(d));
        await run(env, "INSERT INTO kv (k, v) VALUES ('pickupTimes', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", JSON.stringify(t));
      }
      const g = J((await one(env, "SELECT v FROM kv WHERE k = 'kgoal'") || {}).v, null); if (g && sid in g) { delete g[sid]; await run(env, "UPDATE kv SET v = ? WHERE k = 'kgoal'", JSON.stringify(g)); }
      await run(env, 'DELETE FROM kv WHERE k = ?', 'outreq:' + sid);
      await addLog(env, me.id, 'kid', '🗑 ' + me.name + '님이 ' + r.name + ' 원생을 지웠어요 (출석부·학부모 앱·태블릿)', '');
      await bumpKv(env);
    }
    return json(r);
  }
  if (path === '/api/student-save' && !me.boss && b.student && b.student.status === '퇴관') { // 직원이 퇴관으로 바꾸면 관리자 승인 대기 (2026-11-13)
    const cur = ((await attSync(env, '/sync/students', {})).students || []).find(x => x.id === b.student.id);
    if (cur && cur.status !== '퇴관') {
      const sid = str(cur.id, 60), last = (b.student.statusLog || []).slice(-1)[0] || {};
      await run(env, "INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", 'outreq:' + sid, JSON.stringify({ sid, name: cur.name, from: cur.status, date: str(last.date, 10), why: str(last.why, 200), mid: me.id, who: me.name, at: Date.now() }));
      await addLog(env, me.id, 'kid', me.name + '님이 ' + cur.name + ' 퇴관을 요청했어요 (관리자 승인 대기)', '');
      const subs = await all(env, 'SELECT s.* FROM subs s JOIN members m ON m.id = s.mid WHERE m.boss = 1 AND s.mid <> ?', me.id);
      ctx.waitUntil(pushTo(env, subs, '해랑 업무 · 퇴관 승인', cur.name + ' 퇴관 요청 (' + me.name + ')', 'home').catch(() => {}));
      await bumpKv(env);
      return json({ ok: true, pending: true, id: sid });
    }
  }
  if (path === '/api/delreq-no') { // 관리자: 삭제 요청 돌려보내기 (승인은 그냥 /api/item-del)
    const nb = needBoss(); if (nb) return nb;
    const k = 'delreq:' + str(b.id, 40), rq = J((await one(env, 'SELECT v FROM kv WHERE k = ?', k) || {}).v, null);
    await run(env, 'DELETE FROM kv WHERE k = ?', k); if (rq) await addLog(env, me.id, rq.type, me.name + '님이 \'' + rq.title + '\' 삭제 요청을 돌려보냈어요', rq.id); await bumpKv(env);
    return json({ ok: true });
  }
  if (path === '/api/outreq-ok' || path === '/api/outreq-no') { // 관리자: 퇴관 요청 승인·거절
    const nb = needBoss(); if (nb) return nb;
    const k = 'outreq:' + str(b.sid, 60), rq = J((await one(env, 'SELECT v FROM kv WHERE k = ?', k) || {}).v, null);
    if (!rq) return json({ ok: false, error: '이미 처리된 요청이에요' });
    if (path === '/api/outreq-no') { await run(env, 'DELETE FROM kv WHERE k = ?', k); await addLog(env, me.id, 'kid', me.name + '님이 ' + rq.name + ' 퇴관 요청을 돌려보냈어요', ''); await bumpKv(env); return json({ ok: true }); }
    const cur = ((await attSync(env, '/sync/students', {})).students || []).find(x => x.id === rq.sid);
    if (!cur) { await run(env, 'DELETE FROM kv WHERE k = ?', k); return json({ ok: false, error: '출석부에 없는 원생이에요' }); }
    const d = rq.date || kstDay(), n = { ...cur, status: '퇴관', leavePeriods: (cur.leavePeriods || []).map(p => p.end ? p : { ...p, end: d }) };
    n.statusLog = [...(cur.statusLog || []), { date: d, from: cur.status, to: '퇴관', why: rq.why, who: rq.who + ' (승인 ' + me.name + ')', at: Date.now() }];
    const r = await attSync(env, '/sync/student-save', { student: n, history: ['회원 상태 변경: ' + cur.status + ' → 퇴관 (' + rq.who + ' 요청, ' + me.name + ' 승인)'].concat(rq.why ? ['사유: ' + rq.why + ' (' + d + ')'] : []), upd: cur.upd, who: me.name, noRevive: false });
    if (!r.ok) return json(r);
    await run(env, 'DELETE FROM kv WHERE k = ?', k); await addLog(env, me.id, 'kid', me.name + '님이 ' + rq.name + ' 퇴관을 승인했어요', ''); await bumpKv(env);
    return json({ ok: true });
  }
  if (path === '/api/student-save') return json(await attSync(env, '/sync/student-save', { student: b.student, history: b.history, upd: b.upd, who: me.name, noRevive: !me.boss }));
  if (path === '/api/student-history') return json(await attSync(env, '/sync/history', { sid: str(b.sid, 60) }));
  // 첫 화면 카드: 학부모 앱 가입 승인 대기 수
  if (path === '/api/dash') { const r = await noticeSync(env, '/sync/pending', {}); return json({ ok: true, pending: r.ok ? r.pending : null, hpSkip: J((await one(env, "SELECT v FROM kv WHERE k = 'hpEvSkip'") || {}).v, []) }); }
  if (path === '/api/dsched') { // 업무 앱 달력의 📣 도장 일정 (알림 관리 일정표, 2026-11-13)
    const r = await noticeSync(env, '/sync/schedule', { from: isDay(b.from) ? b.from : '', to: isDay(b.to) ? b.to : '' });
    return json(r.ok ? { ok: true, items: r.items || [] } : { ok: false, error: r.error || '알림 관리 일정표를 불러오지 못했어요', items: [] });
  }
  if (path === '/api/cneed') { const r = await attSync(env, '/sync/cneed', {}); return json(r.ok ? { ok: true, list: r.list || [] } : r); } // 대시보드 '연락 필요' 카드 빨리 새로 (2026-11-13)
  if (path === '/api/hpev-skip') { // 홈페이지 행사 '행사표에 등록 안 함' (2026-11-13, 직원 모두에게서 사라짐)
    const k = str(b.key, 120); if (!k) return json({ ok: false, error: '행사를 확인해 주세요' });
    const list = [...new Set([...J((await one(env, "SELECT v FROM kv WHERE k = 'hpEvSkip'") || {}).v, []), k])].slice(-200);
    await run(env, "INSERT INTO kv (k, v) VALUES ('hpEvSkip', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", JSON.stringify(list));
    await addLog(env, me.id, 'event', '🎟 홈페이지 행사 행사표에 안 넣음: ' + k.split('|')[1], '');
    return json({ ok: true, list });
  }

  // 할 일 · 일정 · 행사표 · 구매표 저장 (what: 알림에 쓸 한 줄)
  if (path === '/api/item') {
    const old = b.item && b.item.type === 'event' && b.item.id ? await one(env, "SELECT data FROM items WHERE id = ? AND type = 'event'", str(b.item.id, 40)) : null;
    if (old && J(old.data, {}).sp && !b.item.sp) b.item.sp = J(old.data, {}).sp; // 일정표 연결은 오래된 화면이 저장해도 유지
    const r = itemStmt(env, b.item || {}, me); if (!r) return json({ ok: false, error: '제목을 적어 주세요' });
    await r.stmt.run();
    if (r.type === 'event') { // 행사표에 들어간 학부모 신청은 '넣음'으로
      const names = (Array.isArray(b.item.rows) ? b.item.rows : []).map(x => str(x && x.name, 20)).filter(Boolean).slice(0, 200);
      if (names.length) await run(env, "UPDATE esign SET state = 'in' WHERE ev = ? AND state = '' AND kid IN (" + names.map(() => '?').join(',') + ')', r.id, ...names);
      const nd = b.item || {}, od = old ? J(old.data, {}) : null; let sp = od ? od.sp : null, spErr = '';
      if (!sp && b.toParents && nd.date && nd.kind !== 'goods') { // 업무 앱에서 만든 신청표를 학부모님께 전달 → 날짜가 있으면 알림 관리 일정표에도 (2026-11-13)
        const x = await noticeSync(env, '/sync/sched-add', { ev: r.id, title: nd.title, date: nd.date, body: str(nd.desc, 1000), kind: /대회/.test(nd.title) ? '대회' : /심사/.test(nd.title) ? '심사' : '행사' });
        if (x.ok && x.id) { sp = x.id | 0; const cur = await one(env, 'SELECT data FROM items WHERE id = ?', r.id); await run(env, 'UPDATE items SET data = ? WHERE id = ?', JSON.stringify({ ...J(cur.data, {}), sp }), r.id); } else spErr = x.error || '알림 관리 일정표에 넣지 못했어요';
      } else if (sp && od && (od.title !== nd.title || (od.date || '') !== (nd.date || '')) && nd.date) {
        const x = await noticeSync(env, '/sync/sched-upd', { id: sp, title: nd.title, date: nd.date }); if (!x.ok) spErr = x.error || '알림 관리 일정표를 바꾸지 못했어요';
      }
      b._sp = sp; b._spErr = spErr;
      if (old && Array.isArray(b.rm) && b.rm.length) ctx.waitUntil(staffCancel(env, r.id, J(old.data, {}), b.item, names, b.rm.map(x => str(x, 20)), me).catch(() => {})); // 업무 앱에서 명단에서 빼면 학부모 앱도 취소 + 알림 (2026-11-13)
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
      return json({ ok: true, id: r.id, upd: r.upd, sp: b._sp || null, spErr: b._spErr || '' });
    }
    if (b.what !== false) notify(me.name, String(b.what || (b.item.id ? r.title + ' 수정' : TYPE_KO[r.type] + ' 추가: ' + r.title)).slice(0, 140), r.type, r.id);
    return json({ ok: true, id: r.id, upd: r.upd, sp: b._sp || null, spErr: b._spErr || '' });
  }
  if (path === '/api/item-del') {
    const it = await one(env, 'SELECT type, data FROM items WHERE id = ?', str(b.id, 40)); if (!it) return json({ ok: true });
    if (!me.boss && (it.type === 'event' || it.type === 'buy')) { // 행사·물품·구매표 삭제는 관리자 승인 (2026-11-13 사용자 결정)
      const id = str(b.id, 40), d = J(it.data, {});
      await run(env, 'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', 'delreq:' + id, JSON.stringify({ id, title: d.title || '', type: it.type, kind: d.kind || '', mid: me.id, who: me.name, at: Date.now() }));
      await addLog(env, me.id, it.type, me.name + '님이 \'' + (d.title || '') + '\' 삭제를 요청했어요 (관리자 승인 대기)', id);
      const subs = await all(env, 'SELECT s.* FROM subs s JOIN members m ON m.id = s.mid WHERE m.boss = 1 AND s.mid <> ?', me.id);
      ctx.waitUntil(pushTo(env, subs, '해랑 업무 · 삭제 승인', (d.title || '') + ' 삭제 요청 (' + me.name + ')', 'home').catch(() => {}));
      await bumpKv(env);
      return json({ ok: true, pending: true });
    }
    await run(env, "DELETE FROM kv WHERE k = ?", 'delreq:' + str(b.id, 40));
    const spd = it.type === 'event' ? J(it.data, {}).sp : null; if (spd) ctx.waitUntil(noticeSync(env, '/sync/sched-upd', { id: spd, del: true }).catch(() => {})); // 일정은 남기고 연결만 풂
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
      const t = {}; for (const w of ['월', '화', '수', '목', '금']) { t[w] = {}; for (const [n, x] of Object.entries(b.times[w] || {}).slice(0, 100)) { const v = String(x || ''); if (/^\d{2}:\d{2}$/.test(v)) t[w][str(n, 20)] = v; } } // 기본 명단에 없는 제자도 시간 저장 (대시보드 '픽업 수정', 2026-11-13)
      await run(env, "INSERT INTO kv (k, v) VALUES ('pickupTimes', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", JSON.stringify(t));
    }
    return json({ ok: true });
  }
  if (path === '/api/pickup') {
    if (!isDay(b.day)) return json({ ok: false, error: '날짜' });
    const d = cleanPickup(b), upd = Date.now();
    const prev = J((await one(env, 'SELECT data FROM pickup WHERE day = ?', b.day) || {}).data, {}).absent || [];
    await run(env, 'INSERT INTO pickup (day, data, upd) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET data = excluded.data, upd = excluded.upd', b.day, JSON.stringify(d), upd);
    // 픽업표 결석 → 출석부 결석 예정 (2026-11-13). 취소하면 픽업표가 넣은 것만 지움
    const add = d.absent.filter(n => !prev.includes(n)), del = prev.filter(n => !d.absent.includes(n));
    if (add.length) ctx.waitUntil(attSync(env, '/sync/absence', { items: add.slice(0, 10).map(name => ({ name, date: b.day, why: '픽업표 결석' })) }).catch(() => {}));
    if (del.length) ctx.waitUntil(attSync(env, '/sync/absence-clear', { items: del.slice(0, 10).map(name => ({ name, date: b.day })) }).catch(() => {}));
    if (b.what) notify(me.name + ' · 등원', String(b.what).slice(0, 140), 'pickup', b.day);
    return json({ ok: true, upd });
  }
  if (path === '/api/pickup-absent') { // 등원표: 출석부에서 결석인 아이
    const r = await attSync(env, '/sync/day-absent', { day: isDay(b.day) ? b.day : kstDay() });
    return json(r.ok ? { ok: true, names: r.names || [] } : { ok: false, names: [] });
  }
  // 원생 화면: 학부모 앱 가족 초대번호(QR)·가입 상태 (알림 서버에 있음) — 2026-11-13
  if (path === '/api/kid-family') return json(await noticeSync(env, '/sync/kid-family', { name: str(b.name, 20) }));
  if (path === '/api/kid-fam') { // 형제·자매 묶기 {sid, with} / 풀기 {sid, off}
    if (me.shared) return json({ ok: false, error: '공용 계정으로는 바꿀 수 없어요' });
    const r = await attSync(env, '/sync/students', {}); if (!r.ok) return json(r);
    const L = r.students || [], a = L.find(x => x.id === str(b.sid, 60)); if (!a) return json({ ok: false, error: '원생을 찾지 못했어요' });
    if (b.off) { await attSync(env, '/sync/fam-set', { sids: [a.id], famId: '', who: me.name }); const left = L.filter(x => x.famId && x.famId === a.famId && x.id !== a.id); if (left.length === 1) await attSync(env, '/sync/fam-set', { sids: [left[0].id], famId: '', who: me.name }); }
    else {
      const o = L.find(x => x.id === str(b.with, 60)); if (!o || o.id === a.id) return json({ ok: false, error: '묶을 원생을 골라 주세요' });
      const fam = a.famId || o.famId || 'f' + rid(6), ids = L.filter(x => x.id === a.id || x.id === o.id || (x.famId && (x.famId === a.famId || x.famId === o.famId))).map(x => x.id);
      await attSync(env, '/sync/fam-set', { sids: ids, famId: fam, who: me.name });
    }
    await addLog(env, me.id, 'pickup', '👨‍👩‍👧 형제·자매 ' + (b.off ? '묶음 풀기: ' + a.name : '묶음: ' + a.name), '');
    return json({ ok: true });
  }
  if (path === '/api/inv-tpl') { // 가족 초대 안내 문구 (관리자가 기본 문구 저장)
    if (b.tpl != null) { const nb = needBoss(); if (nb) return nb; await run(env, "INSERT INTO kv (k, v) VALUES ('invTpl', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", str(b.tpl, 2000)); return json({ ok: true }); }
    return json({ ok: true, tpl: ((await one(env, "SELECT v FROM kv WHERE k = 'invTpl'")) || {}).v || '' });
  }
  if (path === '/api/kid-invite') {
    if (me.shared) return json({ ok: false, error: '공용 계정으로는 만들 수 없어요' });
    const r = await noticeSync(env, '/sync/invite-save', { code: b.code ? str(b.code, 10) : '', name: str(b.name, 30), kids: Array.isArray(b.kids) ? b.kids.map(x => str(x, 20)).slice(0, 6) : [], max: b.max | 0, off: !!b.off });
    if (r.ok) await addLog(env, me.id, 'pickup', '🔑 가족 초대번호 ' + (b.code ? '수정' : '만듦') + ': ' + str(b.name, 30), '');
    return json(r);
  }
  if (path === '/api/roster-all') { // 출석부 원생 회원 상태 (퇴관 포함) — 등원표에서 휴원·퇴관 빼기, 기네스 결과지 회원 상태
    const r = await attSync(env, '/sync/roster', { all: true });
    return json(r.ok ? { ok: true, students: r.students.map(s => ({ id: s.id, name: s.name, birth: s.birth || '', status: s.status || '재원' })) } : { ok: false, students: [], error: r.error }); // id: 성장 측정이 출석부 원생 번호로 이어짐
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
  return; // 2026-11-13 사용자 결정: 사범님 PIN은 업무 앱에서만 (출석부 사범님을 더는 가져오지 않음. 출석부가 업무 앱 PIN으로 로그인)
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
// 승급 심사 → 성장 측정지 자동 (2026-11-14, '해랑경희 웹앱 의견 정리' 3번): 02 집중과 자기조절 ← 품새, 04 자신감과 표현력 ← 웅변·영어, 05 배려와 리더십 ← 예절·태도(켰을 때만)
// 그 달이 든 분기(1~3·4~6·7~9·10~12월) 안에서 그 달까지 마감한 심사의 평균 점수 → 기준(기본 4.5 이상 아주 잘해요, 3.5 이상 잘해요)
const examTh = st => { const t = (st && st.examTh) || {}; return { hi: +(t.hi ?? 4.5), mid: +(t.mid ?? 3.5) }; };
async function examClosed(env) { // 마감한 달만: { 'YYYY-MM': { meta, rows:[{sid, name, d}] } }
  const ms = (await all(env, "SELECT k, v FROM kv WHERE k LIKE 'exam:%'")).map(r => ({ m: r.k.slice(5), meta: J(r.v, {}) })).filter(x => x.meta.closed && /^\d{4}-\d{2}$/.test(x.m));
  const out = {}; if (!ms.length) return out; ms.forEach(x => { out[x.m] = { meta: x.meta, rows: [] }; });
  const rs = await all(env, 'SELECT month, sid, name, data FROM exam WHERE month IN (' + ms.map(() => '?').join(',') + ')', ...ms.map(x => x.m));
  rs.forEach(r => { out[r.month].rows.push({ sid: r.sid, name: r.name, d: J(r.data, {}) }); }); return out;
}
const examRowOf = (m, who) => m.rows.find(r => who.sid && r.sid === who.sid) || (!who.sid || !m.rows.some(r => r.sid === who.sid) ? m.rows.find(r => r.name === who.name) : null);
function examAuto(ex, who, month, th) {
  const y = +month.slice(0, 4), q0 = Math.floor((+month.slice(5) - 1) / 3) * 3 + 1, sum = { poom: [], talk: [], manner: [] }; let n = 0;
  for (let mo = q0; mo <= +month.slice(5); mo++) { const m = ex[y + '-' + String(mo).padStart(2, '0')]; if (!m) continue; const r = examRowOf(m, who); if (!r || r.d.absent) continue; const sc = r.d.sc || {}; let any = false;
    if (sc.poom) { sum.poom.push(+sc.poom); any = true; } ['speech', 'eng'].forEach(k => { if (sc[k]) { sum.talk.push(+sc[k]); any = true; } }); if (sc.manner) { sum.manner.push(+sc.manner); any = true; } if (any) n++; }
  const lv = a => { if (!a.length) return null; const v = a.reduce((x, z) => x + z, 0) / a.length; return v >= th.hi ? '아주 잘해요' : v >= th.mid ? '잘해요' : '성장 중이에요'; };
  return { a0: lv(sum.poom), a2: lv(sum.talk), a3: lv(sum.manner), n };
}
function examList(ex, who) { // 학부모 앱 '심사': 마감한 달마다 (최근 12달)
  const cfg = examCfg(null).subj;
  return Object.keys(ex).sort().slice(-12).map(m => { const r = examRowOf(ex[m], who); if (!r) return null; const d = r.d, meta = ex[m].meta;
    return { month: m, date: meta.date || '', absent: !!d.absent, pass: d.pass !== false, cur: d.cur || '', nb: d.nb && d.nb !== d.cur ? d.nb : '',
      subj: cfg.filter(x => d.sc && d.sc[x.k]).map(x => ({ k: x.k, n: x.n, v: d.sc[x.k], note: (meta.notes || {})[x.k] || '' })) };
  }).filter(Boolean);
}
// 승급 심사 과목 (opt: 켜고 끄는 과목 — 예절·태도는 승인되면 켬)
const EXAM_SUBJ = [{ k: 'speech', n: '웅변' }, { k: 'kick', n: '발차기' }, { k: 'eng', n: '영어' }, { k: 'poom', n: '품새' }, { k: 'manner', n: '예절·태도', opt: true }];
function examCfg(c) { const on = c && Array.isArray(c.subj) ? Object.fromEntries(c.subj.map(x => [x.k, !!x.on])) : {}; return { subj: EXAM_SUBJ.map(x => Object.assign({}, x, { on: x.opt ? !!on[x.k] : true })) }; }
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
async function pushTo(env, subs, title, body, view, now) {
  const tOnly = J((await one(env, "SELECT v FROM kv WHERE k = 'testOnly'") || {}).v, null); // 🧪 시험 모드: 고른 한 사람에게만
  if (tOnly && tOnly.mid) subs = subs.filter(x => x.mid === tOnly.mid);
  if (env.TEST_PUSH && !env.TEST_HOURS) { env.TEST_PUSH.push({ title, body, to: subs.map(x => x.mid) }); return { sent: subs.length, total: subs.length }; } // 컴퓨터 시험용
  if (!subs.length) return { sent: 0, total: 0 };
  if (!now && !staffHours()) { // 평일 12~22시 밖: 사람마다 모아 두기
    const mids = [...new Set(subs.map(x => x.mid))], at = Date.now();
    await env.DB.batch(mids.map(m => q(env, 'INSERT INTO pushhold (mid, title, body, view, at) VALUES (?, ?, ?, ?, ?)', m, str(title, 60), str(body, 300), str(view, 12), at)));
    return { sent: 0, held: mids.length, total: subs.length };
  }
  if (env.TEST_PUSH) { env.TEST_PUSH.push({ title, body, to: subs.map(x => x.mid) }); return { sent: subs.length, total: subs.length }; }
  const vapid = await getVapid(env), auths = new Map();
  const tab = { chat: 'chat', notice: 'chat', sched: 'cal', event: 'table', buy: 'table', home: 'home', pickup: 'home', todo: 'home' }[view] || 'log';
  const payload = JSON.stringify({ title, body, url: view === 'parents' ? SITE + '/notice/admin.html?from=team' : SITE + '/team/#' + tab, tag: 'team-' + Date.now() }); // 학부모 가입 요청 → 바로 알림 관리(출결) (2026-11-14)
  let sent = 0;
  // 사람마다 가장 최근 기기 2대까지만 (예전 기기가 쌓여 12대 제한에 다른 직원이 밀리던 것, 무료 CPU 한도도 아낌 — 2026-11-13)
  const per = new Map(); [...subs].sort((a, b) => (b.created || 0) - (a.created || 0)).forEach(s => { const l = per.get(s.mid) || []; if (l.length < 2) l.push(s); per.set(s.mid, l); });
  const pick = [...per.values()].flat().slice(0, 12), okEps = [];
  await Promise.all(pick.map(async s => {
    try {
      const aud = new URL(s.ep).origin;
      if (!auths.has(aud)) auths.set(aud, vapidHeader(s.ep, vapid));
      const res = await webPush({ endpoint: s.ep, p256dh: s.p256, auth: s.auth }, payload, await auths.get(aud));
      if (res.status === 404 || res.status === 410) await run(env, 'DELETE FROM subs WHERE ep = ?', s.ep); else if (res.ok) { sent++; okEps.push(s.ep); }
    } catch (_) {}
  }));
  if (okEps.length) try { await run(env, 'UPDATE subs SET last = ? WHERE ep IN (' + okEps.map(() => '?').join(',') + ')', Date.now(), ...okEps); } catch (_) {} // 마지막으로 알림이 간 때 (설정 '직원 알림 상태')
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
  const mine = kids.length ? await all(env, 'SELECT ev, kid, data, cancel, state, at FROM esign WHERE kid IN (' + kids.map(() => '?').join(',') + ')', ...kids) : [];
  const out = [], grps = await egrpGet(env), births = rows.some(r => { const e = J(r.data, {}).elig; return e && e.mode && e.mode !== 'all'; }) ? await kidBirths(env, kids) : {};
  for (const r of rows) {
    const d = J(r.data, {}); if (!d.pub || d.closed || d.kind === 'goods') continue;
    const yr = +(d.date || day).slice(0, 4), okKids = kids.filter(k => eligOk(d.elig, births[k], yr, grps, k)); if (!okKids.length) continue; // 신청 대상이 아닌 가정에는 안 보임 (2026-11-13)
    const w = evWindow(d, day); if (!w.open || (d.date && d.date < day)) continue;
    const staff = new Set((d.rows || []).map(x => x.name));
    out.push({ id: r.id, title: d.title, date: d.date || '', desc: str(d.desc, 1000), prep: str(d.prep, 300), elig: okKids, eligText: eligText(d.elig, grps), base: +d.base || 0, products: (d.products || []).map(p => ({ n: p.n, p: +p.p || 0 })), options: (d.options || []).map(o => ({ n: o.n, c: o.c || [] })), van: !!d.van, close: w.close, canEdit: w.canEdit,
      mine: kids.map(k => { const m0 = mine.find(x => x.ev === r.id && x.kid === k), m = m0 && m0.state === 'staff' && staff.has(k) ? null : m0; // 도장에서 뺐다가 다시 넣으면 다시 '도장에서 접수'
        return { kid: k, applied: !!(m && !m.cancel) || (!m && staff.has(k)), byStaff: !m && staff.has(k), cancel: !!(m && m.cancel), staffCx: !!(m && m.cancel && m.state === 'staff'), data: m ? J(m.data, {}) : null }; }) });
  }
  return out.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
}
async function esignSet(env, b, kids) {
  const kid = str(b.kid, 20), ev = str(b.ev, 40);
  if (!kids.includes(kid)) return { ok: false, error: '제자 이름을 확인해 주세요' };
  const it = await one(env, "SELECT data FROM items WHERE id = ? AND type = 'event' AND del = 0", ev); if (!it) return { ok: false, error: '없어진 행사예요' };
  const d = J(it.data, {}), day = kstDay(), w = evWindow(d, day);
  if (!d.pub || d.closed || !w.open) return { ok: false, error: '지금은 신청을 받지 않아요' };
  if (!b.cancel && d.elig && d.elig.mode && d.elig.mode !== 'all' && !eligOk(d.elig, (await kidBirths(env, [kid]))[kid], +(d.date || day).slice(0, 4), await egrpGet(env), kid)) return { ok: false, error: kid + '은(는) 이 행사 신청 대상이 아니에요' };
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
// 업무 앱 행사표에서 제자를 빼면(✕) = 도장에서 신청 취소: 학부모 앱에 '도장에서 취소했어요' + 보호자 휴대폰 알림 (2026-11-13 사용자 요청)
// 학부모 앱에서 신청했거나(esign) 학부모 앱에 보이는 행사(pub)에 직원이 넣었던 제자만. 비회원·대기·학부모가 이미 취소한 줄은 빼고.
async function staffCancel(env, ev, oldD, newD, names, rm, me) {
  if (oldD.kind === 'goods' || newD.kind === 'goods') return;
  const keep = new Set(names), gone = [...new Set(rm)].filter(n => n && !keep.has(n)).slice(0, 50);
  if (!gone.length) return;
  const now = Date.now(), title = str(newD.title || oldD.title, 100);
  for (const kid of gone) {
    const row = (oldD.rows || []).find(x => x && x.name === kid);
    if (row && (row.guest || row.wait || row.appCancel)) continue;
    const e = await one(env, 'SELECT cancel FROM esign WHERE ev = ? AND kid = ?', ev, kid);
    if (e && e.cancel) continue;
    if (!e && (!row || !newD.pub)) continue; // 학부모 앱에 안 보이는 행사에 직원이 넣었다 뺀 것은 알리지 않음
    await run(env, "INSERT INTO esign (ev, kid, data, rel, cancel, state, at, upd) VALUES (?, ?, '{}', '', 1, 'staff', ?, ?) ON CONFLICT(ev, kid) DO UPDATE SET cancel = 1, state = 'staff', upd = excluded.upd", ev, kid, now, now);
    const r = await noticeSync(env, '/sync/notify', { name: kid, title: '🎟 행사 신청이 취소되었어요', body: title + ' · ' + kid + ' 신청이 도장에서 취소되었어요. 궁금한 점은 도장에 문의해 주세요', view: 'plan' });
    await addLog(env, me.id, 'event', '🎟 ' + title + ': ' + kid + ' 신청 취소 (도장) · 학부모 ' + (r.ok ? '알림 보냄' : '알림 못 보냄' + (r.error ? ' — ' + str(r.error, 60) : '')), ev);
  }
}
// ─────────── 학부모 연락 · 미션 ───────────
async function ptplGet(env) { const r = await one(env, "SELECT v FROM kv WHERE k = 'ptpl'"); const l = r ? J(r.v, PTPL0) : PTPL0; return l.map(t => t.label === '오늘 컨디션이 안 좋아요' ? { ...t, label: '오늘은 운동을 살살 부탁드려요' } : t); } // 2026-11-13 문구 바꿈 (예전에 저장한 목록도)
// 학부모 연락 짧게: '엄마 하원' · '결석 · 아파요' (업무 앱 카드·학부모 앱 목록·확인 알림이 같이 씀)
function pmShort(m) {
  const t = m.text ? ' · ' + m.text : '';
  if (m.act === 'in' || m.act === 'out') return (m.who || m.rel || '보호자') + (m.act === 'in' ? ' 등원' : ' 하원') + t;
  if (m.act === 'absent') return '결석' + (m.why ? ' · ' + m.why : '') + t;
  if (!m.kind || m.kind === 'text') return m.text || '';
  return String(m.label || '').replace(/^오늘은? /, '') + (m.who ? ' (' + m.who + ')' : '') + (m.why ? ' · ' + m.why : '') + t;
}
async function pmsgSend(env, b, kids, ctx) {
  const kid = str(b.kid, 20); if (!kids.includes(kid)) return { ok: false, error: '제자 이름을 확인해 주세요' };
  const tpl = (await ptplGet(env)).find(t => t.id === str(b.tpl, 20)), text = str(b.text, 200).trim();
  if (!tpl && !text) return { ok: false, error: '보낼 내용을 적어 주세요' };
  const day = isDay(b.day) && b.day >= kstDay() && b.day <= addDays(kstDay(), 60) ? b.day : kstDay(), now = Date.now();
  const who = tpl && tpl.ask === 'who' ? str(b.who, 10) : '', why = tpl && tpl.ask === 'why' ? str(b.why, 30) : '';
  const label = tpl ? tpl.label : b.family ? '가족 추가 요청' : b.dayreq ? '수련 요일 변경 요청' : '직접 쓴 연락';
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
async function sbNames(env) { // 📈 성장 설정의 선범단 (퇴관 빼고)
  const g = async p => { const r = await one(env, 'SELECT data FROM gdocs WHERE path = ?', p); return r ? J(r.data, null) : null; };
  const data = await g('app/data'), st = ((await g('app/settings')) || {}).settings || {}, sb = st.sb || {}, status = st.status || {}, belts = st.belts || {};
  return ((data && data.students) || []).filter(k => k && k.name && sb[k.name + '|' + k.birth] && status[k.name + '|' + k.birth] !== '퇴관').map(k => ({ name: k.name, sid: k.sid || '', belt: belts[k.name + '|' + k.birth] || k.belt0 || '' }));
}
async function hwFor(env, kids) {
  const day = kstDay(), out = []; let sbs = null;
  for (const h of await all(env, 'SELECT id, data FROM hw WHERE del = 0')) {
    const d = J(h.data, {}); if (d.start > day || (d.end && d.end < addDays(day, -3))) continue;
    if (d.sb && !sbs) sbs = new Set((await sbNames(env)).map(x => x.name));
    const mine = kids.filter(k => (d.sb ? sbs.has(k) : true) && (!(d.kids || []).length || d.kids.includes(k))); if (!mine.length) continue;
    const chk = await all(env, 'SELECT kid, day, rel FROM hwchk WHERE hw = ? AND kid IN (' + mine.map(() => '?').join(',') + ')', h.id, ...mine);
    out.push({ id: h.id, title: d.title, body: d.body, mode: d.mode, start: d.start, end: d.end, kids: mine, chk, who: d.who === 'self' ? 'self' : 'with', sb: !!d.sb });
  }
  return out.sort((a, b) => (a.end || '9999').localeCompare(b.end || '9999'));
}

// 보호자 하원 할 일: 그 제자가 출석한 수업이 끝나기 5분 전(50분 수업 → 시작 45분 뒤)에 모두에게 알림, 한 번만
async function runPickupAlerts(env, day) {
  const now = Date.now();
  for (const it of await all(env, "SELECT id, data FROM items WHERE type = 'todo' AND del = 0 AND upd > ?", now - 3 * 86400e3)) {
    const d = J(it.data, {}); if (!d.pickupKid || d.pkAlerted || d.done || d.due !== day) continue;
    const r = await attSync(env, '/sync/kid-today', { name: d.pickupKid, day }); if (!r.ok || !r.alertAt) continue; // 아직 출석 전이면 기다림
    if (now < Date.parse(day + 'T' + r.alertAt + ':00+09:00')) continue;
    d.pkAlerted = true; await run(env, 'UPDATE items SET data = ?, upd = ? WHERE id = ?', JSON.stringify(d), now, it.id);
    await pushAll(env, '', '🚌 하원 5분 전', d.title + ' · 체크해 주세요', 'home');
    await addLog(env, '', 'todo', '🚌 ' + d.title + ' · 수업 끝나기 5분 전', it.id);
  }
}

// 출석부 중요사항(알림 켬): 그 제자가 출석한 수업 시작 45분 뒤 모두에게 한 번 (2026-11-13)
async function runNoteAlerts(env, day) {
  const now = Date.now(), r = await attSync(env, '/sync/notes-due', { day }); if (!r.ok || !(r.items || []).length) return;
  const key = 'notealert:' + day, sent = new Set(J((await one(env, 'SELECT v FROM kv WHERE k = ?', key) || {}).v, []));
  let changed = false;
  for (const x of r.items) {
    const k = x.sid + ':' + x.nid; if (sent.has(k)) continue;
    if (now < Date.parse(day + 'T' + x.alertAt + ':00+09:00')) continue;
    sent.add(k); changed = true;
    await pushAll(env, '', '📌 ' + x.name + ' 중요사항', x.text, 'home');
    await addLog(env, '', 'kid', '📌 ' + x.name + ' 중요사항 · ' + x.text, '');
  }
  if (changed) {
    await run(env, 'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', key, JSON.stringify([...sent]));
    await run(env, "DELETE FROM kv WHERE k LIKE 'notealert:%' AND k < ?", 'notealert:' + day.slice(0, 8) + '00');
  }
}

// 출석부 '연락 필요' (2026-11-13): 새로 생긴 것만 직원 모두에게 한 번 알림 + 알림 기록 (대시보드 긴급 카드는 /api/students의 cneed)
async function runCneed(env, day) {
  const r = await attSync(env, '/sync/cneed', {}); if (!r.ok) return;
  const key = 'cnsent', sent = J((await one(env, 'SELECT v FROM kv WHERE k = ?', key) || {}).v, {}), live = {};
  let changed = false;
  for (const x of r.list || []) {
    const k = x.day + ':' + x.sid; live[k] = sent[k] || x.at;
    if (sent[k] === x.at) continue; changed = true; live[k] = x.at;
    const body = x.name + ' 학생이나 부모님께 연락이 필요해요' + (x.why ? ' · ' + x.why : '') + (x.who ? ' (' + x.who + ')' : '');
    await pushAll(env, '', '🚨 긴급 · 연락 필요', body, 'home');
    await addLog(env, '', 'kid', '🚨 ' + body, '');
  }
  if (changed || Object.keys(sent).length !== Object.keys(live).length) await run(env, 'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', key, JSON.stringify(live));
}

// ─────────── 청소 ───────────
async function cleanConf(env) { const r = await one(env, "SELECT v FROM kv WHERE k = 'clean'"); return r ? J(r.v, null) : null; }
const KDAY = ['일', '월', '화', '수', '목', '금', '토'];
const dayW = day => KDAY[new Date(Date.parse(day + 'T00:00:00Z')).getUTCDay()];
function cleanWho(c, day) { if (!c || !(c.order || []).length) return ''; const mon = d => Date.parse(d + 'T00:00:00Z') - ((new Date(Date.parse(d + 'T00:00:00Z')).getUTCDay() + 6) % 7) * 864e5; const w = Math.floor((mon(day) - mon(c.start || day)) / (7 * 864e5)); return c.order[((w % c.order.length) + c.order.length) % c.order.length]; }
function cleanTasks(c, day) { const w = dayW(day); if (!c || !['월', '화', '수', '목', '금'].includes(w)) return []; return [...((c.days || {})[w] || [])]; }
// '이번 주 안에' 할 청소 (쓰레기 비우기 등) — 체크는 그 주 월요일 'w:날짜'로
const weekKey = day => 'w:' + addDays(day, -((new Date(Date.parse(day + 'T00:00:00Z')).getUTCDay() + 6) % 7));
async function bumpKv(env) { await run(env, "INSERT INTO kv (k, v) VALUES ('kvupd', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", String(Date.now())); }
// ─────────── 정해진 시각 알림 (5분 크론에서, 하루 한 번씩) ───────────
// ─────────── 원생 한 명단 (2026-11-13): 출석부에서 이름이 바뀌면 업무 앱도 따라감 (10분마다) ───────────
// 출석부 원생 id → 이름을 kv 'rosterIds'에 두고, 바뀐 이름을 등원·픽업 기본 명단·시간, 오늘부터의 픽업표, 학부모 연락·행사 신청·미션 체크, 안 끝난 하원 할 일에 반영. 지우는 것은 없음.
async function rosterFollow(env) {
  const at = await one(env, "SELECT v FROM kv WHERE k = 'rosterAt'"); if (at && Date.now() - Number(at.v) < 600000) return;
  await run(env, "INSERT INTO kv (k, v) VALUES ('rosterAt', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", String(Date.now()));
  const r = await attSync(env, '/sync/roster', { all: true }); if (!r.ok || !Array.isArray(r.students)) return;
  const prev = J((await one(env, "SELECT v FROM kv WHERE k = 'rosterIds'") || {}).v, null), map = {};
  for (const s of r.students) if (s.id && s.name) map[s.id] = String(s.name).replace(/\s+/g, '');
  if (prev) for (const id in map) if (prev[id] && prev[id] !== map[id]) await renameKidTeam(env, prev[id], map[id]);
  await run(env, "INSERT INTO kv (k, v) VALUES ('rosterIds', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", JSON.stringify(map));
}
async function renameKidTeam(env, from, to) {
  const sw = a => (Array.isArray(a) ? [...new Set(a.map(x => (x === from ? to : x)))] : a);
  const kvGet = async k => J((await one(env, 'SELECT v FROM kv WHERE k = ?', k) || {}).v, {});
  const kvSet = (k, v) => run(env, 'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, JSON.stringify(v));
  const def = await kvGet('pickupDefault'); let ch = false; for (const w in def) if ((def[w] || []).includes(from)) { def[w] = sw(def[w]); ch = true; } if (ch) await kvSet('pickupDefault', def);
  const tm = await kvGet('pickupTimes'); ch = false; for (const w in tm) if (tm[w] && from in tm[w]) { if (!(to in tm[w])) tm[w][to] = tm[w][from]; delete tm[w][from]; ch = true; } if (ch) await kvSet('pickupTimes', tm);
  for (const p of await all(env, 'SELECT day, data FROM pickup WHERE day >= ?', kstDay())) {
    const d = J(p.data, {}); if (![d.list, d.done, d.absent].some(a => Array.isArray(a) && a.includes(from))) continue;
    await run(env, 'UPDATE pickup SET data = ?, upd = ? WHERE day = ?', JSON.stringify({ ...d, list: sw(d.list), done: sw(d.done), absent: sw(d.absent) }), Date.now(), p.day);
  }
  await env.DB.batch([
    q(env, 'UPDATE pmsg SET kid = ? WHERE kid = ?', to, from),
    q(env, 'UPDATE OR IGNORE esign SET kid = ? WHERE kid = ?', to, from),
    q(env, 'UPDATE OR IGNORE hwchk SET kid = ? WHERE kid = ?', to, from),
  ]);
  for (const it of await all(env, "SELECT id, data FROM items WHERE type = 'todo' AND del = 0 AND data LIKE ?", '%' + from + '%')) {
    const d = J(it.data, {}); if (d.pickupKid !== from || d.done) continue;
    d.pickupKid = to; if (typeof d.title === 'string' && d.title.startsWith(from + ' ')) d.title = to + d.title.slice(from.length);
    await run(env, 'UPDATE items SET data = ?, upd = ? WHERE id = ?', JSON.stringify(d), Date.now(), it.id);
  }
  await addLog(env, '', 'pickup', '🥋 출석부에서 이름이 바뀌어 업무 앱도 바꿨어요: ' + from + ' → ' + to, '');
}
async function onceAt(env, key) { const r = await one(env, 'SELECT v FROM kv WHERE k = ?', key); if (r) return false; await run(env, 'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO NOTHING', key, '1'); return true; }
async function runTimed(env, now = Date.now()) {
  const k = new Date(now + 9 * 3600e3), day = k.toISOString().slice(0, 10), m = k.getUTCHours() * 60 + k.getUTCMinutes(), wd = k.getUTCDay();
  if (m >= 8 * 60 && m < 21 * 60) { const q2 = await all(env, 'SELECT id, text FROM pushq2 ORDER BY id LIMIT 30'); if (q2.length) { await run(env, 'DELETE FROM pushq2 WHERE id <= ?', q2[q2.length - 1].id); await pushAll(env, '', '💬 밤사이 학부모 연락 ' + q2.length + '건', q2.slice(0, 3).map(x => x.text).join('\n') + (q2.length > 3 ? '\n외 ' + (q2.length - 3) + '건' : ''), 'home'); } }
  await runPickupAlerts(env, day);
  try { await runNoteAlerts(env, day); } catch (_) {}
  try { await runCneed(env, day); } catch (_) {}
  // 매달 말일 12시: 관리자에게 '앱 전체 백업 받기' (주말이면 월요일 12시에 — 직원 알림 시간 규칙)
  if (m >= 12 * 60 && addDays(day, 1).slice(8) === '01' && !(await one(env, 'SELECT v FROM kv WHERE k = ?', 'bk:' + day.slice(0, 7))) && await onceAt(env, 'sent:' + day + ':bk')) {
    const ids = (await all(env, 'SELECT id FROM members WHERE boss = 1')).map(x => x.id);
    if (ids.length) await pushTo(env, await all(env, 'SELECT * FROM subs WHERE mid IN (' + ids.map(() => '?').join(',') + ')', ...ids), '📦 이번 달 백업을 받아 주세요', '출석부·업무·알림·장부·성장 측정을 파일 하나로 받아 보관해요', 'home');
  }
  if (wd === 0 || wd === 6) return;
  const win = h => m >= h && m < h + 20;
  const members = await all(env, 'SELECT id, name FROM members');
  const subsOf = async ids => ids.length ? all(env, 'SELECT * FROM subs WHERE mid IN (' + ids.map(() => '?').join(',') + ')', ...ids) : [];
  // 13:30 등원·픽업 확인
  if (win(13 * 60 + 30) && !(await one(env, 'SELECT v FROM kv WHERE k = ? AND v <> \'null\'', 'pkchk:' + day))) {
    const cl = await attSync(env, '/sync/closed', { day });
    if (!(cl.ok && cl.closed) && await onceAt(env, 'sent:' + day + ':pk')) await pushAll(env, '', '🚌 등원·픽업 확인', '아직 오늘 등원·픽업 확인을 안 했어요. 확인하고 눌러 주세요', 'home');
  }
  // 13시·18시·21시: 날짜 지난 업무 (담당자, 없으면 만든 사람) + 청소 / 17:50·21시: 오늘까지인 업무가 안 끝났으면 다시
  for (const h of [13, 17.5, 18, 21]) {
    const at = h === 17.5 ? 17 * 60 + 50 : h * 60, todayToo = h === 17.5 || h === 21;
    if (!win(at) || !(await onceAt(env, 'sent:' + day + ':od' + h))) continue;
    const per = new Map(), add = (id, t) => { if (!id) return; if (!per.has(id)) per.set(id, []); per.get(id).push(t); };
    for (const it of await all(env, "SELECT data, mid FROM items WHERE type = 'todo' AND del = 0")) {
      const d = J(it.data, {}), st = d.status === '요청' ? '진행' : d.status || (d.done ? '완료' : '진행');
      if (st === '완료' || st === '보류' || d.done || !d.due || d.due > day || (d.due === day && !todayToo)) continue;
      if (h === 17.5 && d.due < day) continue; // 17:50은 오늘까지인 것만 (지난 것은 18시에)
      if (d.due === day && d.pickupKid) continue; // 보호자 하원 할 일은 수업 끝나기 5분 전에 따로 알림
      const ws = Array.isArray(d.whos) && d.whos.length ? d.whos : d.who ? [d.who] : [];
      const ids = ws.map(n => (members.find(x => x.name === n) || {}).id).filter(Boolean);
      (ids.length ? ids : [it.mid]).forEach(id => add(id, (d.due === day ? '📌 오늘까지 · ' : '⏳ ') + d.title));
    }
    const c = h === 17.5 ? null : await cleanConf(env);
    if (c) {
      const chk = d => all(env, 'SELECT task FROM cleanchk WHERE day = ?', d);
      if (h >= 18) { const done = new Set((await chk(day)).map(x => x.task)), l = cleanTasks(c, day).filter(t => !done.has(t)); if (l.length) add(cleanWho(c, day), '🧹 오늘 청소 ' + l.length + '개 남음' + (h === 21 ? ' (21시까지)' : '')); }
      if (h >= 18 && wd === 5) { const wkd = new Set((await chk(weekKey(day))).map(x => x.task)), l = (c.daily || []).filter(t => !wkd.has(t)); if (l.length) add(cleanWho(c, day), '🗑 이번 주 ' + l.join(', ') + ' 아직 안 했어요'); }
      if (h === 13) { let pd = new Date(Date.parse(day + 'T00:00:00Z') - 864e5).toISOString().slice(0, 10); while (['토', '일'].includes(dayW(pd))) pd = new Date(Date.parse(pd + 'T00:00:00Z') - 864e5).toISOString().slice(0, 10); const done = new Set((await chk(pd)).map(x => x.task)), l = pd >= (c.since || c.start) ? cleanTasks(c, pd).filter(t => !done.has(t)) : []; if (l.length) add(cleanWho(c, pd), '🧹 지난 청소 ' + l.length + '개 안 끝남 (' + pd.slice(5).replace('-', '/') + ')'); }
    }
    for (const [id, list] of per) await pushTo(env, await subsOf([id]), (h === 17.5 ? '📌 오늘까지인 일 ' : '⏰ 아직 안 끝난 일 ') + list.length + '개', list.slice(0, 4).join('\n') + (list.length > 4 ? '\n외 ' + (list.length - 4) + '개' : ''), 'todo');
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
// 모아 둔 직원 알림 보내기 (평일 12~22시가 되면 사람마다 한 번에)
async function runHeld(env) {
  if (!staffHours()) return;
  const rs = await all(env, 'SELECT id, mid, title, body, view FROM pushhold ORDER BY id LIMIT 200'); if (!rs.length) return;
  await run(env, 'DELETE FROM pushhold WHERE id <= ?', rs[rs.length - 1].id);
  const by = new Map(); rs.forEach(r => { if (!by.has(r.mid)) by.set(r.mid, []); by.get(r.mid).push(r); });
  for (const [mid, list] of by) {
    const subs = await all(env, 'SELECT * FROM subs WHERE mid = ?', mid); if (!subs.length) continue;
    if (list.length === 1) await pushTo(env, subs, list[0].title, list[0].body, list[0].view, true);
    else await pushTo(env, subs, '🔔 쉬는 동안 온 알림 ' + list.length + '건', list.slice(-3).map(x => x.title + ' · ' + x.body).join('\n').slice(0, 300) + (list.length > 3 ? '\n외 ' + (list.length - 3) + '건' : ''), 'log', true);
  }
}
// 💬 채팅 다시 알림 (2026-11-14 사용자 결정): 받은 채팅을 5분이 지나도 안 읽었으면 한 번만 더. 메시지마다 한 번(kv crm:직원 = 마지막으로 다시 알린 메시지 번호).
// 읽은 곳이 서버에 있는 직원만(앱을 한 번 열어야 생김). 도장 공용 계정은 뺌. 5분마다 도니까 실제로는 5~10분 뒤.
const unreadFor = (msgs, mid, read) => msgs.filter(m => m.mid !== mid && (!m.room || m.room.split(':').includes(mid)) && m.id > ((read || {})[m.room || ''] | 0));
async function runChatRemind(env) {
  const now = Date.now(), msgs = await all(env, 'SELECT id, mid, text, photo, room, at FROM msgs WHERE at > ? AND at < ? ORDER BY id', now - 3600e3, now - 5 * 60e3); if (!msgs.length) return;
  const mem = await all(env, 'SELECT id, name, shared FROM members'), nm = Object.fromEntries(mem.map(m => [m.id, m.name]));
  for (const m of mem.filter(x => !x.shared)) {
    const read = J((await one(env, 'SELECT v FROM kv WHERE k = ?', 'read:' + m.id) || {}).v, null); if (!read) continue;
    const last = J((await one(env, 'SELECT v FROM kv WHERE k = ?', 'crm:' + m.id) || {}).v, 0) | 0;
    const L = unreadFor(msgs, m.id, read).filter(x => x.id > last); if (!L.length) continue;
    await run(env, 'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', 'crm:' + m.id, String(L[L.length - 1].id));
    const subs = await all(env, 'SELECT * FROM subs WHERE mid = ?', m.id); if (!subs.length) continue;
    const z = L[L.length - 1], dm = L.some(x => x.room), grp = L.some(x => !x.room);
    await pushTo(env, subs, '💬 아직 안 읽은 채팅 ' + L.length + '개 (' + [grp ? '단체방' : '', dm ? '1:1' : ''].filter(Boolean).join('·') + ')', (nm[z.mid] || '') + ': ' + (z.text || (z.photo ? '사진' : '')).slice(0, 100), 'chat', true);
  }
}
// 📱 위젯 (2026-11-14): 내 할 일(내 담당 + 담당자 없음) · 안 읽은 채팅 · 오늘 출석 미확인 · 학부모 가입 승인 대기
async function widgetData(env, k) {
  k = str(k, 40); const mid = k ? J((await one(env, 'SELECT v FROM kv WHERE k = ?', 'wkey:' + k) || {}).v, '') : '';
  const me = mid ? await one(env, 'SELECT id, name FROM members WHERE id = ?', mid) : null;
  if (!me) return { ok: false, error: '위젯 열쇠가 맞지 않아요. 업무 앱 → 더보기 → 📱 위젯에서 다시 만들어 주세요' };
  const t = kstDay(), todos = [];
  for (const r of await all(env, "SELECT id, data, mid FROM items WHERE type = 'todo' AND del = 0")) {
    const d = J(r.data, {}), st = d.status === '요청' ? '진행' : d.status || (d.done ? '완료' : '진행'), whos = Array.isArray(d.whos) ? d.whos : d.who ? [d.who] : [];
    if (st === '완료' || st === '보류' || d.done) continue; if (d.share === 'private' && r.mid !== me.id) continue; if (whos.length && !whos.includes(me.name)) continue;
    if (!((d.due && d.due <= t) || (d.start && d.start <= t && (!d.due || d.due >= t)))) continue;
    todos.push({ title: str(d.title, 60), due: d.due || '', late: !!(d.due && d.due < t) });
  }
  todos.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  const read = J((await one(env, 'SELECT v FROM kv WHERE k = ?', 'read:' + me.id) || {}).v, null);
  const msgs = await all(env, "SELECT id, mid, room FROM msgs WHERE at > ? AND (room IS NULL OR room = '' OR instr(room, ?) > 0)", Date.now() - 14 * 864e5, me.id);
  const chat = read ? unreadFor(msgs, me.id, read).length : null;
  let notYet = null; const r = await attSync(env, '/sync/students', {});
  if (r.ok) { const here = new Set(r.here || []), abs = new Set(r.absent || []), wdk = ['일', '월', '화', '수', '목', '금', '토'][new Date(t + 'T00:00:00Z').getUTCDay()];
    notYet = (r.students || []).filter(s => s.status === '재원' && (!s.joined || s.joined <= t) && !(s.leavePeriods || []).some(p => (!p.start || p.start <= t) && (!p.end || t < p.end))).filter(s => { const tp = (s.temporarySchedules || []).find(x => x.start && x.start <= t && (!x.end || t <= x.end)); return (tp ? tp.days : s.days || []).includes(wdk); }).filter(s => !here.has(s.id) && !abs.has(s.id)).length; }
  const pd = await noticeSync(env, '/sync/pending', {});
  return { ok: true, name: me.name, at: Date.now(), todoN: todos.length, todos: todos.slice(0, 8), chat, notYet, pending: pd.ok ? pd.pending : null };
}
async function runPushQueue(env) {
  if (!staffHours()) return; // 2026-11-14: 시간 제한 없음 → 늘 바로
  const q0 = await all(env, 'SELECT id, text FROM pushq ORDER BY id LIMIT 50'); if (!q0.length) return;
  await run(env, 'DELETE FROM pushq WHERE id <= ?', q0[q0.length - 1].id);
  const body = q0.length === 1 ? q0[0].text : q0.slice(0, 3).map(x => x.text).join('\n') + (q0.length > 3 ? '\n외 ' + (q0.length - 3) + '건' : '');
  const allEv = q0.every(x => !/^🎯/.test(x.text)); // 미션 '했어요'도 여기로 모음 (2026-11-13)
  await pushAll(env, '', (allEv ? '🎟 학부모 앱 행사 신청 ' : '📱 학부모 앱 ') + q0.length + '건', body, allEv ? 'event' : 'more');
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

// ── 틀린 횟수 잠금 (비밀번호·PIN·초대번호 공통) ──
// 5번 틀릴 때마다 잠금: 1분 → 2분 → 3분 … (틀릴수록 길어짐). 맞히면 처음부터, 하루 동안 안 틀리면 처음부터.
const FAIL_STEP = 5;
async function lockUntil(env, key) { const f = await one(env, 'SELECT until FROM fails WHERE ip = ?', key); return f && f.until > Date.now() ? f.until : 0; }
async function failAdd(env, key) {
  const f = await one(env, 'SELECT n, until, at FROM fails WHERE ip = ?', key), now = Date.now();
  const n = f && (f.at || 0) > now - 86400e3 ? (f.n | 0) + 1 : 1;
  const lock = n % FAIL_STEP === 0 ? now + (n / FAIL_STEP) * 60000 : 0;
  await run(env, 'INSERT INTO fails (ip, n, until, at) VALUES (?, ?, ?, ?) ON CONFLICT(ip) DO UPDATE SET n = excluded.n, until = excluded.until, at = excluded.at', key, n, lock, now);
  return { n, lock, left: FAIL_STEP - (n % FAIL_STEP) };
}
async function failClear(env, key) { await run(env, 'DELETE FROM fails WHERE ip = ?', key); }
function lockText(until) { const s = Math.max(1, Math.ceil((until - Date.now()) / 1000)); return '여러 번 틀려서 잠겼어요. ' + (s >= 60 ? Math.floor(s / 60) + '분 ' + (s % 60 ? s % 60 + '초 ' : '') : s + '초 ') + '뒤에 다시 해 주세요'; }
function failText(msg, r) { return r.lock ? FAIL_STEP + '번 틀려서 ' + Math.round((r.lock - Date.now()) / 60000) + '분 동안 잠겼어요. 더 틀리면 더 길게 잠겨요' : msg + ' (' + (r.n % FAIL_STEP) + '/' + FAIL_STEP + '번 틀림)'; }

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
// ─────────── 한 파일 백업 (업무 앱 관리자가 매달 말일에 받음, 2026-11-13) — 로그인 열쇠·PIN 값은 빼고 ───────────
const BK_SKIP = ['sessions', 'subs', 'fails', 'kiosks', 'asess', 'devices', 'pushhold', 'pushq', 'pushq2'];
const BK_HIDE = ['salt', 'pin', 'tok', 'asrc', 'p256', 'auth', 'ep'];
async function bkTables(env) { return (await all(env, "SELECT name FROM sqlite_master WHERE type = 'table'")).map(r => r.name).filter(n => /^[a-z0-9]+$/.test(n) && !BK_SKIP.includes(n)); }
async function bkDump(env, table, after) {
  if (!(await bkTables(env)).includes(String(table))) return { ok: false, error: '없는 표' };
  const lim = ['photos', 'contracts'].includes(table) ? 10 : 500;
  const rows = await all(env, 'SELECT rowid AS _r, * FROM ' + table + ' WHERE rowid > ? ORDER BY rowid LIMIT ?', Math.max(0, Number(after) || 0), lim);
  const out = rows.filter(r => !(table === 'kv' && /vapid|dlpin|^sent:|^bktok:/i.test(r.k || ''))).map(r => { const o = {}; for (const [k, v] of Object.entries(r)) if (k !== '_r' && !BK_HIDE.includes(k)) o[k] = v; return o; });
  return { ok: true, rows: out, next: rows.length === lim ? rows[rows.length - 1]._r : 0 };
}
// ─────────── 백업 다시 넣기 (2026-11-13) — 보관용 백업 {tables:{표:[행]}}을 지금 표에 맞춤 ───────────
// 백업에 없는 칸(로그인 열쇠·PIN·푸시 구독)은 지금 값을 그대로 둠. 같은 줄은 다시 쓰지 않음(D1 쓰기 한도 절약).
const RS_KEEPKV = /vapid|dlpin|^sent:|^bktok:|^rstok:|^restoredAt$|^bk:|^mig/i; // 열쇠·보낸 기록·한 번만 하는 정리 표시는 건드리지 않음
async function rsCols(env, table) {
  if (!(await bkTables(env)).includes(String(table))) return null;
  const info = await all(env, 'PRAGMA table_info(' + table + ')');
  const pk = info.filter(c => c.pk > 0).sort((a, c) => a.pk - c.pk).map(c => c.name);
  return pk.length ? { cols: info.map(c => c.name), pk, where: pk.map(k => k + ' = ?').join(' AND ') } : null;
}
async function rsPks(env) { const o = {}; for (const t of await bkTables(env)) { const c = await rsCols(env, t); if (c) o[t] = c.pk; } return o; }
async function rsCounts(env) { const o = {}; for (const t of await bkTables(env)) o[t] = ((await one(env, 'SELECT COUNT(*) AS n FROM ' + t)) || {}).n || 0; return o; }
const rsSame = (a, b) => (a ?? null) === (b ?? null) || (a != null && b != null && String(a) === String(b));
async function rsPut(env, table, rows) {
  const t = await rsCols(env, table); if (!t) return { ok: false, error: table + ': 넣을 수 없는 표' };
  rows = (Array.isArray(rows) ? rows : []).filter(r => r && typeof r === 'object' && t.pk.every(k => r[k] != null)).slice(0, 300);
  if (table === 'kv') rows = rows.filter(r => !RS_KEEPKV.test(String(r.k)));
  if (!rows.length) return { ok: true, put: 0 };
  const cur = await env.DB.batch(rows.map(r => env.DB.prepare('SELECT * FROM ' + table + ' WHERE ' + t.where).bind(...t.pk.map(k => r[k]))));
  const val = v => v != null && typeof v === 'object' ? JSON.stringify(v) : v;
  const st = [];
  rows.forEach((r, i) => {
    const old = ((cur[i] && cur[i].results) || [])[0] || null;
    let cols = t.cols.filter(c => c in r && !BK_HIDE.includes(c));
    if (table === 'members') { if (!old) return; cols = ['name', 'role'].filter(c => c in r); } // 직원은 이름·직책만 맞춤 (PIN 그대로, 없는 사람은 만들지 않음)
    if (old) {
      const ch = cols.filter(c => !t.pk.includes(c) && !rsSame(old[c], val(r[c])));
      if (ch.length) st.push(env.DB.prepare('UPDATE ' + table + ' SET ' + ch.map(c => c + ' = ?').join(', ') + ' WHERE ' + t.where).bind(...ch.map(c => val(r[c])), ...t.pk.map(k => r[k])));
    } else st.push(env.DB.prepare('INSERT INTO ' + table + ' (' + cols.join(', ') + ') VALUES (' + cols.map(() => '?').join(', ') + ')').bind(...cols.map(c => val(r[c]))));
  });
  if (st.length) await env.DB.batch(st);
  return { ok: true, put: st.length };
}
async function rsSweep(env, table, keep, n) { // 백업에 없는 줄 지우기 (keep = 백업에 있는 줄의 열쇠 값 목록)
  const t = await rsCols(env, table); if (!t) return { ok: false, error: table + ': 넣을 수 없는 표' };
  if (!Array.isArray(keep) || keep.length !== (n | 0)) return { ok: false, error: table + ': 줄 수가 맞지 않아요' };
  if (table === 'members') return { ok: true, del: 0 }; // 직원은 지우지 않음
  const ks = new Set(keep.map(k => JSON.stringify((Array.isArray(k) ? k : [k]).map(String))));
  const gone = (await all(env, 'SELECT ' + t.pk.join(', ') + ' FROM ' + table)).filter(r => !ks.has(JSON.stringify(t.pk.map(k => String(r[k])))) && !(table === 'kv' && RS_KEEPKV.test(String(r.k))));
  for (let i = 0; i < gone.length; i += 100) await env.DB.batch(gone.slice(i, i + 100).map(r => env.DB.prepare('DELETE FROM ' + table + ' WHERE ' + t.where).bind(...t.pk.map(k => r[k]))));
  return { ok: true, del: gone.length };
}
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
