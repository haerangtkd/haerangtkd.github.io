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
  'CREATE TABLE IF NOT EXISTS famreq (id TEXT PRIMARY KEY, kids TEXT, rel TEXT, ph TEXT, by TEXT, at INTEGER)', // 학부모 앱 '도장에 가족 추가 요청'
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
  const b = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  // 장부 서버가 관리자 비밀번호를 확인할 때 (서비스 바인딩으로만 — 주소 이름이 'notice'인 요청은 바깥에서 올 수 없음)
  if (path === '/ledger/admin-check') {
    if (new URL(req.url).hostname !== 'notice') return json({ ok: false, error: 'not found' }, 404);
    return json({ ok: !!(env.ADMIN_PASSWORD && b.password && await sameText(String(b.password), env.ADMIN_PASSWORD)) });
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
    if (!(b.offset | 0)) await run(env, 'INSERT INTO posts (type, kind, title, body, date, target, photos, pin, created, urgent, ask) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 0)', // 학부모 앱 '회비 안내'에도 남김 (그 가정만 보임)
      'fee', '회비', str(b.title, 100), str(b.body, 3000), kstDay(new Date()), JSON.stringify(kids), '[]', Date.now());
    return json(await send(env, { kind: '회비', title: str(b.title, 100), body: str(b.body, 300), children: kids, view: 'fee', offset: b.offset | 0 }));
  }

  // ═════════ 누구나 ═════════
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
    if (path === '/p/schedule') return json({ ok: true, me, items: await listSchedule(env, b.month) });
    if (path === '/p/notices') return json({ ok: true, me, items: await withAcks(env, await listPosts(env, 'notice', null, 100), p.id) });
    if (path === '/p/home') {
      const today = kstDay(new Date());
      const out = { ok: true, me, today: {}, counts: {} };
      const n = await one(env, "SELECT MAX(created) AS c FROM posts WHERE type = 'notice'");
      out.counts.notice = n && n.c || 0;
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
      }
      return json(out);
    }
    // 여기부터는 관장님 승인 후에만
    if (!p.ok) return json({ ok: false, error: '관장님 승인 후에 볼 수 있습니다', pending: true, me });
    if (path === '/p/journal') return json({ ok: true, me, items: await withAcks(env, await listPosts(env, 'journal', myKids, 100), p.id) });
    if (path === '/p/albums') return json({ ok: true, me, items: await listPosts(env, 'album', myKids, 60) });
    if (path === '/p/photo') return photo(env, b.id, b.size);
    if (path === '/p/attendance') {
      const m = /^\d{4}-\d{2}$/.test(b.month || '') ? b.month : kstDay(new Date()).slice(0, 7);
      const rows = await all(env, 'SELECT day, name, tin, tout FROM att WHERE day LIKE ? ORDER BY day', m + '-%');
      return json({ ok: true, me, month: m, items: rows.filter(r => myKids.includes(r.name)).map(r => ({ day: r.day, name: r.name, in: r.tin, out: r.tout })) });
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
      if (path === '/p/contact-send') return json(await teamSync(env, '/sync/pmsg-send', { kids, kid: b.kid, tpl: b.tpl, who: b.who, why: b.why, text: b.text, day: b.day, rel: p.rel }));
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
    if (!tok || !(await one(env, 'SELECT tok FROM kiosks WHERE tok = ?', tok))) return json({ ok: false, error: '출결 태블릿 등록이 풀렸습니다. 관장님 비밀번호로 다시 등록해 주세요', relogin: true }, 401);
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
      if (!pinOk && !(env.ADMIN_PASSWORD && b.password && await sameText(String(b.password), env.ADMIN_PASSWORD))) return json({ ok: false, error: failText(b.pin ? '공용 PIN이 맞지 않아요' : '비밀번호가 맞지 않아요', await failAdd(env, k)) });
      await failClear(env, k);
      return json({ ok: true });
    }
  }

  // ═════════ 출석부 서버에서 부름 (서비스 바인딩, SYNC_KEY 확인) ═════════
  if (path === '/sync/notify') {
    if (!env.SYNC_KEY || !(await sameText(req.headers.get('X-Sync-Key') || '', env.SYNC_KEY))) return json({ ok: false, error: 'sync key' }, 401);
    const name = cleanNames([b.name])[0];
    if (!name) return json({ ok: false, error: '이름' });
    const r = await send(env, { kind: '출결', title: b.title, body: b.body, children: [name], view: b.view === 'home' ? '' : 'attendance' }); // view 'home' = 학부모 연락 확인 알림
    if (r.ok && !r.total) return json({ ok: false, error: name + ' 학생은 알림 앱에 가입한 보호자가 없습니다' });
    return json({ ...r, ok: !!r.ok && r.sent > 0, error: r.ok && !r.sent ? '보호자 휴대폰에 보내지 못했습니다 (알림이 꺼져 있을 수 있음)' : r.error });
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
    return json(await send(env, { kind: '숙제', title: b.title, body: b.body, children: b.children, view: '', offset: b.offset | 0 })); // 무료 한도 때문에 6명씩 — 업무 앱이 next 로 이어서 부름
  }
  // 업무 앱 '한 파일 백업': 표 목록·표 내용 (관리자 비밀번호는 업무 서버가 먼저 확인)
  if (path === '/sync/bk-tables' || path === '/sync/bk-dump') {
    if (!env.SYNC_KEY || !(await sameText(req.headers.get('X-Sync-Key') || '', env.SYNC_KEY))) return json({ ok: false, error: 'sync key' }, 401);
    return json(path === '/sync/bk-tables' ? { ok: true, tables: await bkTables(env) } : await bkDump(env, String(b.table || ''), b.after));
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
  // ═════════ 관리 화면 (직원 PIN 로그인, 예전 관리자 비밀번호도 됨) ═════════
  if (path.startsWith('/admin/')) {
    const ip = req.headers.get('cf-connecting-ip') || 'x';
    const lu = await lockUntil(env, ip);
    if (lu) return json({ ok: false, error: lockText(lu) }, 429);
    const ses = b.tok ? await one(env, 'SELECT * FROM asess WHERE tok = ?', str(b.tok, 64)) : null;
    if (ses && ses.created < Date.now() - 180 * 86400e3) { await run(env, 'DELETE FROM asess WHERE tok = ?', ses.tok); return json({ ok: false, relogin: true, error: '다시 로그인해 주세요' }, 401); }
    if (ses) { if (ses.created < Date.now() - 86400e3) await run(env, 'UPDATE asess SET created = ? WHERE tok = ?', Date.now(), ses.tok); } // 쓰는 동안은 로그인 유지
    else if (b.tok && !b.password) return json({ ok: false, relogin: true, error: '다시 로그인해 주세요' }, 401);
    else if (b.spin && path === '/admin/kiosk-token') { // 태블릿 등록은 공용 PIN으로 (공용 기기)
      if (!(await teamSync(env, '/sync/pin-check', { shared: true, pin: str(b.spin, 12) })).ok) return json({ ok: false, error: failText('공용 PIN이 맞지 않아요', await failAdd(env, ip)) }, 401);
      await failClear(env, ip);
    }
    else if (!env.ADMIN_PASSWORD || !(await sameText(b.password || '', env.ADMIN_PASSWORD))) return json({ ok: false, error: failText('비밀번호가 맞지 않습니다', await failAdd(env, ip)) }, 401);
    else await failClear(env, ip);

    if (path === '/admin/status') {
      const today = kstDay(new Date());
      const parents = await all(env, 'SELECT id, kids, rel, ph, ok, created, ep, inv FROM parents ORDER BY created DESC');
      const kids = await all(env, 'SELECT name, codes FROM kids'), kst8 = await kidStatus(env);
      const att = await all(env, 'SELECT name, tin, tout FROM att WHERE day = ?', today);
      const boss = !ses || !!ses.boss; // 관리자 비밀번호로 들어온 경우는 관리자
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
      return json({ ok: true });
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
      const urgent = type === 'notice' && b.urgent ? 1 : 0, ask = urgent || ((type === 'notice' || type === 'journal') && b.ask) ? 1 : 0; // 긴급이면 확인도 받음
      const r = await run(env, 'INSERT INTO posts (type, kind, title, body, date, target, photos, pin, created, urgent, ask) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        type, String(b.kind || '').slice(0, 10), title, String(b.body || '').slice(0, 3000), date, JSON.stringify(target), JSON.stringify(photos), b.pin ? 1 : 0, Date.now(), urgent, ask);
      return json({ ok: true, id: r.meta && r.meta.last_row_id });
    }
    if (path === '/admin/post-delete') {
      const p = await one(env, 'SELECT photos FROM posts WHERE id = ?', b.id | 0);
      if (p) for (const ph of J(p.photos, [])) await run(env, 'DELETE FROM photos WHERE id = ?', ph);
      await run(env, 'DELETE FROM posts WHERE id = ?', b.id | 0);
      await run(env, 'DELETE FROM reads WHERE post = ?', b.id | 0);
      await run(env, 'DELETE FROM acks WHERE post = ?', b.id | 0);
      return json({ ok: true });
    }
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
      return json({ ok: true, items });
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
    .map(r => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, date: r.date, target: J(r.target, []), photos: J(r.photos, []), pin: !!r.pin, urgent: !!r.urgent, ask: !!r.ask, at: r.created }));
}
async function withAcks(env, items, parentId) { // 학부모 화면: 내가 '확인했어요'를 눌렀는지
  if (!items.some(x => x.ask)) return items;
  const mine = await all(env, 'SELECT post, at FROM acks WHERE parent = ?', parentId), m = {};
  mine.forEach(r => m[r.post] = r.at);
  return items.map(x => x.ask ? { ...x, acked: m[x.id] || null } : x);
}
async function listSchedule(env, month) {
  const m = /^\d{4}-\d{2}$/.test(month || '') ? month : kstDay(new Date()).slice(0, 7);
  const rows = await all(env, "SELECT * FROM posts WHERE type = 'schedule' AND date LIKE ? ORDER BY date, created", m + '-%');
  return rows.map(r => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, date: r.date, at: r.created }));
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
