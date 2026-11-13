// 해랑경희 알림 서버 (Cloudflare Workers 무료 요금제 + D1 데이터베이스)
// 앱 3개가 이 서버 하나를 같이 씁니다
//   학부모용  /notice/            관리용  /notice/admin.html      출결 태블릿  /notice/kiosk.html
// ─────────────────────────────────────────────
// 필요한 설정 (Cloudflare 대시보드 → 이 Worker → 설정 → 바인딩)
//   1) D1 데이터베이스 바인딩: 변수 이름 DB
//   2) 비밀 변수(Secret): ADMIN_PASSWORD  ← 관장님 비밀번호
//   3) (출석부 연동, 선택) 서비스 바인딩 ATT → haerang-attendance Worker, 비밀 변수 SYNC_KEY ← 출석부 서버와 같은 값
//   4) (행사 신청, 선택) 서비스 바인딩 TEAM → haerang-team Worker (SYNC_KEY 같은 값)
//      출석부 서버는 /sync/notify 로 '학부모님께 출석 보내기'를 부탁합니다 (사범님이 누를 때만)
// 표(테이블)와 푸시 서명 키는 처음 실행될 때 자동으로 만듭니다.
// ─────────────────────────────────────────────

const SITE = 'https://haerangtkd.github.io';
const BATCH = 6;                // 무료 요금제 CPU 한도(요청당 10ms) 안에서 한 번에 보낼 기기 수 — 나머지는 관리 화면이 나눠서 다시 부름
const MIN_STAY = 30 * 60 * 1000; // 등원 후 이 시간이 지나야 태블릿에서 하원 가능 (30분)
const RELATIONS = ['엄마', '아빠', '할머니', '할아버지', '이모', '고모', '삼촌'];
const POST_TYPES = ['notice', 'journal', 'schedule', 'album', 'fee'];

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)',
  'CREATE TABLE IF NOT EXISTS parents (id TEXT PRIMARY KEY, tok TEXT UNIQUE, kids TEXT, rel TEXT, ph TEXT, ok INTEGER DEFAULT 0, created INTEGER, ep TEXT, p256 TEXT, auth TEXT)',
  'CREATE TABLE IF NOT EXISTS kids (name TEXT PRIMARY KEY, codes TEXT, created INTEGER)',
  'CREATE TABLE IF NOT EXISTS att (day TEXT, name TEXT, tin TEXT, tout TEXT, PRIMARY KEY (day, name))',
  'CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, kind TEXT, title TEXT, body TEXT, date TEXT, target TEXT, photos TEXT, pin INTEGER DEFAULT 0, created INTEGER)',
  'CREATE INDEX IF NOT EXISTS posts_type ON posts (type, created)',
  'CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, full TEXT, thumb TEXT, created INTEGER)',
  'CREATE TABLE IF NOT EXISTS fees (month TEXT, name TEXT, paid INTEGER, at INTEGER, PRIMARY KEY (month, name))',
  'CREATE TABLE IF NOT EXISTS fails (ip TEXT PRIMARY KEY, n INTEGER, until INTEGER)',
  'CREATE TABLE IF NOT EXISTS kiosks (tok TEXT PRIMARY KEY, created INTEGER)',
  // 알림 관리 로그인 (업무 앱 PIN으로 들어온 사람) — 2026-11-12
  'CREATE TABLE IF NOT EXISTS asess (tok TEXT PRIMARY KEY, mid TEXT, name TEXT, shared INTEGER, created INTEGER)',
  'CREATE TABLE IF NOT EXISTS reads (post INTEGER, parent TEXT, at INTEGER, PRIMARY KEY (post, parent))',
  'CREATE TABLE IF NOT EXISTS acks (post INTEGER, parent TEXT, at INTEGER, PRIMARY KEY (post, parent))', // 학부모가 '확인했어요'를 누른 기록
  'CREATE TABLE IF NOT EXISTS replies (post INTEGER, kid TEXT, parent TEXT, rel TEXT, ans TEXT, at INTEGER, PRIMARY KEY (post, kid))', // 📩 봉투 답장 (제자마다 참가·불참, 2026-11-13)
  'CREATE TABLE IF NOT EXISTS famreq (id TEXT PRIMARY KEY, kids TEXT, rel TEXT, ph TEXT, by TEXT, at INTEGER)', // 학부모 앱 '도장에 가족 추가 요청'
  'CREATE TABLE IF NOT EXISTS kcodes (name TEXT PRIMARY KEY, code TEXT UNIQUE, created INTEGER)', // 제자 모드 개인 코드 (관장님이 도장에서 넣어 줌, 2026-11-14)
  'CREATE TABLE IF NOT EXISTS ksess (tok TEXT PRIMARY KEY, name TEXT, created INTEGER, seen INTEGER)',
  'CREATE TABLE IF NOT EXISTS kposts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, body TEXT, at INTEGER, del INTEGER DEFAULT 0)', // 선범단 커뮤니티 (선범단만, 글만)
  'CREATE TABLE IF NOT EXISTS invites (code TEXT PRIMARY KEY, name TEXT, kids TEXT, max INTEGER DEFAULT 2, off INTEGER DEFAULT 0, created INTEGER)', // 가정별 초대번호 (가입할 수 있는 휴대폰 수 제한)
];
let ready = false;
async function setup(env) {
  if (ready) return;
  await env.DB.batch(SCHEMA.map(s => env.DB.prepare(s)));
  // 나중에 추가한 칸: 등원 시각(숫자). 이미 있으면 무시
  try { await env.DB.prepare('ALTER TABLE att ADD COLUMN tin_at INTEGER').run(); } catch (_) {}
  try { await env.DB.prepare('ALTER TABLE posts ADD COLUMN urgent INTEGER DEFAULT 0').run(); } catch (_) {} // 긴급 공지
  try { await env.DB.prepare('ALTER TABLE posts ADD COLUMN ask INTEGER DEFAULT 0').run(); } catch (_) {}    // '확인했어요' 받기
  try { await env.DB.prepare('ALTER TABLE posts ADD COLUMN env INTEGER DEFAULT 0').run(); } catch (_) {}   // 📩 봉투로 보낸 글 (고른 제자만 · 참가/불참 답장)
  try { await env.DB.prepare('ALTER TABLE posts ADD COLUMN ev TEXT').run(); } catch (_) {}
  try { await env.DB.prepare('ALTER TABLE posts ADD COLUMN dend TEXT').run(); } catch (_) {}                // 일정 끝나는 날 (여러 날 일정, 2026-11-13)
  try { await env.DB.prepare('ALTER TABLE posts ADD COLUMN img TEXT').run(); } catch (_) {}                 // 일정 사진 (홈페이지에서 옮겨 온 photos/… 경로)                  // 일정 ↔ 업무 앱 행사 신청표 id (2026-11-13)
  try { await env.DB.prepare('ALTER TABLE parents ADD COLUMN inv TEXT').run(); } catch (_) {}               // 가입할 때 쓴 초대번호
  try { await env.DB.prepare('ALTER TABLE fails ADD COLUMN at INTEGER').run(); } catch (_) {} // 마지막으로 틀린 때 (잠금 시간 늘리기용)
  try { await env.DB.prepare('ALTER TABLE asess ADD COLUMN boss INTEGER DEFAULT 0').run(); } catch (_) {} // 업무 앱 관리자 (퇴관 원생은 관리자만)
  try { await env.DB.prepare('ALTER TABLE kids ADD COLUMN sid TEXT').run(); } catch (_) {} // 출석부 원생 id (2026-11-13 원생 한 명단)
  try { await env.DB.prepare('ALTER TABLE kids ADD COLUMN ano TEXT').run(); } catch (_) {} // 출석부에서 가져온 출결번호 (바뀌면 이것만 바꿈)
  ready = true;
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    try {
      await setup(env);
      const url = new URL(req.url);
      return cors(await route(url.pathname, req, env));
    } catch (e) {
      return cors(json({ ok: false, error: String(e && e.message || e) }, 500));
    }
  },
};

// ─────────── 도우미 ───────────
const q = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
const all = async (env, sql, ...args) => (await q(env, sql, ...args).all()).results || [];
const one = (env, sql, ...args) => q(env, sql, ...args).first();
const run = (env, sql, ...args) => q(env, sql, ...args).run();
const J = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (_) { return d; } };
const rid = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const str = (v, n) => String(v == null ? "" : v).slice(0, n);

async function route(path, req, env) {
  // 서버끼리 부르는 길(/sync/)은 서비스 바인딩으로만 — 바깥(workers.dev 주소)에서 오면 주소 이름이 'notice'가 아니라서 막힘 (2026-11-13 보안 보강)
  if (path.startsWith('/sync/') && new URL(req.url).hostname !== 'notice') return json({ ok: false, error: 'not found' }, 404);
  const b = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  // 장부 서버가 관리자 비밀번호를 확인할 때 (서비스 바인딩으로만 — 주소 이름이 'notice'인 요청은 바깥에서 올 수 없음)
  if (path === '/ledger/admin-check') {
    if (new URL(req.url).hostname !== 'notice') return json({ ok: false, error: 'not found' }, 404);
    return json({ ok: !!(env.ADMIN_PASSWORD && b.password && await sameText(String(b.password), env.ADMIN_PASSWORD)) });
  }

  // 장부 서버: 회원별 이번 달 회비(가족 할인 포함)를 알려 줌 → 학부모 앱 '정보 확인' (2026-11-13)
  if (path === '/ledger/fee-info') {
    if (new URL(req.url).hostname !== 'notice') return json({ ok: false, error: 'not found' }, 404);
    const map = {}, sids = {}; for (const x of (Array.isArray(b.list) ? b.list : []).slice(0, 300)) { const n = str(x.name, 20).trim(), v = { base: Number(x.base) || 0, disc: Number(x.disc) || 0, ym: str(x.ym, 7) }; if (n) map[n] = v; const sid = str(x.sid, 60); if (sid) sids[sid] = v; }
    await run(env, "INSERT INTO kv (k, v) VALUES ('feeinfo', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", JSON.stringify({ at: Date.now(), map, sids }));
    return json({ ok: true, n: Object.keys(map).length });
  }
  // 장부 서버: 매달 5일 미납 가정 회비 안내 (서비스 바인딩으로만 — 주소 이름이 'notice'인 요청은 바깥에서 올 수 없음) 2026-11-13
  if (path === '/ledger/fee-notice') {
    if (new URL(req.url).hostname !== 'notice') return json({ ok: false, error: 'not found' }, 404);
    const kids = cleanNames(b.kids);
    if (b.check) { // 미리 보기: 알림 앱 명단에 있는 아이 · 승인된 보호자 휴대폰 수
      const ps = await all(env, 'SELECT kids, ok, ep FROM parents WHERE ok = 1 AND ep IS NOT NULL');
      const names = new Set((await all(env, 'SELECT name FROM kids')).map(r => r.name));
      return json({ ok: true, kids: kids.map(k => ({ name: k, onApp: names.has(k), phones: ps.filter(p => J(p.kids, []).includes(k)).length })) });
    }
    if (!kids.length) return json({ ok: true, total: 0, sent: 0, next: null });
    if (!(b.offset | 0)) await run(env, 'INSERT INTO posts (type, kind, title, body, date, target, photos, pin, created, urgent, ask) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 0)', // 학부모 앱 '소식'에 공지(회비)로 남김 — 그 가정만 보임 (2026-11-13)
      'notice', '회비', str(b.title, 100), str(b.body, 3000), kstDay(new Date()), JSON.stringify(kids), '[]', Date.now());
    return json(await send(env, { kind: '회비', title: str(b.title, 100), body: str(b.body, 300), children: kids, view: 'notice', offset: b.offset | 0 }));
  }

  // ═════════ 누구나 ═════════
  // 홈페이지(누구나): 도장 일정 = 알림 관리 일정표 (2026-11-13 사용자 결정: 일정은 알림 관리 한 곳에서, 홈페이지·학부모 앱·업무 앱에 똑같이)
  if (path === '/pub/schedule') {
    const from = new Date(Date.now() + 9 * 3600e3 - 120 * 864e5).toISOString().slice(0, 10), to = new Date(Date.now() + 9 * 3600e3 + 400 * 864e5).toISOString().slice(0, 10);
    const rows = await all(env, "SELECT title, kind, body, date, dend, img FROM posts WHERE type = 'schedule' AND COALESCE(dend, date) >= ? AND date <= ? ORDER BY date LIMIT 300", from, to);
    return json({ ok: true, items: rows.map(r => ({ date: r.date, end: r.dend || '', title: r.title, type: r.kind || '', note: String(r.body || '').split('\n')[0].slice(0, 120), image: r.img || '' })), plan: await getPlan(env) });
  }
  if (path === '/pub/plan') return json({ ok: true, plan: await getPlan(env) }); // 수련 계획(주간 수련 주제 · 요일별 운동테마 · 이달의 공지) — 학부모 앱·홈페이지가 읽음
  // ═════════ 🥋 제자 모드 (2026-11-14) — 관장님이 도장에서 넣어 준 개인 코드로만 ═════════
  if (path === '/k/login') {
    const ip = 'kid:' + (req.headers.get('cf-connecting-ip') || 'x'), lu = await lockUntil(env, ip);
    if (lu) return json({ ok: false, error: '잠시 뒤에 다시 해 주세요 (' + Math.ceil((lu - Date.now()) / 60000) + '분)' });
    // 2026-11-14 사용자 결정: 직원이 자기 PIN으로 확인해야 들어감(도장 공용 PIN은 안 됨) → 업무 앱에 'ㅇㅇ님이 ○○ 제자 모드를 승인했어요'
    const st = await teamSync(env, '/sync/pin-check', { mid: str(b.mid, 40), pin: str(b.pin, 12) });
    if (!st.ok) return json({ ok: false, error: failText('직원 PIN이 맞지 않아요', await failAdd(env, ip)) });
    if (st.shared) return json({ ok: false, error: '도장 공용 PIN은 안 돼요. 사범님 본인 PIN으로 확인해 주세요' });
    const code = String(b.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12), r = code.length >= 6 ? await one(env, 'SELECT name FROM kcodes WHERE code = ?', code) : null;
    if (!r) return json({ ok: false, error: failText('제자 코드가 맞지 않아요', await failAdd(env, ip)) });
    await failClear(env, ip); const tok = rid(24);
    await run(env, 'INSERT INTO ksess (tok, name, created, seen) VALUES (?, ?, ?, ?)', tok, r.name, Date.now(), Date.now());
    try { await teamSync(env, '/sync/kid-ok', { staff: st.name, kid: r.name }); } catch (e) {}
    return json({ ok: true, tok, name: r.name });
  }
  if (path.startsWith('/k/')) {
    const ks = b.tok ? await one(env, 'SELECT name FROM ksess WHERE tok = ?', String(b.tok)) : null;
    if (!ks) return json({ ok: false, error: '다시 도장에서 코드를 넣어 주세요', out: true });
    const name = ks.name, km = J(((await one(env, "SELECT v FROM kv WHERE k = 'kmode'")) || {}).v, {}) || {};
    const t = await teamSync(env, '/sync/kmode', { name });
    if (path === '/k/home') {
      await run(env, 'UPDATE ksess SET seen = ? WHERE tok = ?', Date.now(), String(b.tok));
      const today = kstDay(new Date()), rows = await all(env, 'SELECT day FROM att WHERE name = ? AND tin IS NOT NULL ORDER BY day', name);
      const days = rows.map(r => r.day), wk = d => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - (x.getUTCDay() + 6) % 7); return x.toISOString().slice(0, 10); };
      const weeks = new Set(days.map(wk)); let streak = 0, w = wk(today); if (!weeks.has(w)) { const x = new Date(w + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - 7); w = x.toISOString().slice(0, 10); }
      while (weeks.has(w) && streak < 520) { streak++; const x = new Date(w + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - 7); w = x.toISOString().slice(0, 10); }
      const info = await attSync(env, '/sync/kid-info', { names: [name] }).catch(() => null), kid = info && info.ok ? (info.kids || [])[0] : null, birth = kid ? String(kid.birth || '') : '';
      const hw = await teamSync(env, '/sync/hw', { kids: [name] });
      return json({ ok: true, name, today, birth: /^\d{4}-\d{2}-\d{2}$/.test(birth) ? birth.slice(5) : '', att: { month: days.filter(d => d.slice(0, 7) === today.slice(0, 7)).length, total: days.length, streak, last: days[days.length - 1] || '' },
        belt: t.ok ? t.belt : '', beltPct: t.ok ? t.beltPct : null, sb: t.ok ? t.sb : false, sbList: t.ok ? t.sbList : [], events: t.ok ? t.events : [], rec: t.ok ? t.rec : {},
        hw: hw.ok ? (hw.hw || []) : [], best: (km.best || []).slice(-4), comps: (km.comps || []).filter(c => c.date >= String(Number(today.slice(0, 4)) - 1) + today.slice(4, 7)).slice(-30) });
    }
    if (path === '/k/hw-check') return json(await teamSync(env, '/sync/hw-check', { kids: [name], kid: name, hw: b.hw, day: b.day, on: !!b.on, rel: '본인' }));
    if (path === '/k/logout') { await run(env, 'DELETE FROM ksess WHERE tok = ?', String(b.tok)); return json({ ok: true }); }
    if (!t.ok || !t.sb) return json({ ok: false, error: '선범단만 들어갈 수 있어요', notSb: true });
    if (path === '/k/posts') return json({ ok: true, me: name, posts: (await all(env, 'SELECT id, name, body, at FROM kposts WHERE del = 0 ORDER BY id DESC LIMIT 60')) });
    if (path === '/k/post') {
      const body = String(b.body || '').replace(/\s+\n/g, '\n').trim().slice(0, 300); if (!body) return json({ ok: false, error: '글을 적어 주세요' });
      const last = await one(env, 'SELECT at FROM kposts WHERE name = ? ORDER BY id DESC LIMIT 1', name); if (last && Date.now() - last.at < 20000) return json({ ok: false, error: '조금 뒤에 다시 올려 주세요' });
      await run(env, 'INSERT INTO kposts (name, body, at) VALUES (?, ?, ?)', name, body, Date.now()); return json({ ok: true });
    }
    if (path === '/k/post-del') { await run(env, 'UPDATE kposts SET del = 1 WHERE id = ? AND name = ?', b.id | 0, name); return json({ ok: true }); }
    return json({ ok: false, error: 'not found' }, 404);
  }
  if (path === '/vapid') return json({ ok: true, publicKey: (await getVapid(env)).publicKey });
  if (path === '/notices') return json({ ok: true, notices: await listPosts(env, 'notice', null, 50) });

  // ═════════ 학부모용 ═════════
  if (path === '/invite' && req.method === 'POST') { // 초대번호 확인 (가입 화면에서 미리 보기)
    const r = await checkInvite(env, req, b.code);
    if (!r.ok) return json(r);
    return json({ ok: true, name: r.inv.name || '', kids: J(r.inv.kids, []), left: r.left });
  }
  if (path === '/join' && req.method === 'POST') {
    // 가입 또는 정보 수정. token 이 있으면 그 보호자 정보를 고침
    const kids = cleanNames(b.children);
    const rel = RELATIONS.includes(b.relation) ? b.relation : '';
    const ph = String(b.phone4 || '').replace(/\D/g, '');
    if (!kids.length || !rel || ph.length !== 4) return json({ ok: false, error: '아이 이름, 관계, 전화번호 뒷자리를 확인해 주세요' }, 400);
    // 2026-11-13 사용자 결정: 도장(업무 앱 원생 정보)에 등록된 보호자 번호 뒷자리와 같아야 가입 (등록된 번호가 없는 아이는 그대로 받고 관리자가 확인)
    const tails = await kidPhoneTails(env, kids);
    if (tails.size && !tails.has(ph)) return json({ ok: false, error: '도장에 등록된 보호자 휴대폰 번호 뒷자리와 달라요. 다른 번호라면 도장에 알려 주세요' }, 400);
    const sub = b.subscription && b.subscription.endpoint && /^https:\/\//.test(b.subscription.endpoint) && b.subscription.keys ? b.subscription : null;
    let p = b.token ? await one(env, 'SELECT * FROM parents WHERE tok = ?', String(b.token)) : null;
    if (p) {
      const same = p.rel === rel && p.ph === ph && sameList(J(p.kids, []), kids);
      await run(env, 'UPDATE parents SET kids = ?, rel = ?, ph = ?, ok = ?, ep = COALESCE(?, ep), p256 = COALESCE(?, p256), auth = COALESCE(?, auth) WHERE id = ?',
        JSON.stringify(kids), rel, ph, same ? p.ok : 0, sub ? sub.endpoint : null, sub ? sub.keys.p256dh : null, sub ? sub.keys.auth : null, p.id);
      return json({ ok: true, token: p.tok, approved: !!(same && p.ok) });
    }
    // 새 가입: 초대번호 확인 (관리 화면에서 '초대번호 없이도 가입 받기'를 켜면 번호 없이도 됨)
    let inv = '';
    const code = String(b.invite || '').replace(/\D/g, '');
    const open = ((await one(env, "SELECT v FROM kv WHERE k = 'inviteOpen'")) || {}).v === '1';
    if (code || !open) {
      if (!code) return json({ ok: false, error: '도장에서 받은 초대번호를 넣어 주세요', needInvite: true });
      if (sub) await run(env, 'DELETE FROM parents WHERE ep = ? AND ok = 0', sub.endpoint); // 같은 휴대폰이 다시 신청하면 자리를 먼저 비움
      const r = await checkInvite(env, req, code); if (!r.ok) return json({ ...r, needInvite: true });
      inv = code;
    }
    if (sub) await run(env, 'DELETE FROM parents WHERE ep = ?', sub.endpoint); // 같은 휴대폰의 예전 등록 정리
    const id = rid(8), tok = rid(16);
    await run(env, 'INSERT INTO parents (id, tok, kids, rel, ph, ok, created, ep, p256, auth, inv) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)',
      id, tok, JSON.stringify(kids), rel, ph, Date.now(), sub ? sub.endpoint : null, sub ? sub.keys.p256dh : null, sub ? sub.keys.auth : null, inv || null);
    try { await teamSync(env, '/sync/join-alert', { kids, rel, matched: tails.size ? tails.has(ph) : null }); } catch (_) {} // 직원에게 바로 알림 (2026-11-13: 가입 요청을 늦게 알던 것)
    return json({ ok: true, token: tok, approved: false });
  }

  if (path.startsWith('/p/')) {
    const p = b.token ? await one(env, 'SELECT * FROM parents WHERE tok = ?', String(b.token)) : null;
    if (!p) return json({ ok: false, error: '등록 정보가 없습니다', removed: true });
    const myKids = J(p.kids, []);
    const me = { approved: !!p.ok, children: myKids, relation: p.rel, phone4: p.ph, push: !!p.ep };

    if (path === '/p/push') { // 알림 구독 정보 갱신
      const s = b.subscription;
      if (s && s.endpoint && s.keys) await run(env, 'UPDATE parents SET ep = ?, p256 = ?, auth = ? WHERE id = ?', s.endpoint, s.keys.p256dh, s.keys.auth, p.id);
      else await run(env, 'UPDATE parents SET ep = NULL, p256 = NULL, auth = NULL WHERE id = ?', p.id);
      return json({ ok: true });
    }
    if (path === '/p/read') { // 게시물을 화면에서 본 기록 (밴드의 '읽음'처럼)
      if (!p.ok) return json({ ok: true });
      const ids = (Array.isArray(b.ids) ? b.ids : []).map(x => x | 0).filter(x => x > 0).slice(0, 30);
      if (ids.length) await env.DB.batch(ids.map(id => q(env, 'INSERT OR IGNORE INTO reads (post, parent, at) VALUES (?, ?, ?)', id, p.id, Date.now())));
      return json({ ok: true });
    }
    if (path === '/p/ack') { // '확인했어요' (읽음도 같이 남김)
      if (!p.ok) return json({ ok: false, error: '도장 확인 후에 누를 수 있어요' });
      const id = b.id | 0, now = Date.now();
      if (!(await one(env, 'SELECT id FROM posts WHERE id = ? AND ask = 1', id))) return json({ ok: false, error: '지워진 게시물이에요' });
      await env.DB.batch([q(env, 'INSERT OR IGNORE INTO acks (post, parent, at) VALUES (?, ?, ?)', id, p.id, now), q(env, 'INSERT OR IGNORE INTO reads (post, parent, at) VALUES (?, ?, ?)', id, p.id, now)]);
      return json({ ok: true, at: now });
    }
    if (path === '/p/leave') { await run(env, 'DELETE FROM parents WHERE id = ?', p.id); return json({ ok: true }); }
    if (path === '/p/kid-info') { // 우리 아이 '정보 확인' (2026-11-13): 출생연도·수련 요일(임시변경)·회비(장부)·관계·번호 뒷자리
      if (!p.ok) return json({ ok: false, error: '도장 확인 후에 볼 수 있어요' });
      const r = await attSync(env, '/sync/kid-info', { names: myKids }), fee = J((await one(env, "SELECT v FROM kv WHERE k = 'feeinfo'") || {}).v, {});
      return json({ ok: true, rel: p.rel, ph: p.ph, kids: myKids.map(k => { const a = (r.kids || []).find(x => x.name === k) || {}; return { name: k, ...a, fee: (a.sid && (fee.sids || {})[a.sid]) || (fee.map || {})[k] || null }; }), feeAt: fee.at || 0 }); // 회비는 출석부 원생 번호로 먼저, 없으면 이름 (2026-11-13)
    }
    if (path === '/p/schedule') return json({ ok: true, me, items: await listSchedule(env, b.month) });
    if (path === '/p/notices') return json({ ok: true, me, items: await withAcks(env, await listPosts(env, 'notice', myKids, 100), p.id, myKids) }); // 아이를 정한 공지(회비 안내 등)는 그 가정만
    if (path === '/p/home') {
      const today = kstDay(new Date());
      const out = { ok: true, me, today: {}, counts: {} };
      const n = (await listPosts(env, 'notice', myKids, 1))[0];
      out.counts.notice = n ? n.at : 0;
      out.counts.schedule = await listSchedule(env, today.slice(0, 7)).then(l => l.filter(x => x.date >= today).slice(0, 3));
      if (p.ok) {
        for (const k of myKids) {
          const a = await one(env, 'SELECT tin, tout FROM att WHERE day = ? AND name = ?', today, k);
          out.today[k] = a ? { in: a.tin, out: a.tout } : {};
        }
        const jn = await listPosts(env, 'journal', myKids, 1);
        out.counts.journal = jn[0] ? jn[0].at : 0;
        const al = await listPosts(env, 'album', myKids, 1);
        out.counts.album = al[0] ? al[0].at : 0;
        const fm = kstDay(new Date()).slice(0, 7);
        out.fee = { month: fm, kids: [] }; // 납부 여부는 학부모에게 보내지 않음 (2026-11-13)
        // 확인을 기다리는 공지·알림장 (긴급 먼저, 30일 안)
        const done = new Set((await all(env, 'SELECT post FROM acks WHERE parent = ?', p.id)).map(r => r.post));
        const asks = (await all(env, "SELECT * FROM posts WHERE ask = 1 AND type IN ('notice', 'journal') AND created > ? ORDER BY urgent DESC, created DESC LIMIT 40", Date.now() - 30 * 864e5))
          .filter(r => !done.has(r.id) && (J(r.target, []).length === 0 || J(r.target, []).some(x => myKids.includes(x)))).slice(0, 5);
        out.asks = asks.map(r => ({ id: r.id, type: r.type, kind: r.kind, title: r.title, body: r.body, urgent: !!r.urgent, at: r.created }));
        // 📩 답장을 기다리는 봉투 (60일 안, 내 제자가 받는 사람인 것)
        const envs = (await all(env, "SELECT * FROM posts WHERE env = 1 AND created > ? ORDER BY created DESC LIMIT 30", Date.now() - 60 * 864e5)).filter(r => J(r.target, []).some(x => myKids.includes(x)));
        out.envs = (await withReplies(env, envs.map(r => ({ id: r.id, type: r.type, kind: r.kind, title: r.title, body: r.body, env: true, target: J(r.target, []), at: r.created })), myKids));
      }
      return json(out);
    }
    // 여기부터는 관장님 승인 후에만
    if (!p.ok) return json({ ok: false, error: '관장님 승인 후에 볼 수 있습니다', pending: true, me });
    if (path === '/p/journal') return json({ ok: true, me, items: await withAcks(env, await listPosts(env, 'journal', myKids, 100), p.id, myKids) });
    if (path === '/p/reply') { // 📩 봉투 답장: 참가·불참 (바꿀 수 있음)
      const id = b.id | 0, kid = String(b.kid || ''), ans = b.ans === 'yes' ? 'yes' : b.ans === 'no' ? 'no' : '';
      const r = await one(env, 'SELECT target, env, title, ev FROM posts WHERE id = ?', id);
      if (!r || !r.env) return json({ ok: false, error: '지워진 봉투예요' });
      if (!ans || !myKids.includes(kid) || !J(r.target, []).includes(kid)) return json({ ok: false, error: '답장할 수 없는 봉투예요' });
      const now = Date.now();
      await env.DB.batch([q(env, 'INSERT INTO replies (post, kid, parent, rel, ans, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(post, kid) DO UPDATE SET parent = excluded.parent, rel = excluded.rel, ans = excluded.ans, at = excluded.at', id, kid, p.id, p.rel || '', ans, now), q(env, 'INSERT OR IGNORE INTO reads (post, parent, at) VALUES (?, ?, ?)', id, p.id, now)]);
      if (r.ev) { try { await teamSync(env, '/sync/env-reply', { ev: r.ev, kid, ans, rel: p.rel || '' }); } catch (_) {} } // 참가 → 업무 앱 신청표 명단 (불참으로 바꾸면 빠짐)
      return json({ ok: true, at: now });
    }
    if (path === '/p/albums') return json({ ok: true, me, items: await listPosts(env, 'album', myKids, 60) });
    if (path === '/p/photo') return photo(env, b.id, b.size);
    if (path === '/p/attendance') {
      const m = /^\d{4}-\d{2}$/.test(b.month || '') ? b.month : kstDay(new Date()).slice(0, 7);
      const rows = await all(env, 'SELECT day, name, tin, tout FROM att WHERE day LIKE ? ORDER BY day', m + '-%');
      return json({ ok: true, me, month: m, items: rows.filter(r => myKids.includes(r.name)).map(r => ({ day: r.day, name: r.name, in: r.tin, out: r.tout })) });
    }
    if (path === '/p/grow') { // 📈 성장 리포트 (2026-11-14): 달마다 출석 일수(최근 12달) + 성장 측정(업무 서버, 내 제자만)
      if (!p.ok) return json({ ok: false, error: '도장 확인 후에 볼 수 있어요' });
      const from = new Date(Date.now() + 9 * 3600e3); from.setUTCDate(1); from.setUTCMonth(from.getUTCMonth() - 11);
      const ks = myKids.slice(0, 10), rows = ks.length ? await all(env, 'SELECT substr(day, 1, 7) AS m, name, COUNT(*) AS n FROM att WHERE day >= ? AND tin IS NOT NULL AND name IN (' + ks.map(() => '?').join(',') + ') GROUP BY m, name', from.toISOString().slice(0, 10), ...ks) : [];
      const g = await teamSync(env, '/sync/grow', { names: ks });
      return json({ ok: true, att: rows.map(r => ({ month: r.m, name: r.name, n: r.n })), events: g.ok ? g.events : [], kids: g.ok ? g.kids : [], growErr: g.ok ? '' : (g.error || '') });
    }
    // 행사 신청 (업무 앱 행사표에서 '학부모 앱에 신청 받기'를 켠 행사만)
    // 사범님께 연락 (버튼은 업무 앱에서 관리) · 숙제 체크
    if (path === '/p/family-request') { // 도장에 가족 추가 요청 (주소를 아무에게나 보내지 않도록)
      if (!p.ok) return json({ ok: false, error: '도장 확인 후에 할 수 있어요' });
      const rel = RELATIONS.includes(b.rel) ? b.rel : '기타', ph = String(b.ph || '').replace(/\D/g, '').slice(-4);
      if (ph.length !== 4) return json({ ok: false, error: '그분 전화번호 뒷자리 4개를 적어 주세요' });
      const kst = await kidStatus(env), kids = myKids.filter(k => kst[k] !== '퇴관');
      await run(env, 'INSERT INTO famreq (id, kids, rel, ph, by, at) VALUES (?, ?, ?, ?, ?, ?)', rid(8), JSON.stringify(kids), rel, ph, p.id, Date.now());
      await teamSync(env, '/sync/pmsg-send', { kids, kid: kids[0], tpl: '', text: rel + ' (전화 뒷자리 ' + ph + ') — 앱 주소를 보내 주시고, 가입하면 알림 관리에서 승인해 주세요', rel: p.rel, family: true });
      return json({ ok: true });
    }
    if (['/p/contact', '/p/contact-send', '/p/hw', '/p/hw-check'].includes(path)) {
      const kst = await kidStatus(env), kids = myKids.filter(k => kst[k] !== '퇴관');
      if (path === '/p/contact') { const r = await teamSync(env, '/sync/ptpl', { kids }); return json(r.ok ? { ...r, kids } : r); }
      if (path === '/p/contact-send') return json(await teamSync(env, '/sync/pmsg-send', { kids, kid: b.kid, tpl: b.tpl, who: b.who, why: b.why, text: b.text, day: b.day, rel: p.rel, dayreq: !!b.dayreq }));
      if (path === '/p/hw') { const r = await teamSync(env, '/sync/hw', { kids }); return json(r.ok ? { ...r, kids } : r); }
      return json(await teamSync(env, '/sync/hw-check', { kids, kid: b.kid, hw: b.hw, day: b.day, on: !!b.on, rel: p.rel }));
    }
    if (path === '/p/events' || path === '/p/event-apply') {
      const kst = await kidStatus(env), kids = myKids.filter(k => kst[k] !== '퇴관');
      if (path === '/p/events') { const r = await teamSync(env, '/sync/events', { kids }); return json(r.ok ? { ok: true, me, kids, events: r.events } : { ok: false, error: r.error, events: [] }); }
      return json(await teamSync(env, '/sync/esign-set', { kids, kid: b.kid, ev: b.ev, data: b.data, cancel: !!b.cancel, rel: p.rel }));
    }
    if (path === '/p/fees') {
      return json({ ok: true, me, status: [], items: await listPosts(env, 'fee', myKids, 50) }); // 납부 여부는 안 보냄 (장부에서 관리)
    }
    return json({ ok: false, error: 'not found' }, 404);
  }

  // ═════════ 출결 태블릿 ═════════
  if (path.startsWith('/kiosk/')) {
    const tok = String(b.token || '');
    if (!tok || !(await one(env, 'SELECT tok FROM kiosks WHERE tok = ?', tok))) return json({ ok: false, error: '출결 태블릿 등록이 풀렸습니다. 공용 PIN으로 다시 등록해 주세요', relogin: true }, 401);
    if (path === '/kiosk/lookup') {
      const code = String(b.code || '').replace(/\D/g, '');
      const today = kstDay(new Date());
      const kst8 = await kidStatus(env), kids = (await all(env, 'SELECT name, codes FROM kids')).filter(k => J(k.codes, []).includes(code) && kst8[k.name] !== '퇴관').map(k => k.name).sort((a, c) => a.localeCompare(c, 'ko'));
      const att = await all(env, 'SELECT name, tin, tout, tin_at FROM att WHERE day = ?', today);
      return json({ ok: true, now: Date.now(), minStay: MIN_STAY, kids: kids.map(n => { const a = att.find(x => x.name === n) || {}; return { name: n, in: a.tin || null, out: a.tout || null, inAt: a.tin_at || null, outFrom: a.tin_at ? kstTime(new Date(a.tin_at + MIN_STAY)) : null }; }) });
    }
    if (path === '/kiosk/check') return json(await checkIn(env, b.name, b.act, true));
    // 등록 서류 (상담 모드): 비용 설정 받기 · 제출 → 업무 서버에 저장 (학부모 앱 서버에는 남기지 않음)
    if (path === '/kiosk/contract-cfg') return json(await teamSync(env, '/sync/contract-cfg', {}));
    if (path === '/kiosk/contract-save') {
      const rec = b.rec && typeof b.rec === 'object' ? b.rec : null, sign = String(b.sign || '');
      if (!rec || !String(rec.name || '').trim()) return json({ ok: false, error: '이름이 없어요' });
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sign) || sign.length > 400000) return json({ ok: false, error: '서명을 다시 해 주세요' });
      if (JSON.stringify(rec).length > 120000) return json({ ok: false, error: '내용이 너무 길어요' });
      return json(await teamSync(env, '/sync/contract-save', { rec, sign }));
    }
    if (path === '/kiosk/admin') { // 태블릿 관리자 모드 (모드 바꾸기·소리 확인) — 관리자 비밀번호
      const k = 'kad:' + (req.headers.get('cf-connecting-ip') || 'x'), lu = await lockUntil(env, k);
      if (lu) return json({ ok: false, error: lockText(lu) });
      const pinOk = b.pin ? !!(await teamSync(env, '/sync/pin-check', { shared: true, pin: str(b.pin, 12) })).ok : false; // 공용 PIN (업무 앱 '도장 공용' 계정)
      if (!pinOk) return json({ ok: false, error: failText('공용 PIN이 맞지 않아요', await failAdd(env, k)) }); // 예전 관리자 비밀번호는 2026-11-13부터 안 받음
      await failClear(env, k);
      return json({ ok: true });
    }
  }

  // ═════════ 출석부 서버에서 부름 (서비스 바인딩, SYNC_KEY 확인) ═════════
  if (path === '/sync/notify') {
    if (!env.SYNC_KEY || !(await sameText(req.headers.get('X-Sync-Key') || '', env.SYNC_KEY))) return json({ ok: false, error: 'sync key' }, 401);
    const name = cleanNames([b.name])[0];
    if (!name) return json({ ok: false, error: '이름' });
    const r = await send(env, { kind: '출결', title: b.title, body: b.body, children: [name], view: b.view === 'home' ? '' : b.view === 'plan' ? 'plan' : 'attendance' }); // view 'home' = 학부모 연락 확인 알림, 'plan' = 행사 신청 취소 알림
    if (r.ok && !r.total) return json({ ok: false, error: name + ' 학생은 알림 앱에 가입한 보호자가 없습니다' });
    return json({ ...r, ok: !!r.ok && r.sent > 0, error: r.ok && !r.sent ? '보호자 휴대폰에 보내지 못했습니다 (알림이 꺼져 있을 수 있음)' : r.error });
  }

  // 업무 앱: 도장 일정(알림 관리 일정표)을 업무 앱 달력에 · 업무 앱에서 만든 신청표의 날짜를 일정표에 (2026-11-13)
  if (path === '/sync/schedule' || path === '/sync/sched-add' || path === '/sync/sched-upd') {
    if (!env.SYNC_KEY || !(await sameText(req.headers.get('X-Sync-Key') || '', env.SYNC_KEY))) return json({ ok: false, error: 'sync key' }, 401);
    if (path === '/sync/schedule') {
      const from = /^\d{4}-\d{2}-\d{2}$/.test(b.from || '') ? b.from : '0000', to = /^\d{4}-\d{2}-\d{2}$/.test(b.to || '') ? b.to : '9999';
      const rows = await all(env, "SELECT id, kind, title, body, date, dend, ev FROM posts WHERE type = 'schedule' AND COALESCE(dend, date) >= ? AND date <= ? ORDER BY date LIMIT 400", from, to);
      return json({ ok: true, items: rows.map(r => ({ id: r.id, kind: r.kind || '', title: r.title, body: r.body || '', date: r.date, end: r.dend || '', ev: r.ev || '' })) });
    }
    const title = String(b.title || '').slice(0, 100).trim(), date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : null;
    if (path === '/sync/sched-add') {
      if (!title || !date) return json({ ok: false, error: '제목과 날짜가 필요해요' });
      const had = b.ev ? await one(env, "SELECT id FROM posts WHERE type = 'schedule' AND ev = ?", String(b.ev).slice(0, 40)) : null; // 같은 신청표로 두 번 안 만듦
      if (had) return json({ ok: true, id: had.id });
      const r = await run(env, 'INSERT INTO posts (type, kind, title, body, date, target, photos, pin, created, urgent, ask, ev) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 0, ?)', 'schedule', String(b.kind || '행사').slice(0, 10), title, String(b.body || '').slice(0, 3000), date, '[]', '[]', Date.now(), String(b.ev || '').slice(0, 40) || null);
      return json({ ok: true, id: r.meta && r.meta.last_row_id });
    }
    const p = await one(env, "SELECT id FROM posts WHERE type = 'schedule' AND id = ?", b.id | 0); if (!p) return json({ ok: false, error: '일정표에서 지워진 일정이에요' });
    if (b.del) { await run(env, 'UPDATE posts SET ev = NULL WHERE id = ?', p.id); return json({ ok: true }); } // 신청표를 지우면 일정은 남기고 연결만 풂
    if (!title || !date) return json({ ok: false, error: '제목과 날짜가 필요해요' });
    await run(env, 'UPDATE posts SET title = ?, date = ? WHERE id = ?', title, date, p.id);
    return json({ ok: true });
  }

  // 업무 앱 관리자: 태블릿 '하루 여러 번 등·하원 허용' (방학 등)
  if (path === '/sync/kiosk-multi') {
    if (!env.SYNC_KEY || !(await sameText(req.headers.get('X-Sync-Key') || '', env.SYNC_KEY))) return json({ ok: false, error: 'sync key' }, 401);
    await run(env, "INSERT INTO kv (k, v) VALUES ('kioskMulti', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", b.on ? '1' : '0');
    return json({ ok: true });
  }
  // 출석부: 태블릿을 안 누른 제자를 사범님이 출석 처리하면서 '등원 알림 보내기'를 고른 경우 (태블릿 등원과 같게 기록 → 나중에 태블릿을 또 눌러도 겹치지 않음)
  if (path === '/sync/teacher-checkin') {
    if (!env.SYNC_KEY || !(await sameText(req.headers.get('X-Sync-Key') || '', env.SYNC_KEY))) return json({ ok: false, error: 'sync key' }, 401);
    const name = cleanNames([b.name])[0]; if (!name) return json({ ok: false, error: '이름' });
    if (!(await one(env, 'SELECT name FROM kids WHERE name = ?', name))) return json({ ok: false, error: name + ' 학생은 알림 앱 명단에 없어요' });
    const a = await one(env, 'SELECT tin FROM att WHERE day = ? AND name = ?', kstDay(new Date()), name);
    if (a && a.tin) return json({ ok: true, already: true });
    const r = await checkIn(env, name, 'in', false);
    return json(r.ok ? { ok: true, sent: r.sent, total: r.total } : r);
  }
  // 업무 앱: 숙제 올릴 때 학부모님께 알림 (대상 제자 또는 모두)
  if (path === '/sync/broadcast') {
    if (!env.SYNC_KEY || !(await sameText(req.headers.get('X-Sync-Key') || '', env.SYNC_KEY))) return json({ ok: false, error: 'sync key' }, 401);
    return json(await send(env, { kind: '미션', title: b.title, body: b.body, children: b.children, view: '', offset: b.offset | 0 })); // 무료 한도 때문에 6명씩 — 업무 앱이 next 로 이어서 부름
  }
  // 업무 앱 '한 파일 백업': 표 목록·표 내용 (관리자 비밀번호는 업무 서버가 먼저 확인)
  if (path === '/sync/bk-tables' || path === '/sync/bk-dump') {
    if (!env.SYNC_KEY || !(await sameText(req.headers.get('X-Sync-Key') || '', env.SYNC_KEY))) return json({ ok: false, error: 'sync key' }, 401);
    return json(path === '/sync/bk-tables' ? { ok: true, tables: await bkTables(env) } : await bkDump(env, String(b.table || ''), b.after));
  }
  // 업무 앱 '백업 다시 넣기' (관리자 + 관리자 비밀번호 + 지금 상태 먼저 받기는 업무 서버가 확인) 2026-11-13
  if (path === '/sync/rs-count' || path === '/sync/rs-put' || path === '/sync/rs-sweep' || path === '/sync/rs-done') {
    if (!env.SYNC_KEY || !(await sameText(req.headers.get('X-Sync-Key') || '', env.SYNC_KEY))) return json({ ok: false, error: 'sync key' }, 401);
    if (path === '/sync/rs-count') return json({ ok: true, tables: await bkTables(env), counts: await rsCounts(env), pks: await rsPks(env) });
    if (path === '/sync/rs-put') return json(await rsPut(env, String(b.table || ''), b.rows));
    if (path === '/sync/rs-sweep') return json(await rsSweep(env, String(b.table || ''), b.keep, b.n));
    await run(env, "DELETE FROM kv WHERE k = 'kidStatus'"); return json({ ok: true }); // 회원 상태는 출석부에서 다시 받음
  }
  // 업무 앱 원생 화면: 그 제자의 가족 초대번호(QR)·학부모 앱 가입 상태 (2026-11-13)
  if (path === '/sync/kid-family' || path === '/sync/invite-save') {
    if (!env.SYNC_KEY || !(await sameText(req.headers.get('X-Sync-Key') || '', env.SYNC_KEY))) return json({ ok: false, error: 'sync key' }, 401);
    if (path === '/sync/invite-save') { await run(env, "DELETE FROM kv WHERE k = 'kidStatus'"); try { await kidStatus(env); } catch (_) {} return json(await inviteSave(env, b)); } // 방금 등록한 원생도 바로 명단에
    const name = cleanNames([b.name])[0]; if (!name) return json({ ok: false, error: '이름' });
    const k = await one(env, 'SELECT codes FROM kids WHERE name = ?', name);
    const parents = (await all(env, 'SELECT rel, ok, created, inv, kids FROM parents')).filter(p => J(p.kids, []).includes(name)).map(p => ({ rel: p.rel, ok: !!p.ok, at: p.created, inv: p.inv || '' }));
    return json({ ok: true, onKiosk: !!k, codes: k ? J(k.codes, []) : [], invites: await inviteList(env, name), parents });
  }
  // 출석부 로그인: 업무 앱 직원 이름·PIN 확인을 대신 전해 줌 (출석부에는 업무 서버 연결이 없음) 2026-11-13
  if (path === '/sync/staff-members' || path === '/sync/staff-pin') {
    if (!env.SYNC_KEY || !(await sameText(req.headers.get('X-Sync-Key') || '', env.SYNC_KEY))) return json({ ok: false, error: 'sync key' }, 401);
    if (path === '/sync/staff-members') return json(await teamSync(env, '/sync/members', {}));
    const r = await teamSync(env, '/sync/pin-check', { mid: str(b.mid, 40), pin: str(b.pin, 12) });
    return json(r.ok ? { ok: true, id: r.id, name: r.name, boss: !!r.boss, shared: !!r.shared } : { ok: false, error: r.error || 'PIN이 맞지 않아요' });
  }
  // 업무 앱 첫 화면: 가입 승인 기다리는 보호자 수
  if (path === '/sync/pending') {
    if (!env.SYNC_KEY || !(await sameText(req.headers.get('X-Sync-Key') || '', env.SYNC_KEY))) return json({ ok: false, error: 'sync key' }, 401);
    const r = await one(env, 'SELECT COUNT(*) AS n FROM parents WHERE ok = 0');
    return json({ ok: true, pending: r ? r.n : 0 });
  }

  // ═════════ 알림 관리 로그인: 직원 각자 업무 앱 PIN (공용 기기는 '도장 공용' PIN) ═════════
  if (path === '/staff/members') {
    const r = await teamSync(env, '/sync/members', {});
    return json(r.ok ? { ok: true, members: (r.members || []).map(m => ({ id: m.id, name: m.name, shared: m.shared })) } : { ok: false, error: '업무 앱에 연결하지 못했어요' });
  }
  if (path === '/staff/login') {
    const ip = 'stf:' + (req.headers.get('cf-connecting-ip') || 'x'), lu = await lockUntil(env, ip);
    if (lu) return json({ ok: false, error: lockText(lu) }, 429);
    const r = await teamSync(env, '/sync/pin-check', { mid: str(b.mid, 40), pin: str(b.pin, 12) });
    if (!r.ok) return json({ ok: false, error: failText('PIN이 맞지 않아요', await failAdd(env, ip)) }, 401);
    await failClear(env, ip);
    const tok = rid(24);
    await run(env, 'INSERT INTO asess (tok, mid, name, shared, created, boss) VALUES (?, ?, ?, ?, ?, ?)', tok, r.id, r.name, r.shared ? 1 : 0, Date.now(), r.boss ? 1 : 0);
    return json({ ok: true, tok, name: r.name });
  }
  if (path === '/staff/logout') { await run(env, 'DELETE FROM asess WHERE tok = ?', str(b.tok, 64)); return json({ ok: true }); }
  // ═════════ 관리 화면 (직원 PIN 로그인 / 태블릿 등록은 공용 PIN) ═════════
  if (path.startsWith('/admin/')) {
    const ip = req.headers.get('cf-connecting-ip') || 'x';
    const lu = await lockUntil(env, ip);
    if (lu) return json({ ok: false, error: lockText(lu) }, 429);
    const ses = b.tok ? await one(env, 'SELECT * FROM asess WHERE tok = ?', str(b.tok, 64)) : null;
    if (ses && ses.created < Date.now() - 180 * 86400e3) { await run(env, 'DELETE FROM asess WHERE tok = ?', ses.tok); return json({ ok: false, relogin: true, error: '다시 로그인해 주세요' }, 401); }
    if (ses) { if (ses.created < Date.now() - 86400e3) await run(env, 'UPDATE asess SET created = ? WHERE tok = ?', Date.now(), ses.tok); } // 쓰는 동안은 로그인 유지
    else if (b.tok) return json({ ok: false, relogin: true, error: '다시 로그인해 주세요' }, 401);
    else if (b.spin && path === '/admin/kiosk-token') { // 태블릿 등록은 공용 PIN으로 (공용 기기)
      if (!(await teamSync(env, '/sync/pin-check', { shared: true, pin: str(b.spin, 12) })).ok) return json({ ok: false, error: failText('공용 PIN이 맞지 않아요', await failAdd(env, ip)) }, 401);
      await failClear(env, ip);
    }
    else return json({ ok: false, relogin: true, error: '다시 로그인해 주세요' }, 401); // 예전 관리자 비밀번호(password)는 2026-11-13부터 안 받음 (장부·내려받기·백업의 /ledger/admin-check는 그대로)

    if (path === '/admin/status') {
      const today = kstDay(new Date());
      const parents = await all(env, 'SELECT id, kids, rel, ph, ok, created, ep, inv FROM parents ORDER BY created DESC');
      const kids = await all(env, 'SELECT name, codes FROM kids'), kst8 = await kidStatus(env);
      const att = await all(env, 'SELECT name, tin, tout FROM att WHERE day = ?', today);
      const boss = !!(ses && ses.boss);
      const list = kids.map(k => k.name).filter(n => boss || kst8[n] !== '퇴관').sort((a, c) => a.localeCompare(c, 'ko')).map(n => {
        const k = kids.find(x => x.name === n), a = att.find(x => x.name === n);
        return {
          name: n, codes: J(k.codes, []), today: a ? { in: a.tin, out: a.tout } : {}, status: kst8[n] || '',
          guardians: parents.filter(p => p.ok && J(p.kids, []).includes(n)).map(p => ({ id: p.id, rel: p.rel, ph: p.ph, push: !!p.ep })),
        };
      });
      const freq = await all(env, 'SELECT kids, rel, ph FROM famreq WHERE at > ?', Date.now() - 60 * 86400e3);
      const invs = await all(env, 'SELECT code, name FROM invites');
      const pl = parents.some(p => !p.ok) ? await attSync(env, '/sync/roster', { all: true, phones: true }) : {};
      const phOf = new Map(((pl && pl.students) || []).map(x => [x.name, (x.phones || []).map(v => v.slice(-4))]));
      const pending = parents.filter(p => !p.ok).map(p => ({ id: p.id, children: J(p.kids, []), rel: p.rel, ph: p.ph, at: p.created,
        phMatch: J(p.kids, []).some(k => (phOf.get(k) || []).includes(String(p.ph || '').slice(-4))) ? 'same' : J(p.kids, []).some(k => (phOf.get(k) || []).length) ? 'diff' : 'none',
        famreq: freq.some(f => f.ph === p.ph && J(f.kids, []).some(k => J(p.kids, []).includes(k))),
        inv: p.inv || '', invName: p.inv ? ((invs.find(i => i.code === p.inv) || {}).name || '') : '' }));
      const inviteOpen = ((await one(env, "SELECT v FROM kv WHERE k = 'inviteOpen'")) || {}).v === '1';
      return json({ ok: true, devices: parents.filter(p => p.ep).length, kids: list, pending, inviteOpen });
    }
    if (path === '/admin/approve') {
      const p = await one(env, 'SELECT * FROM parents WHERE id = ?', String(b.id || ''));
      if (!p) return json({ ok: false, error: '이미 지워진 등록입니다' });
      if (!b.approve) { await run(env, 'DELETE FROM parents WHERE id = ?', p.id); return json({ ok: true }); }
      // 승인하면 아이를 명단에 넣고, 보호자 휴대폰 뒷자리를 출결번호로 연결
      for (const n of J(p.kids, [])) {
        const k = await one(env, 'SELECT codes FROM kids WHERE name = ?', n);
        const codes = k ? J(k.codes, []) : [];
        if (p.ph && !codes.includes(p.ph)) codes.push(p.ph);
        await run(env, 'INSERT INTO kids (name, codes, created) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET codes = excluded.codes', n, JSON.stringify(codes), Date.now());
      }
      await run(env, 'UPDATE parents SET ok = 1 WHERE id = ?', p.id);
      // 승인됐다고 그 보호자 휴대폰에 알림 (2026-11-13 사용자 요청 · 문구 그대로)
      let pushed = false;
      if (p.ep) { try { pushed = await pushOne(env, p, '✅ 어플 인증이 완료되었습니다', '아직 승인 요청 중으로 뜬다면 어플을 완전히 종료 후 다시 이용해주세요!', ''); } catch (_) {} }
      return json({ ok: true, pushed });
    }
    // ── 초대번호 (가정마다 따로, 가입할 수 있는 휴대폰 수 제한) ──
    if (path === '/admin/invites') return json({ ok: true, items: await inviteList(env) });
    if (path === '/admin/invite-save') return json(await inviteSave(env, b));
    if (path === '/admin/invite-del') { await run(env, 'DELETE FROM invites WHERE code = ?', String(b.code || '')); return json({ ok: true }); } // 이미 가입한 보호자는 그대로
    if (path === '/admin/invite-open') { await run(env, "INSERT INTO kv (k, v) VALUES ('inviteOpen', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", b.on ? '1' : '0'); return json({ ok: true }); }
    if (path === '/admin/remove-device') { await run(env, 'DELETE FROM parents WHERE id = ?', String(b.id || '')); return json({ ok: true }); }
    if (path === '/admin/kid-save') {
      const name = cleanNames([b.name])[0];
      const codes = [...new Set((Array.isArray(b.codes) ? b.codes : []).map(c => String(c).replace(/\D/g, '')).filter(c => c.length === 4))].slice(0, 6);
      if (!name) return json({ ok: false, error: '이름을 확인해 주세요' });
      if (b.oldName && b.oldName !== name) {
        if (await one(env, 'SELECT name FROM kids WHERE name = ?', name)) return json({ ok: false, error: '같은 이름이 이미 명단에 있습니다' });
        await renameKid(env, b.oldName, name);
      }
      await run(env, 'INSERT INTO kids (name, codes, created) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET codes = excluded.codes', name, JSON.stringify(codes), Date.now());
      return json({ ok: true });
    }
    // 출석부 명단과 비교: 출석부에는 있는데 알림 앱 명단에 없는 아이, 출결번호가 빠진 아이
    if (path === '/admin/roster-diff' || path === '/admin/roster-add') {
      const r = await attSync(env, '/sync/roster', {});
      if (!r.ok) return json({ ok: false, error: r.error || '출석부에 연결하지 못했습니다' });
      const kids = await all(env, 'SELECT name, codes FROM kids');
      const missing = [], noCode = [];
      for (const s of r.students) {
        const k = kids.find(x => x.name === s.name);
        if (!k) missing.push(s);
        else if (/^\d{4}$/.test(s.no) && !J(k.codes, []).includes(s.no)) noCode.push({ ...s, codes: J(k.codes, []) });
      }
      if (path === '/admin/roster-diff') return json({ ok: true, missing, noCode, total: r.students.length });
      const want = new Set((Array.isArray(b.names) ? b.names : []).slice(0, 300).map(x => String(x || '').replace(/\s+/g, '')).filter(Boolean));
      const st = [];
      for (const s of [...missing, ...noCode]) {
        if (!want.has(s.name)) continue;
        const codes = [...new Set([...(s.codes || []), ...(/^\d{4}$/.test(s.no) ? [s.no] : [])])].slice(0, 6);
        st.push(q(env, 'INSERT INTO kids (name, codes, created) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET codes = excluded.codes', s.name, JSON.stringify(codes), Date.now()));
      }
      if (st.length) await env.DB.batch(st);
      return json({ ok: true, added: st.length });
    }
    if (path === '/admin/kid-delete') { await run(env, 'DELETE FROM kids WHERE name = ?', String(b.name || '')); return json({ ok: true }); }
    if (path === '/admin/check') return json(await checkIn(env, b.name, b.act));

    // 소식(공지·알림장·일정·앨범·회비 안내) 쓰기
    if (path === '/admin/post-save') {
      const type = POST_TYPES.includes(b.type) ? b.type : '';
      const title = String(b.title || '').slice(0, 100).trim();
      if (!type || !title) return json({ ok: false, error: '제목을 적어 주세요' });
      const target = cleanNames(b.target);
      const photos = (Array.isArray(b.photos) ? b.photos : []).map(String).filter(x => /^[0-9a-f]{16,32}$/.test(x)).slice(0, 30);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : null;
      if (type === 'schedule' && !date) return json({ ok: false, error: '날짜를 골라 주세요' });
      const dend = type === 'schedule' && /^\d{4}-\d{2}-\d{2}$/.test(b.end || '') && b.end > date ? b.end : null;
      const urgent = type === 'notice' && b.urgent ? 1 : 0, ask = urgent || ((type === 'notice' || type === 'journal') && b.ask) ? 1 : 0; // 긴급이면 확인도 받음
      const envl = (type === 'notice' || type === 'journal') && b.env ? 1 : 0; // 📩 봉투: 고른 제자만, 참가·불참 답장
      if (envl && !target.length) return json({ ok: false, error: '봉투는 받을 제자를 골라야 해요' });
      let envEv = '', envErr = ''; // 참가하면 넣을 업무 앱 신청표 ('new' = 봉투 제목으로 새로)
      if (envl && b.envEv === 'new') { const e = await teamSync(env, '/sync/ev-new', { title, who: (ses && ses.name) || '' }); if (e.ok) envEv = String(e.id); else envErr = e.error || '신청표를 만들지 못했어요'; }
      else if (envl && b.envEv) envEv = String(b.envEv).slice(0, 40);
      const r = await run(env, 'INSERT INTO posts (type, kind, title, body, date, target, photos, pin, created, urgent, ask, env) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        type, String(b.kind || '').slice(0, 10), title, String(b.body || '').slice(0, 3000), date, JSON.stringify(target), JSON.stringify(photos), b.pin ? 1 : 0, Date.now(), urgent, envl ? 0 : ask, envl);
      const pid = r.meta && r.meta.last_row_id;
      if (envEv && pid) await run(env, 'UPDATE posts SET ev = ? WHERE id = ?', envEv, pid);
      if (dend && pid) await run(env, 'UPDATE posts SET dend = ? WHERE id = ?', dend, pid);
      if (envl) return json({ ok: true, id: pid, envEv, evError: envErr || undefined });
      if (type === 'schedule' && b.mkEv && pid) { // 🎟 신청표도 만들기 (2026-11-13 사용자 결정: 도장 일정은 알림 관리에서, 신청표는 여기서 같이)
        const e = await teamSync(env, '/sync/ev-from-sched', { sp: pid, title, date, body: String(b.body || '').slice(0, 1000), elig: b.elig || null, who: (ses && ses.name) || '' });
        if (e.ok && e.id) { await run(env, 'UPDATE posts SET ev = ? WHERE id = ?', String(e.id).slice(0, 40), pid); return json({ ok: true, id: pid, ev: e.id }); }
        return json({ ok: true, id: pid, evError: e.error || '업무 앱에 신청표를 만들지 못했어요' });
      }
      return json({ ok: true, id: pid });
    }
    if (path === '/admin/sched-edit') { // 일정표 수정 → 업무 앱 달력·연결된 신청표도 같이, 원하면 학부모 알림 (2026-11-13)
      const p = await one(env, "SELECT * FROM posts WHERE id = ? AND type = 'schedule'", b.id | 0); if (!p) return json({ ok: false, error: '지워진 일정이에요' });
      const title = String(b.title || '').slice(0, 100).trim(), date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : null;
      if (!title || !date) return json({ ok: false, error: '제목과 날짜를 확인해 주세요' });
      const body = String(b.body || '').slice(0, 3000), kind = String(b.kind || p.kind || '').slice(0, 10);
      const dend = /^\d{4}-\d{2}-\d{2}$/.test(b.end || '') && b.end > date ? b.end : null;
      await run(env, 'UPDATE posts SET title = ?, body = ?, date = ?, kind = ?, dend = ? WHERE id = ?', title, body, date, kind, dend, p.id);
      const out = { ok: true };
      if (p.ev && (p.title !== title || p.date !== date)) { const e = await teamSync(env, '/sync/ev-sched-upd', { ev: p.ev, title, date, who: (ses && ses.name) || '' }); if (!e.ok) out.evError = e.error || '연결된 신청표를 바꾸지 못했어요'; }
      if (!p.ev && b.mkEv) { const e = await teamSync(env, '/sync/ev-from-sched', { sp: p.id, title, date, body: body.slice(0, 1000), elig: b.elig || null, who: (ses && ses.name) || '' }); if (e.ok && e.id) { await run(env, 'UPDATE posts SET ev = ? WHERE id = ?', String(e.id).slice(0, 40), p.id); out.ev = e.id; } else out.evError = e.error || '업무 앱에 신청표를 만들지 못했어요'; }
      if (b.notify) { const md = d => (+d.slice(5, 7)) + '/' + (+d.slice(8)); out.notify = { title: '[일정 변경] ' + title, body: (p.date !== date ? md(p.date) + ' → ' + md(date) + ' · ' : '') + (body || '일정이 바뀌었어요').slice(0, 100) }; } // 보내기는 화면이 pushAll로 나눠서
      return json(out);
    }
    if (path === '/admin/post-delete') {
      const p = await one(env, 'SELECT photos, ev, title FROM posts WHERE id = ?', b.id | 0);
      if (p && p.ev) { try { await teamSync(env, '/sync/ev-sched-del', { ev: p.ev, title: p.title, who: (ses && ses.name) || '' }); } catch (_) {} } // 신청표는 남기고 연결만 풂
      if (p) for (const ph of J(p.photos, [])) await run(env, 'DELETE FROM photos WHERE id = ?', ph);
      await run(env, 'DELETE FROM posts WHERE id = ?', b.id | 0);
      await run(env, 'DELETE FROM reads WHERE post = ?', b.id | 0);
      await run(env, 'DELETE FROM acks WHERE post = ?', b.id | 0);
      await run(env, 'DELETE FROM replies WHERE post = ?', b.id | 0);
      return json({ ok: true });
    }
    if (path === '/admin/ev-tables') return json(await teamSync(env, '/sync/ev-tables', {}));
    if (path === '/admin/egrps') return json(await teamSync(env, '/sync/egrps', {}));
    if (path === '/admin/sched-get') { const r = await one(env, "SELECT * FROM posts WHERE id = ? AND type = 'schedule'", b.id | 0); return json(r ? { ok: true, item: { id: r.id, kind: r.kind, title: r.title, body: r.body, date: r.date, end: r.dend || '', ev: r.ev || '' } } : { ok: false, error: '지워진 일정이에요' }); }
    // 🥋 제자 모드 관리 (2026-11-14): 개인 코드 · 최우수 수련생 · 대회 기록 · 선범단 커뮤니티 지우기
    if (path === '/admin/kcodes') {
      const ks = (await all(env, 'SELECT name FROM kids ORDER BY name')).map(r => r.name), cs = await all(env, 'SELECT name, code FROM kcodes'), ss = await all(env, 'SELECT name, COUNT(*) AS n, MAX(seen) AS seen FROM ksess GROUP BY name');
      return json({ ok: true, items: ks.map(n => { const c = cs.find(x => x.name === n), s2 = ss.find(x => x.name === n); return { name: n, code: c ? c.code : '', devices: s2 ? s2.n : 0, seen: s2 ? s2.seen : 0 }; }) });
    }
    if (path === '/admin/kcode-make') {
      const name = String(b.name || '').trim().slice(0, 20); if (!(await one(env, 'SELECT name FROM kids WHERE name = ?', name))) return json({ ok: false, error: '명단에 없는 제자예요' });
      const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let code = '';
      for (let t = 0; t < 20 && !code; t++) { const c = [...crypto.getRandomValues(new Uint8Array(8))].map(x => A[x % A.length]).join(''); if (!(await one(env, 'SELECT name FROM kcodes WHERE code = ?', c))) code = c; }
      await run(env, 'INSERT INTO kcodes (name, code, created) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET code = excluded.code, created = excluded.created', name, code, Date.now());
      await run(env, 'DELETE FROM ksess WHERE name = ?', name); // 새 코드 = 예전 기기는 로그아웃
      return json({ ok: true, code });
    }
    if (path === '/admin/kcode-del') { const name = String(b.name || ''); await run(env, 'DELETE FROM kcodes WHERE name = ?', name); await run(env, 'DELETE FROM ksess WHERE name = ?', name); return json({ ok: true }); }
    if (path === '/admin/kmode-get') return json({ ok: true, km: J(((await one(env, "SELECT v FROM kv WHERE k = 'kmode'")) || {}).v, {}) || {} });
    if (path === '/admin/kmode-save') {
      const T = (v, n) => String(v == null ? '' : v).trim().slice(0, n), G = ['중고등부 남', '중고등부 여', '초등부 남', '초등부 여', '유치부 남', '유치부 여'];
      const best = (Array.isArray(b.best) ? b.best : []).filter(x => x && /^\d{4}-[1-4]$/.test(x.q || '')).map(x => ({ q: x.q, g: Object.fromEntries(G.map(k => [k, T((x.g || {})[k], 20)]).filter(([, v]) => v)) })).sort((a, c) => a.q.localeCompare(c.q)).slice(-12);
      const comps = (Array.isArray(b.comps) ? b.comps : []).filter(x => x && /^\d{4}-\d{2}-\d{2}$/.test(x.date || '') && T(x.title, 80)).map(x => ({ id: T(x.id, 20) || rid(4), date: x.date, title: T(x.title, 80), rows: (Array.isArray(x.rows) ? x.rows : []).map(r => ({ name: T(r && r.name, 20), medal: ['금', '은', '동', '참가'].includes(r && r.medal) ? r.medal : '참가', ev: T(r && r.ev, 30) })).filter(r => r.name).slice(0, 60) })).sort((a, c) => a.date.localeCompare(c.date)).slice(-200);
      const km = { best, comps };
      await run(env, "INSERT INTO kv (k, v) VALUES ('kmode', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", JSON.stringify(km)); return json({ ok: true, km });
    }
    if (path === '/admin/kposts') return json({ ok: true, posts: await all(env, 'SELECT id, name, body, at FROM kposts WHERE del = 0 ORDER BY id DESC LIMIT 100') });
    if (path === '/admin/kpost-del') { await run(env, 'UPDATE kposts SET del = 1 WHERE id = ?', b.id | 0); return json({ ok: true }); }
    if (path === '/admin/plan-get') return json({ ok: true, plan: await getPlan(env) });
    if (path === '/admin/plan-save') { // 수련 계획 저장 (2026-11-14: 홈페이지 data.json → 알림 관리에서 관리)
      const p = cleanPlan(b.plan); if (!p) return json({ ok: false, error: '저장할 내용이 이상해요' });
      await run(env, "INSERT INTO kv (k, v) VALUES ('plan', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", JSON.stringify(p));
      return json({ ok: true, plan: p });
    }
    if (path === '/admin/sched-import') { // 홈페이지(data.json) 일정을 알림 관리 일정표로 옮기기 — 같은 날짜·같은 제목은 건너뜀
      const L = (Array.isArray(b.items) ? b.items : []).slice(0, 100), have = new Set((await all(env, "SELECT date, title FROM posts WHERE type = 'schedule'")).map(r => r.date + '|' + String(r.title).replace(/\s/g, '')));
      let added = 0;
      for (const x of L) {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(x.date || '') ? x.date : '', title = String(x.title || '').slice(0, 100).trim(); if (!date || !title || have.has(date + '|' + title.replace(/\s/g, ''))) continue;
        const end = /^\d{4}-\d{2}-\d{2}$/.test(x.end || '') && x.end > date ? x.end : null, img = /^photos\/[\w./-]+$/.test(x.image || '') ? x.image : null;
        await run(env, 'INSERT INTO posts (type, kind, title, body, date, target, photos, pin, created, urgent, ask, dend, img) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 0, ?, ?)', 'schedule', String(x.type || '기타').slice(0, 10), title, String(x.note || '').slice(0, 3000), date, '[]', '[]', Date.now(), end, img);
        have.add(date + '|' + title.replace(/\s/g, '')); added++;
      }
      return json({ ok: true, added, skipped: L.length - added });
    }
    if (path === '/admin/done-events') return json(await teamSync(env, '/sync/done-events', {})); // 완료한 행사표 참가자 → 알림장 받는 사람 (2026-11-13)
    if (path === '/admin/jtpl') return json(await teamSync(env, '/sync/jtpl', {})); // 알림장 양식 (업무 앱에서 관리)
    if (path === '/admin/posts') {
      const type = POST_TYPES.includes(b.type) ? b.type : 'notice';
      if (type === 'schedule') return json({ ok: true, items: await listSchedule(env, b.month) });
      const items = await listPosts(env, type, null, 100, true);
      // 읽음 수: 대상 보호자(승인된 사람) 중 몇 명이 봤는지
      const parents = (await all(env, 'SELECT id, kids FROM parents WHERE ok = 1')).map(p => ({ id: p.id, kids: J(p.kids, []) }));
      const rr = items.length ? await all(env, 'SELECT post, parent FROM reads WHERE post IN (' + items.map(() => '?').join(',') + ')', ...items.map(it => it.id)) : [];
      const aa = items.some(it => it.ask) ? await all(env, 'SELECT post, parent FROM acks WHERE post IN (' + items.map(() => '?').join(',') + ')', ...items.map(it => it.id)) : [];
      for (const it of items) {
        const aud = parents.filter(p => !it.target.length || p.kids.some(k => it.target.includes(k)));
        const readers = new Set(rr.filter(r => r.post === it.id).map(r => r.parent));
        it.reads = aud.filter(p => readers.has(p.id)).length; it.audience = aud.length;
        if (it.ask) { const ackers = new Set(aa.filter(r => r.post === it.id).map(r => r.parent)); it.acks = aud.filter(p => ackers.has(p.id)).length; }
      }
      const envIds = items.filter(it => it.env).map(it => it.id);
      if (envIds.length) { const rp = await all(env, 'SELECT post, ans FROM replies WHERE post IN (' + envIds.map(() => '?').join(',') + ')', ...envIds); for (const it of items) if (it.env) { const L = rp.filter(r => r.post === it.id); it.rYes = L.filter(r => r.ans === 'yes').length; it.rNo = L.filter(r => r.ans === 'no').length; } }
      return json({ ok: true, items });
    }
    if (path === '/admin/replies') { // 📩 봉투 답장 보기: 제자마다 참가·불참·아직
      const r = await one(env, 'SELECT target, title FROM posts WHERE id = ? AND env = 1', b.id | 0); if (!r) return json({ ok: false, error: '지워진 봉투예요' });
      const rs = await all(env, 'SELECT kid, rel, ans, at FROM replies WHERE post = ?', b.id | 0);
      const rd = new Set((await all(env, 'SELECT parent FROM reads WHERE post = ?', b.id | 0)).map(x => x.parent));
      const ps = await all(env, 'SELECT id, kids FROM parents WHERE ok = 1');
      return json({ ok: true, title: r.title, rows: J(r.target, []).map(k => { const x = rs.find(y => y.kid === k); const fam = ps.filter(p => J(p.kids, []).includes(k)); return { kid: k, ans: x ? x.ans : '', rel: x ? x.rel : '', at: x ? x.at : 0, opened: fam.some(p => rd.has(p.id)), app: fam.length > 0 }; }) });
    }
    if (path === '/admin/reads') {
      const post = await one(env, 'SELECT target FROM posts WHERE id = ?', b.id | 0);
      if (!post) return json({ ok: false, error: '지워진 게시물입니다' });
      const target = J(post.target, []);
      const parents = (await all(env, 'SELECT id, kids, rel FROM parents WHERE ok = 1')).map(p => ({ id: p.id, kids: J(p.kids, []), rel: p.rel }))
        .filter(p => !target.length || p.kids.some(k => target.includes(k)));
      const reads = await all(env, 'SELECT parent, at FROM reads WHERE post = ?', b.id | 0);
      const acks = await all(env, 'SELECT parent, at FROM acks WHERE post = ?', b.id | 0), ak = {}; acks.forEach(r => ak[r.parent] = r.at);
      const at = {}; reads.forEach(r => at[r.parent] = r.at);
      const who = p => ({ kids: target.length ? p.kids.filter(k => target.includes(k)) : p.kids, rel: p.rel });
      return json({ ok: true,
        read: parents.filter(p => at[p.id]).sort((x, y) => at[x.id] - at[y.id]).map(p => ({ ...who(p), at: at[p.id], ack: ak[p.id] || null })),
        unread: parents.filter(p => !at[p.id]).map(who) });
    }
    if (path === '/admin/photo-upload') {
      const full = String(b.full || ''), thumb = String(b.thumb || '');
      if (!/^[A-Za-z0-9+/=]+$/.test(full) || full.length > 1900000 || thumb.length > 400000) return json({ ok: false, error: '사진이 너무 큽니다' });
      const id = rid(12);
      await run(env, 'INSERT INTO photos (id, full, thumb, created) VALUES (?, ?, ?, ?)', id, full, thumb, Date.now());
      return json({ ok: true, id });
    }
    if (path === '/admin/photo') return photo(env, b.id, b.size);
    if (path === '/admin/fees') {
      const m = /^\d{4}-\d{2}$/.test(b.month || '') ? b.month : kstDay(new Date()).slice(0, 7);
      const rows = await all(env, 'SELECT name, paid, at FROM fees WHERE month = ?', m);
      return json({ ok: true, month: m, items: rows });
    }
    if (path === '/admin/fee-set') {
      if (!/^\d{4}-\d{2}$/.test(b.month || '')) return json({ ok: false, error: 'month' });
      await run(env, 'INSERT INTO fees (month, name, paid, at) VALUES (?, ?, ?, ?) ON CONFLICT(month, name) DO UPDATE SET paid = excluded.paid, at = excluded.at', b.month, String(b.name || ''), b.paid ? 1 : 0, Date.now());
      return json({ ok: true });
    }
    if (path === '/admin/attendance') {
      const m = /^\d{4}-\d{2}$/.test(b.month || '') ? b.month : kstDay(new Date()).slice(0, 7);
      return json({ ok: true, month: m, items: await all(env, 'SELECT day, name, tin AS "in", tout AS out FROM att WHERE day LIKE ? ORDER BY day', m + '-%') });
    }
    if (path === '/admin/send') return json(await send(env, b));
    if (path === '/admin/kiosk-token') {
      const tok = rid(16);
      await run(env, 'INSERT INTO kiosks (tok, created) VALUES (?, ?)', tok, Date.now());
      return json({ ok: true, token: tok });
    }
    if (path === '/admin/kiosk-reset') {
      const r = await one(env, 'SELECT COUNT(*) AS n FROM kiosks');
      await run(env, 'DELETE FROM kiosks');
      return json({ ok: true, removed: r ? r.n : 0 });
    }
  }
  return json({ ok: false, error: 'not found' }, 404);
}

// ─────────── 게시물 ───────────
async function listPosts(env, type, kids, limit, admin) {
  const rows = await all(env, 'SELECT * FROM posts WHERE type = ? ORDER BY pin DESC, created DESC LIMIT ?', type, kids ? 500 : limit);
  return rows
    .filter(r => { const t = J(r.target, []); return admin || !kids || !t.length || t.some(x => kids.includes(x)); })
    .slice(0, limit)
    .map(r => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, date: r.date, target: J(r.target, []), photos: J(r.photos, []), pin: !!r.pin, urgent: !!r.urgent, ask: !!r.ask, env: !!r.env, at: r.created }));
}
async function withAcks(env, items, parentId, myKids) { // 학부모 화면: 내가 '확인했어요'를 눌렀는지 · 봉투 답장
  if (items.some(x => x.env)) items = await withReplies(env, items, myKids || []);
  if (!items.some(x => x.ask)) return items;
  const mine = await all(env, 'SELECT post, at FROM acks WHERE parent = ?', parentId), m = {};
  mine.forEach(r => m[r.post] = r.at);
  return items.map(x => x.ask ? { ...x, acked: m[x.id] || null } : x);
}
// 수련 계획 (kv 'plan'): { weekday: {월:[…]…}, focus: [{date, end, title}], months: [{month, notices:[…]}] } — 없으면 null (홈페이지 data.json을 씀)
async function getPlan(env) { const r = await one(env, "SELECT v FROM kv WHERE k = 'plan'"); return r ? J(r.v, null) : null; }
function cleanPlan(p) {
  if (!p || typeof p !== 'object') return null;
  const D = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '', T = (v, n) => String(v == null ? '' : v).trim().slice(0, n), wd = {};
  for (const w of ['월', '화', '수', '목', '금', '토']) { const L = (Array.isArray((p.weekday || {})[w]) ? p.weekday[w] : []).map(x => T(x, 40)).filter(Boolean).slice(0, 10); if (L.length) wd[w] = L; }
  const focus = (Array.isArray(p.focus) ? p.focus : []).map(x => ({ date: D(x && x.date), end: D(x && x.end), title: T(x && x.title, 60) })).filter(x => x.date && x.title).map(x => ({ ...x, end: x.end > x.date ? x.end : '' })).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 600);
  const months = (Array.isArray(p.months) ? p.months : []).filter(m => m && /^\d{4}-\d{2}$/.test(m.month || '')).map(m => ({ month: m.month, notices: (Array.isArray(m.notices) ? m.notices : []).map(x => T(x, 500)).filter(Boolean).slice(0, 12) })).sort((a, b) => a.month.localeCompare(b.month)).slice(-60);
  return { weekday: wd, focus, months };
}
async function listSchedule(env, month) {
  const m = /^\d{4}-\d{2}$/.test(month || '') ? month : kstDay(new Date()).slice(0, 7);
  const rows = await all(env, "SELECT * FROM posts WHERE type = 'schedule' AND date <= ? AND COALESCE(dend, date) >= ? ORDER BY date, created", m + '-31', m + '-01'); // 여러 날 일정은 걸친 달에 모두
  return rows.map(r => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, date: r.date, end: r.dend || '', img: r.img || '', at: r.created, ev: r.ev || '' }));
}
// 📩 봉투: 내 제자(받는 사람 중)마다 답장 (학부모에게 다른 가정 이름은 안 보냄)
async function withReplies(env, items, myKids) {
  const ids = items.filter(x => x.env).map(x => x.id); if (!ids.length) return items;
  const rs = await all(env, 'SELECT post, kid, ans, at FROM replies WHERE post IN (' + ids.map(() => '?').join(',') + ')', ...ids);
  return items.map(x => x.env ? { ...x, target: [], envKids: x.target.filter(k => myKids.includes(k)).map(k => { const r = rs.find(y => y.post === x.id && y.kid === k); return { kid: k, ans: r ? r.ans : '', at: r ? r.at : 0 }; }) } : x);
}
async function photo(env, id, size) {
  const col = size === 'full' ? 'full' : 'thumb';
  const r = await one(env, `SELECT ${col} AS d FROM photos WHERE id = ?`, String(id || ''));
  return json(r ? { ok: true, data: r.d } : { ok: false });
}

// ─────────── 등원·하원 (태블릿·관리 화면 공통) ───────────
async function checkIn(env, name, act, kiosk) {
  if (act !== 'in' && act !== 'out') return { ok: false, error: 'act' };
  if (!(await one(env, 'SELECT name FROM kids WHERE name = ?', String(name || '')))) return { ok: false, error: '명단에 없는 아이입니다' };
  if (kiosk && (await kidStatus(env))[name] === '퇴관') return { ok: false, error: '퇴관으로 되어 있어요. 사범님께 말해 주세요' };
  const now = new Date(), t = kstTime(now), day = kstDay(now);
  if (act === 'out' && kiosk) { // 태블릿에서는 등원하고 30분이 지나야 하원 (관리 화면은 관장님이 언제든 가능)
    const a = await one(env, 'SELECT tin_at, tout FROM att WHERE day = ? AND name = ?', day, name);
    if (a && a.tin_at && !a.tout && now.getTime() - a.tin_at < MIN_STAY) return { ok: false, early: true, error: '등원하고 30분이 지나야 하원할 수 있습니다. ' + kstTime(new Date(a.tin_at + MIN_STAY)) + '부터 누를 수 있습니다' };
  }
  let repeat = false;
  if (kiosk) { // 태블릿: 하루에 등원 한 번, 하원 한 번 (관리자가 '여러 번 허용'을 켜면 허용하고 업무 앱에 확인할 일로 남김)
    const a = await one(env, 'SELECT tin, tout FROM att WHERE day = ? AND name = ?', day, name);
    repeat = !!(a && (act === 'in' ? a.tin : a.tout));
    if (repeat && (await one(env, "SELECT v FROM kv WHERE k = 'kioskMulti'") || {}).v !== '1') return { ok: false, already: true, error: '오늘 이미 ' + (act === 'in' ? '등원' : '하원') + '했어요 (' + (act === 'in' ? a.tin : a.tout) + ')' };
  }
  if (act === 'in') await run(env, 'INSERT INTO att (day, name, tin, tout, tin_at) VALUES (?, ?, ?, NULL, ?) ON CONFLICT(day, name) DO UPDATE SET tin = excluded.tin, tout = NULL, tin_at = excluded.tin_at', day, name, t, now.getTime());
  else await run(env, 'INSERT INTO att (day, name, tin, tout) VALUES (?, ?, NULL, ?) ON CONFLICT(day, name) DO UPDATE SET tout = excluded.tout', day, name, t);
  if (act === 'in') await attSync(env, '/sync/checkin', { name, at: now.getTime() }); // 출석부에 자동 출석 (연결 안 됐으면 그냥 넘어감)
  if (repeat) await teamSync(env, '/sync/kiosk-repeat', { name, act, time: t, day });
  const body = act === 'in' ? name + ' 학생이 ' + t + '에 도장에 도착했습니다.' : name + ' 학생이 ' + t + '에 수련을 마치고 하원했습니다.';
  const r = await send(env, { kind: act === 'in' ? '등원' : '하원', title: (act === 'in' ? '등원 알림' : '하원 알림') + ' · ' + name, body, children: [name], view: 'attendance' });
  return { ok: true, time: t, at: now.getTime(), sent: r.sent || 0, total: r.total || 0 };
}
// ─────────── 출석부 서버 연동 (서비스 바인딩 ATT) ───────────
async function teamSync(env, path, body) {
  if (!env.TEAM || !env.SYNC_KEY) return { ok: false, error: '행사 신청은 아직 준비 중이에요' };
  try { const r = await env.TEAM.fetch('https://team' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sync-Key': env.SYNC_KEY }, body: JSON.stringify(body) }); return await r.json(); }
  catch (_) { return { ok: false, error: '잠시 후 다시 해 주세요' }; }
}
async function attSync(env, path, body) {
  if (!env.ATT || !env.SYNC_KEY) return { ok: false, error: '출석부가 아직 연결되지 않았습니다 (알림 서버 설정의 ATT 바인딩·SYNC_KEY)' };
  try {
    const r = await env.ATT.fetch('https://attendance' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sync-Key': env.SYNC_KEY }, body: JSON.stringify(body) });
    return await r.json();
  } catch (e) { return { ok: false, error: '출석부에 연결하지 못했습니다' }; }
}
function kst(d) { return new Date(d.getTime() + 9 * 3600 * 1000); }
function kstDay(d) { return kst(d).toISOString().slice(0, 10); }
function kstTime(d) { const k = kst(d); const h = k.getUTCHours(), m = k.getUTCMinutes(); return (h < 12 ? '오전 ' : '오후 ') + ((h % 12) || 12) + '시' + (m ? ' ' + m + '분' : ''); }

// ─────────── 가족 초대번호 (알림 관리 · 업무 앱 원생 화면이 같이 씀) ───────────
async function inviteList(env, kid) {
  const invs = await all(env, 'SELECT code, name, kids, max, off, created FROM invites ORDER BY created DESC');
  const ps = await all(env, 'SELECT id, kids, rel, ph, ok, created, inv FROM parents WHERE inv IS NOT NULL');
  return invs.map(i => ({ code: i.code, name: i.name || '', kids: J(i.kids, []), max: i.max, off: !!i.off, created: i.created,
    used: ps.filter(p => p.inv === i.code).map(p => ({ id: p.id, rel: p.rel, ph: p.ph, ok: !!p.ok, at: p.created, kids: J(p.kids, []) })) }))
    .filter(i => !kid || i.kids.includes(kid));
}
async function inviteSave(env, b) {
  const name = String(b.name || '').trim().slice(0, 30), kids = cleanNames(Array.isArray(b.kids) ? b.kids : []);
  const max = Math.max(1, Math.min(9, b.max | 0 || 2));
  if (b.code) {
    const i = await one(env, 'SELECT code FROM invites WHERE code = ?', String(b.code)); if (!i) return ({ ok: false, error: '없는 초대번호예요' });
    await run(env, 'UPDATE invites SET name = ?, kids = ?, max = ?, off = ? WHERE code = ?', name, JSON.stringify(kids), max, b.off ? 1 : 0, i.code);
    return ({ ok: true, code: i.code });
  }
  let code = '';
  for (let t = 0; t < 20 && !code; t++) { const c = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000)); if (!(await one(env, 'SELECT code FROM invites WHERE code = ?', c))) code = c; }
  if (!code) return ({ ok: false, error: '번호를 만들지 못했어요. 다시 눌러 주세요' });
  await run(env, 'INSERT INTO invites (code, name, kids, max, off, created) VALUES (?, ?, ?, ?, 0, ?)', code, name, JSON.stringify(kids), max, Date.now());
  return ({ ok: true, code });
}

// ─────────── 원생 한 명단 (2026-11-13): 출석부가 기준, 10분마다 자동으로 맞춤 ───────────
// · 출석부 원생 id(sid)로 같은 아이를 알아봄 → 출석부에서 이름을 바꾸면 여기 이름(보호자·출결 기록·회비·글 대상·초대번호)도 같이 바뀜
// · 출석부에 새로 들어온 아이(퇴관 빼고)는 태블릿 명단에 자동 등록 (출결번호 4자리가 있으면 그 번호로)
// · 출석부에서 출결번호를 바꾸면 예전 번호(출석부에서 가져온 것만) 대신 새 번호. 직접 넣은 다른 번호(형제 등)는 그대로
// · 아무것도 지우지 않음
async function renameKid(env, from, to) {
  if (!from || !to || from === to) return;
  await env.DB.batch([
    q(env, 'UPDATE kids SET name = ? WHERE name = ?', to, from),
    q(env, 'UPDATE att SET name = ? WHERE name = ?', to, from),
    q(env, 'UPDATE fees SET name = ? WHERE name = ?', to, from),
  ]);
  const swap = a => [...new Set(a.map(k => (k === from ? to : k)))];
  for (const p of await all(env, 'SELECT id, kids FROM parents')) { const ks = J(p.kids, []); if (ks.includes(from)) await run(env, 'UPDATE parents SET kids = ? WHERE id = ?', JSON.stringify(swap(ks)), p.id); }
  for (const p of await all(env, 'SELECT id, target FROM posts WHERE target LIKE ?', '%' + from + '%')) { const t = J(p.target, []); if (t.includes(from)) await run(env, 'UPDATE posts SET target = ? WHERE id = ?', JSON.stringify(swap(t)), p.id); }
  for (const i of await all(env, 'SELECT code, kids FROM invites WHERE kids LIKE ?', '%' + from + '%')) { const t = J(i.kids, []); if (t.includes(from)) await run(env, 'UPDATE invites SET kids = ? WHERE code = ?', JSON.stringify(swap(t)), i.code); }
  for (const f of await all(env, 'SELECT id, kids FROM famreq WHERE kids LIKE ?', '%' + from + '%')) { const t = J(f.kids, []); if (t.includes(from)) await run(env, 'UPDATE famreq SET kids = ? WHERE id = ?', JSON.stringify(swap(t)), f.id); }
}
async function rosterFollow(env, students) {
  const kids = await all(env, 'SELECT name, codes, sid, ano FROM kids');
  const bySid = new Map(kids.filter(k => k.sid).map(k => [k.sid, k])), byName = new Map(kids.map(k => [k.name, k]));
  const seen = new Set();
  for (const s of students) {
    const sid = String(s.id || ''), name = String(s.name || '').replace(/\s+/g, ''); if (!sid || !name || seen.has(sid)) continue; seen.add(sid);
    const no = /^\d{4}$/.test(String(s.no || '')) ? String(s.no) : '';
    let k = bySid.get(sid);
    if (!k) { const n = byName.get(name); if (n && !n.sid) k = n; } // 처음 한 번: 이름이 같은 아이와 연결
    if (!k) {
      if (s.status === '퇴관' || byName.has(name)) continue; // 퇴관은 새로 넣지 않음, 같은 이름이 다른 아이로 이미 있으면 건드리지 않음
      await run(env, 'INSERT INTO kids (name, codes, created, sid, ano) VALUES (?, ?, ?, ?, ?) ON CONFLICT(name) DO NOTHING', name, JSON.stringify(no ? [no] : []), Date.now(), sid, no);
      byName.set(name, { name, sid }); continue;
    }
    if (k.name !== name && !byName.has(name)) { await renameKid(env, k.name, name); byName.delete(k.name); k.name = name; byName.set(name, k); }
    let codes = J(k.codes, []).filter(c => !k.ano || c !== k.ano || c === no); // 출석부에서 가져온 예전 번호만 뺌 (직접 넣은 번호는 그대로)
    if (no && !codes.includes(no)) codes = [...codes, no].slice(-6);
    const nc = JSON.stringify(codes);
    if (k.sid !== sid || (k.ano || '') !== no || nc !== (k.codes || '[]')) await run(env, 'UPDATE kids SET sid = ?, ano = ?, codes = ? WHERE name = ?', sid, no, nc, k.name);
  }
}

// ─────────── 출석부 회원 상태 (재원이 아닌 아이만: {이름: '휴원'|'퇴관'}) — 10분마다 새로 받음, 연결 안 되면 마지막 값 ───────────
// 퇴관: 휴대폰 알림이 가지 않고 태블릿 출결 번호도 막힘. 출석부에서 다시 재원으로 바꾸면 그대로 돌아옴. 휴원: 표시만.
// 도장에 등록된 보호자 번호(업무 앱 원생 정보의 연락처·연락처2) 뒷자리 — 가입 확인용
async function kidPhoneTails(env, kids) {
  const r = await attSync(env, '/sync/roster', { all: true, phones: true });
  const out = new Set(); if (!r.ok) return out;
  for (const s of r.students || []) if (kids.includes(s.name)) for (const v of s.phones || []) if (v.length >= 4) out.add(v.slice(-4));
  return out;
}
async function kidStatus(env) {
  const c = await one(env, "SELECT v FROM kv WHERE k = 'kidStatus'"), old = c ? J(c.v, {}) : {};
  if (old.at && Date.now() - old.at < 600000) return old.map || {};
  const r = await attSync(env, '/sync/roster', { all: true });
  if (!r.ok || !Array.isArray(r.students)) return old.map || {};
  try { await rosterFollow(env, r.students); } catch (_) {} // 원생 한 명단: 새 원생·이름·출결번호를 출석부에 맞춤
  const map = {}; for (const s of r.students) if (s.name && s.status && s.status !== '재원') map[s.name] = s.status;
  // 아이가 모두 퇴관인 보호자는 등록 해제 (2026-11-13 사용자 결정: 학부모 앱의 '등록 해제' 버튼 대신 업무 앱에서 퇴관하면 해제)
  for (const p of await all(env, 'SELECT id, kids FROM parents')) { const ks = J(p.kids, []); if (ks.length && ks.every(k => map[k] === '퇴관')) await run(env, 'DELETE FROM parents WHERE id = ?', p.id); }
  await run(env, "INSERT INTO kv (k, v) VALUES ('kidStatus', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", JSON.stringify({ at: Date.now(), map }));
  return map;
}

// ─────────── 푸시 발송 ───────────
// children 이 비어 있으면 전체, 있으면 그 아이의 승인된 보호자에게만. 관리 화면이 offset 을 늘려 가며 나눠 부릅니다.
async function send(env, b) {
  const title = String(b.title || '').slice(0, 100).trim();
  const body = String(b.body || '').slice(0, 300).trim();
  if (!title) return { ok: false, error: '제목이 비어 있습니다' };
  const st = await kidStatus(env), gone = c => st[c] === '퇴관';
  const targets = cleanNames(b.children).filter(c => !gone(c));
  if (b.children && cleanNames(b.children).length && !targets.length) return { ok: true, total: 0, sent: 0, failed: 0, removed: 0, next: null, left: true }; // 퇴관한 아이에게만 보내는 알림
  const offset = Math.max(0, b.offset | 0);
  let subs = await all(env, 'SELECT id, kids, ok, ep, p256, auth FROM parents WHERE ep IS NOT NULL ORDER BY id');
  subs = subs.filter(s => { const k = J(s.kids, []); return !k.length || k.some(c => !gone(c)); }); // 아이가 모두 퇴관인 보호자는 빼기
  if (targets.length) subs = subs.filter(s => s.ok && J(s.kids, []).some(c => targets.includes(c)));
  const total = subs.length;
  const slice = subs.slice(offset, offset + BATCH);
  const vapid = await getVapid(env);
  const auths = new Map(); // 같은 푸시 회사(구글·애플 등)에는 서명 하나를 같이 씀
  const view = /^[a-z]+$/.test(b.view || '') ? b.view : '';
  const payload = JSON.stringify({ title, body, kind: String(b.kind || ''), url: SITE + '/notice/' + (view ? '#' + view : ''), tag: (b.tag || view || 'n') + '-' + Date.now() });

  let sent = 0, failed = 0, removed = 0;
  await Promise.all(slice.map(async s => {
    try {
      const aud = new URL(s.ep).origin;
      if (!auths.has(aud)) auths.set(aud, vapidHeader(s.ep, vapid));
      const res = await webPush({ endpoint: s.ep, p256dh: s.p256, auth: s.auth }, payload, await auths.get(aud));
      if (res.status === 404 || res.status === 410) { await run(env, 'UPDATE parents SET ep = NULL WHERE id = ?', s.id); removed++; }
      else if (res.ok) sent++;
      else failed++;
    } catch (e) { failed++; }
  }));
  const nextAt = offset + slice.length - removed;   // 만료된 기기가 빠지면 뒤 순서가 당겨짐
  return { ok: true, total, sent, failed, removed, next: nextAt < total - removed ? nextAt : null };
}

// 보호자 한 사람(휴대폰 한 대)에게만 보내기 — 가입 승인 알림 (승인 전이라도 보냄)
async function pushOne(env, s, title, body, view) {
  const vapid = await getVapid(env);
  const payload = JSON.stringify({ title, body, kind: '가입', url: SITE + '/notice/' + (view ? '#' + view : ''), tag: 'ok-' + Date.now() });
  const res = await webPush({ endpoint: s.ep, p256dh: s.p256, auth: s.auth }, payload, await vapidHeader(s.ep, vapid));
  if (res.status === 404 || res.status === 410) { await run(env, 'UPDATE parents SET ep = NULL WHERE id = ?', s.id); return false; }
  return !!res.ok;
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

// 초대번호 확인: 틀린 번호는 5번마다 잠금(1분·2분·3분…), 꺼졌거나 가입 수가 다 차면 막음
async function checkInvite(env, req, raw) {
  const code = String(raw || '').replace(/\D/g, '');
  const k = 'inv:' + (req.headers.get('cf-connecting-ip') || 'x'), lu = await lockUntil(env, k);
  if (lu) return { ok: false, error: lockText(lu) };
  const inv = code.length === 6 ? await one(env, 'SELECT * FROM invites WHERE code = ?', code) : null;
  if (!inv) return { ok: false, error: failText('초대번호가 맞지 않아요. 도장에서 받은 6자리를 확인해 주세요', await failAdd(env, k)) };
  await failClear(env, k);
  if (inv.off) return { ok: false, error: '지금은 쓸 수 없는 초대번호예요. 도장에 문의해 주세요' };
  const used = (await one(env, 'SELECT COUNT(*) AS n FROM parents WHERE inv = ?', code)).n;
  if (used >= inv.max) return { ok: false, error: '이 초대번호로 가입할 수 있는 휴대폰 수(' + inv.max + '대)가 다 찼어요. 도장에 문의해 주세요' };
  return { ok: true, inv, left: inv.max - used };
}

function cleanNames(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  for (const x of arr) { const n = String(x || '').replace(/\s+/g, '').slice(0, 20); if (n) seen.add(n); }
  return [...seen].slice(0, 6);
}
function sameList(a, b) { return JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort()); }
async function sameText(a, b) {
  const [x, y] = await Promise.all([a, b].map(v => crypto.subtle.digest('SHA-256', enc(String(v)))));
  const p = new Uint8Array(x), r = new Uint8Array(y);
  let d = 0; for (let i = 0; i < p.length; i++) d |= p[i] ^ r[i];
  return d === 0;
}

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
const BK_SKIP = ['sessions', 'subs', 'fails', 'kiosks', 'asess', 'devices', 'pushhold', 'pushq', 'pushq2', 'ksess'];
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
