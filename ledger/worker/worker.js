// 해랑 장부 서버 (haerang-ledger) — 2026-11-12
// 필요한 설정(바인딩): D1 DB → haerang-ledger, Service TEAM → haerang-team, Service NOTICE → haerang-push(관리자 비밀번호 확인)
// 기기 등록: 폰에 처음 깔면 관리자 비밀번호(알림 앱 ADMIN_PASSWORD, 알림 서버가 확인) 한 번 → 이 기기에서 관리자가 PIN으로 장부 전체를 열 수 있음.
// 로그인은 열 때마다 PIN (12시간 지나면 다시). 관리자(boss) = 장부 전체(등록된 기기에서만), '직원이에요' = 업무 앱 직원 수정에서 '장부 직원 입력'을 켠 직원만, 직원 화면(회원 조회·입력 → 관리자 승인).
// 공용 계정은 못 들어옴.
// 데이터: 예전 claude.ai 아티팩트 장부와 같은 모양의 문서(경로 'members/abc')를 그대로 저장.
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, coll TEXT, data TEXT, upd INTEGER, del INTEGER DEFAULT 0)',
  'CREATE INDEX IF NOT EXISTS docs_upd ON docs (upd)',
  'CREATE TABLE IF NOT EXISTS sessions (tok TEXT PRIMARY KEY, mid TEXT, name TEXT, role TEXT, created INTEGER)',
  'CREATE TABLE IF NOT EXISTS fails (ip TEXT PRIMARY KEY, n INTEGER, until INTEGER, at INTEGER)',
  'CREATE TABLE IF NOT EXISTS devices (tok TEXT PRIMARY KEY, created INTEGER, used INTEGER)',
];
const COLLS = ['config', 'members', 'families', 'ledger', 'pending', 'notes', 'ulsanpay', 'snapshots'];
const STAFF_READ = ['config', 'members', 'families', 'ledger']; // 직원 화면에 필요한 것만 (ledger는 회비 기록만, 울산페이·메모·승인 대기는 안 보임)
const SESSION_HOURS = 12;

export default {
  // 매달 5일 낮 12시(크론 '0 3 5 * *' = UTC 3시): 장부 기준 미납 가정에만 학부모 앱 회비 안내 (2026-11-13 사용자 결정)
  async scheduled(event, env, ctx) { ctx.waitUntil((async () => { await setup(env); await feeNoticeRun(env, false); })().catch(() => {})); },
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    const url = new URL(req.url);
    try { await setup(env); return cors(await route(url.pathname, req, env)); }
    catch (e) { return cors(json({ ok: false, error: '서버 오류: ' + (e && e.message || e) }, 500)); }
  },
};

let ready = false;
async function setup(env) { if (ready) return; for (const s of SCHEMA) await env.DB.prepare(s).run(); ready = true; }
const q = (env, sql, ...a) => env.DB.prepare(sql).bind(...a);
const all = async (env, sql, ...a) => (await q(env, sql, ...a).all()).results || [];
const one = (env, sql, ...a) => q(env, sql, ...a).first();
const run = (env, sql, ...a) => q(env, sql, ...a).run();
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const J = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (_) { return d; } };
const rid = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
const okPath = p => /^[a-z]+\/[\w~.-]{1,80}$/.test(p) && COLLS.includes(p.split('/')[0]);
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
function merge(a, b) { // 아티팩트 저장소의 update와 같게: 객체는 안쪽까지 합침
  const o = isObj(a) ? { ...a } : {};
  for (const [k, v] of Object.entries(b || {})) o[k] = isObj(v) && isObj(o[k]) ? merge(o[k], v) : v;
  return o;
}

async function team(env, path, body) {
  if (!env.TEAM) return { ok: false, error: '업무 앱이 연결되지 않았어요' };
  try { const r = await env.TEAM.fetch('https://team' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return await r.json(); }
  catch (_) { return { ok: false, error: '업무 앱에 연결하지 못했어요' }; }
}

async function route(path, req, env) {
  const b = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const ip = req.headers.get('cf-connecting-ip') || 'x';
  if (path === '/') return json({ ok: true, app: '해랑 장부' });
  if (path === '/api/members') {
    const r = await team(env, '/ledger/members', {});
    return json(r.ok ? { ok: true, members: (r.members || []).filter(m => !m.shared).map(m => ({ id: m.id, name: m.name, boss: !!m.boss, ledger: !!m.ledger })) } : r);
  }
  if (path === '/api/device') { // 이 기기를 관리자 기기로 등록 (장부 비밀번호)
    const k = 'dev:' + ip, lu = await lockUntil(env, k);
    if (lu) return json({ ok: false, error: lockText(lu) }, 429);
    if (!env.NOTICE) return json({ ok: false, error: '알림 앱이 연결되지 않았어요' }, 503);
    let r; try { r = await (await env.NOTICE.fetch('https://notice/ledger/admin-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: str(b.pw, 100) }) })).json(); } catch (_) { r = { ok: false, error: '알림 앱에 연결하지 못했어요' }; }
    if (r.error) return json({ ok: false, error: r.error }, 503);
    if (!r.ok) return json({ ok: false, error: failText('관리자 비밀번호가 맞지 않아요', await failAdd(env, k)) }, 401);
    await failClear(env, k);
    const tok = rid(24); await run(env, 'INSERT INTO devices (tok, created, used) VALUES (?, ?, ?)', tok, Date.now(), Date.now());
    return json({ ok: true, dev: tok });
  }
  if (path === '/api/login') {
    const k = 'pin:' + ip, lu = await lockUntil(env, k);
    if (lu) return json({ ok: false, error: lockText(lu) }, 429);
    const r = await team(env, '/ledger/pin-check', { mid: str(b.mid, 40), pin: str(b.pin, 12) });
    if (r.error) return json({ ok: false, error: r.error }, 503);
    if (!r.ok || r.shared) return json({ ok: false, error: failText('PIN이 맞지 않아요', await failAdd(env, k)) }, 401);
    await failClear(env, k);
    let role;
    if (b.as === 'owner') {
      if (!r.boss) return json({ ok: false, error: '관리자만 장부 전체를 열 수 있어요. 아래 \'직원이에요\'로 들어가 주세요' }, 403);
      const d = await one(env, 'SELECT tok FROM devices WHERE tok = ?', str(b.dev, 64));
      if (!d) return json({ ok: false, error: '이 기기는 아직 등록되지 않았어요. 장부 비밀번호를 먼저 넣어 주세요', device: true }, 403);
      await run(env, 'UPDATE devices SET used = ? WHERE tok = ?', Date.now(), d.tok); role = 'owner';
    } else {
      // 허락은 업무 앱 관리자 → 직원 수정의 '장부 직원 입력' 체크 (members.ledger)
      if (!r.boss && !r.ledger) return json({ ok: false, error: '아직 장부 사용을 허락받지 않았어요. 관리자에게 말해 주세요' }, 403);
      role = 'staff';
    }
    const tok = rid(24);
    await run(env, 'INSERT INTO sessions (tok, mid, name, role, created) VALUES (?, ?, ?, ?, ?)', tok, r.id, r.name, role, Date.now());
    return json({ ok: true, tok, name: r.name, role });
  }
  // ── 아래는 로그인 필요 ──
  const s = b.tok ? await one(env, 'SELECT * FROM sessions WHERE tok = ?', str(b.tok, 64)) : null;
  if (!s || s.created < Date.now() - SESSION_HOURS * 3600e3) { if (s) await run(env, 'DELETE FROM sessions WHERE tok = ?', s.tok); return json({ ok: false, relogin: true, error: '다시 PIN을 넣어 주세요' }, 401); }
  const owner = s.role === 'owner';
  const canRead = c => owner || STAFF_READ.includes(c);
  if (path === '/api/logout') { await run(env, 'DELETE FROM sessions WHERE tok = ?', s.tok); return json({ ok: true }); }
  if (path === '/api/me') return json({ ok: true, name: s.name, role: s.role });
  if (path === '/api/sync') { // since 이후 바뀐 문서 (처음엔 0 = 전부)
    const since = Number(b.since) || 0, now = Date.now();
    const rows = await all(env, 'SELECT path, coll, data, upd, del FROM docs WHERE upd > ? ORDER BY upd', since);
    const docs = rows.filter(r => canRead(r.coll)).map(r => {
      let d = r.del ? null : J(r.data, null);
      if (!owner && r.coll === 'config' && d) { d = { ...d }; for (const k of Object.keys(d)) if (/Hash$|Salt$/.test(k)) delete d[k]; }
      if (!owner && r.coll === 'ledger' && d) { const e = {}; for (const [id, x] of Object.entries(d.entries || {})) if (x && x.kind === 'fee') e[id] = x; d = { ...d, entries: e }; } // 직원: 회비 기록만
      return { path: r.path, data: d, upd: r.upd };
    });
    return json({ ok: true, now, docs, role: s.role, colls: COLLS.filter(canRead) });
  }
  if (path === '/api/get') {
    const p = str(b.path, 100); if (!okPath(p) || !canRead(p.split('/')[0])) return json({ ok: false, error: '볼 수 없는 기록이에요', code: 'permission_denied' }, 403);
    const r = await one(env, 'SELECT data, del FROM docs WHERE path = ?', p);
    let d = r && !r.del ? J(r.data, null) : null;
    if (!owner && d && p.startsWith('ledger/')) { const e = {}; for (const [id, x] of Object.entries(d.entries || {})) if (x && x.kind === 'fee') e[id] = x; d = { ...d, entries: e }; }
    if (!owner && d && p.startsWith('config/')) { d = { ...d }; for (const k of Object.keys(d)) if (/Hash$|Salt$/.test(k)) delete d[k]; }
    return json({ ok: true, exists: !!d, data: d });
  }
  if (path === '/api/write') { // ops: [{op:'set'|'update'|'delete', path, data}]
    const ops = Array.isArray(b.ops) ? b.ops.slice(0, 50) : [];
    for (const o of ops) {
      const p = str(o.path, 100); if (!okPath(p)) return json({ ok: false, error: '잘못된 경로', code: 'invalid_argument' }, 400);
      if (!owner && !(p.startsWith('pending/') && o.op === 'set')) return json({ ok: false, error: '직원 입력은 승인 대기로만 저장돼요', code: 'permission_denied' }, 403);
    }
    let last = 0;
    for (const o of ops) {
      const p = str(o.path, 100), c = p.split('/')[0], now = Math.max(Date.now(), last + 1); last = now;
      if (o.op === 'delete') { await run(env, 'UPDATE docs SET del = 1, data = NULL, upd = ? WHERE path = ?', now, p); continue; }
      let d = o.data;
      if (o.op === 'update') {
        const cur = await one(env, 'SELECT data, del FROM docs WHERE path = ?', p);
        if (!cur || cur.del) return json({ ok: false, error: '없는 기록이에요', code: 'not_found' }, 404);
        d = merge(J(cur.data, {}), o.data);
      } else if (o.op !== 'set') return json({ ok: false, error: '잘못된 요청', code: 'invalid_argument' }, 400);
      if (!owner) d = { ...d, by: '직원', byName: s.name };
      const txt = JSON.stringify(d); if (txt.length > 900000) return json({ ok: false, error: '기록이 너무 커요', code: 'quota_exceeded' }, 413);
      await run(env, 'INSERT INTO docs (path, coll, data, upd, del) VALUES (?, ?, ?, ?, 0) ON CONFLICT(path) DO UPDATE SET data = excluded.data, upd = excluded.upd, del = 0', p, c, txt, now);
    }
    return json({ ok: true, at: last });
  }
  if (path === '/api/fee-notice') { // 관리자: 5일 회비 안내 미리 보기 · 지난 기록
    if (!owner) return json({ ok: false, error: '관리자만 볼 수 있어요' }, 403);
    const plan = await feeNoticePlan(env), ym = kstToday().slice(0, 7);
    const chk = await notice(env, { check: true, kids: plan.flatMap(f => f.kids) });
    const info = new Map((chk.kids || []).map(k => [k.name, k]));
    const last = J((await one(env, "SELECT data FROM docs WHERE path = ? AND del = 0", 'snapshots/feenotice-' + ym) || {}).data, null);
    return json({ ok: true, ym, plan: plan.map(f => ({ ...f, phones: f.kids.reduce((t, k) => t + ((info.get(k) || {}).phones || 0), 0), onApp: f.kids.some(k => (info.get(k) || {}).onApp) })), last });
  }
  return json({ ok: false, error: '없는 주소' }, 404);
}

// ─────────── 매달 5일 회비 안내 (장부 기준 미납 가정에만, 독촉 아님) ───────────
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
async function notice(env, body) {
  if (!env.NOTICE) return { ok: false, error: '알림 앱이 연결되지 않았어요' };
  try { return await (await env.NOTICE.fetch('https://notice/ledger/fee-notice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json(); }
  catch (_) { return { ok: false, error: '알림 앱에 연결하지 못했어요' }; }
}
// 장부 화면과 같은 계산(HL)으로 미납 회비 → 가족별로 묶음 (재원·신규만, 휴원·퇴관 미수는 관리자가 직접)
async function feeNoticePlan(env) {
  const state = { members: {}, families: {}, ledger: {}, config: null };
  for (const r of await all(env, "SELECT path, coll, data FROM docs WHERE del = 0 AND coll IN ('config', 'members', 'families', 'ledger')")) {
    const id = r.path.slice(r.coll.length + 1), d = J(r.data, null); if (!d) continue;
    if (r.coll === 'config') { if (id === 'main') state.config = d; } else state[r.coll][id] = { ...d, id };
  }
  const H = globalThis.HL, ctx = H.makeCtx(state, { today: kstToday() });
  const fam = new Map();
  for (const x of H.overdueList(ctx)) {
    if (!H.isActiveStatus(H.currentStatus(x.m, ctx.today))) continue;
    const k = x.m.familyId || x.m.id;
    if (!fam.has(k)) fam.set(k, { kids: [], months: [] });
    const f = fam.get(k); if (!f.kids.includes(x.m.name)) f.kids.push(x.m.name); if (!f.months.includes(x.ym)) f.months.push(x.ym);
  }
  return [...fam.values()].map(f => ({ kids: f.kids, months: f.months.sort() }));
}
async function feeNoticeRun(env, force) {
  const today = kstToday(), ym = today.slice(0, 7), key = 'snapshots/feenotice-' + ym;
  if (!force && today.slice(8) !== '05') return { ok: true, skip: '5일이 아니에요' };
  if (await one(env, 'SELECT path FROM docs WHERE path = ? AND del = 0', key)) return { ok: true, skip: '이번 달은 이미 보냈어요' };
  const plan = await feeNoticePlan(env), out = [];
  for (const f of plan.slice(0, 40)) { // 무료 요금제 한 번에 부를 수 있는 수 안에서
    const months = f.months.map(m => Number(m.slice(5)) + '월').join('·');
    const body = { kids: f.kids, title: '회비 안내', body: f.kids.join('·') + ' ' + months + ' 회비 안내드려요. 이미 보내 주셨다면 확인이 늦은 것이니 넘겨 주세요. 궁금한 점은 도장으로 연락 주세요.' };
    let sent = 0, offset = 0;
    for (let i = 0; i < 5; i++) { const r = await notice(env, { ...body, offset }); sent += r.sent || 0; if (!r.ok || r.next == null) break; offset = r.next; }
    out.push({ kids: f.kids, months: f.months, sent });
  }
  await run(env, 'INSERT INTO docs (path, coll, data, upd, del) VALUES (?, ?, ?, ?, 0) ON CONFLICT(path) DO UPDATE SET data = excluded.data, upd = excluded.upd, del = 0', key, 'snapshots', JSON.stringify({ at: new Date().toISOString(), families: out }), Date.now());
  return { ok: true, families: out };
}

// 틀린 횟수 잠금 (다른 앱과 같은 규칙: 5번마다 1분·2분·3분…)
async function lockUntil(env, k) { const f = await one(env, 'SELECT until FROM fails WHERE ip = ?', k); return f && f.until > Date.now() ? f.until : 0; }
async function failAdd(env, k) {
  const f = await one(env, 'SELECT n, at FROM fails WHERE ip = ?', k), now = Date.now();
  const n = (f && f.at > now - 86400e3 ? f.n : 0) + 1, until = n % 5 === 0 ? now + (n / 5) * 60000 : 0;
  await run(env, 'INSERT INTO fails (ip, n, until, at) VALUES (?, ?, ?, ?) ON CONFLICT(ip) DO UPDATE SET n = excluded.n, until = excluded.until, at = excluded.at', k, n, until, now);
  return n;
}
async function failClear(env, k) { await run(env, 'DELETE FROM fails WHERE ip = ?', k); }
const lockText = u => '여러 번 틀려서 잠깐 잠겼어요. ' + Math.ceil((u - Date.now()) / 60000) + '분 뒤에 다시 해 주세요';
const failText = (t, n) => t + ' (' + (((n - 1) % 5) + 1) + '/5번 틀림)';
async function sha(t) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, '0')).join(''); }
function json(o, status = 200) { return new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } }); }
function cors(r) {
  const h = new Headers(r.headers);
  h.set('Access-Control-Allow-Origin', '*'); h.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS'); h.set('Access-Control-Allow-Headers', 'Content-Type');
  return new Response(r.body, { status: r.status, headers: h });
}

// ==== HL 시작 (ledger/index.html에서 자동 복사 · 손으로 고치지 말고 tools/sync_ledger_hl.py) ====
/* 해랑경희 장부 — 계산 로직 (화면과 분리된 순수 함수)
 * 모든 금액·상태·검증·결산 숫자는 여기서 코드로 계산한다. AI는 문장 해석만 한다. */
(function (root) {
'use strict';
const HL = {};

/* ───────── 날짜 (한국 시간) ───────── */
let NOW_OVERRIDE = null;
HL.setNow = (d) => { NOW_OVERRIDE = d ? new Date(d) : null; };
const now = () => (NOW_OVERRIDE ? new Date(NOW_OVERRIDE) : new Date());
const pad = (n) => String(n).padStart(2, '0');
HL.pad = pad;
HL.today = () => { const t = new Date(now().getTime() + 9 * 3600e3); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
HL.nowIso = () => now().toISOString();
HL.ym = (date) => (date ? String(date).slice(0, 7) : null);
HL.addMonths = (ym, n) => { let [y, m] = ym.split('-').map(Number); m += n; y += Math.floor((m - 1) / 12); m = (((m - 1) % 12) + 12) % 12 + 1; return `${y}-${pad(m)}`; };
HL.lastDay = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
HL.dueDate = (ym, payday) => (payday ? `${ym}-${pad(Math.min(Number(payday), HL.lastDay(ym)))}` : null);
const toUTC = (date) => { const [y, m, d] = date.split('-').map(Number); return Date.UTC(y, m - 1, d); };
HL.addDays = (date, n) => { const t = new Date(toUTC(date) + n * 864e5); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
HL.daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 864e5);
HL.weekday = (date) => new Date(toUTC(date)).getUTCDay();
HL.isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(toUTC(s)) && HL.addDays(s, 0) === s;
HL.isYm = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s || '');
HL.monthLabel = (ym) => `${Number(ym.slice(5, 7))}월`;
HL.monthLabelFull = (ym) => `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월`;
HL.md = (date) => (date ? `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}` : '-');
HL.fmt = (n) => (n == null || isNaN(n) ? '-' : Math.round(n).toLocaleString('ko-KR'));
HL.won = (n) => (n == null || isNaN(n) ? '미정' : `${HL.fmt(n)}원`);
HL.uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/* ───────── 상수 ───────── */
HL.METHODS = ['카드', '계좌이체', '울산페이', '결제선생', '해랑경희 상품권', '스포츠 바우처'];
HL.GIFT = '해랑경희 상품권';
HL.STATUSES = ['재원', '휴원', '퇴관', '신규'];
HL.MISC_CONTENTS = ['도복비', '가입비', '행사비', '심사비', '대회비'];
HL.MISC_MAP = [[/도복/, '도복비'], [/가입비/, '가입비'], [/행사/, '행사비'], [/심사/, '심사비'], [/대회/, '대회비']];
HL.DAYS = ['월', '화', '수', '목', '금', '토', '일'];
HL.FAMILY_DISCOUNT = 10000;
HL.DEFAULT_PRICES = { high: 165000, low: 145000, middle: 175000 };
HL.TIER_LABEL = { low: '주3회', high: '주5회', middle: '중등부' };
HL.MIDDLE_AGE = 14; // 한국 나이 14살 = 중1

/* ───────── 나이·학년 ───────── */
HL.koreanAge = (birthYear, year) => (birthYear ? (year || Number(HL.today().slice(0, 4))) - Number(birthYear) + 1 : null);
HL.grade = (age) => {
  if (!age) return '';
  if (age <= 7) return '유치';
  if (age <= 13) return `초${age - 7}`;
  if (age <= 16) return `중${age - 13}`;
  if (age <= 19) return `고${age - 16}`;
  return '성인';
};
HL.ageLabel = (m) => { const a = HL.koreanAge(m.birthYear); return a ? `${a}살 · ${HL.grade(a)}` : '나이 미정'; };

/* ───────── 회비 단가 ───────── */
HL.priceFor = (cfg, ym) => {
  const prices = (cfg && cfg.prices) || {};
  const keys = Object.keys(prices).filter((k) => k <= ym).sort();
  return { ...HL.DEFAULT_PRICES, ...(keys.length ? prices[keys[keys.length - 1]] : {}) };
};
HL.tierOf = (wc) => { const n = Number(wc); if (!Number.isInteger(n)) return null; if (n >= 4 && n <= 5) return 'high'; if (n >= 1 && n <= 3) return 'low'; return null; };
HL.customFeeAt = (m, ym) => {
  const map = m.customFees || {};
  const keys = Object.keys(map).filter((k) => k <= ym).sort();
  if (keys.length) return map[keys[keys.length - 1]];
  return m.customFee != null ? m.customFee : null;
};
/** 그 달 정상 회비 (가족할인 전). 모르면 null */
HL.baseFor = (m, cfg, ym) => {
  if (m.feeMode === 'custom') { const v = HL.customFeeAt(m, ym); return v == null ? { base: null, src: 'custom' } : { base: Number(v), src: 'custom' }; }
  const tier = HL.feeTier(m, ym);
  if (!tier) return { base: null, src: 'unknown' };
  return { base: HL.priceFor(cfg, ym)[tier], src: tier };
};
/** 회비 구간: 중학생 이상(한국 나이 14살 이상)은 중등부, 아니면 주 1~3회 → 주3회, 4~5회 → 주5회 */
HL.isMiddle = (m, ym) => { const a = HL.koreanAge(m.birthYear, ym ? Number(ym.slice(0, 4)) : undefined); return !!a && a >= HL.MIDDLE_AGE; };
HL.feeTier = (m, ym) => (HL.isMiddle(m, ym) ? 'middle' : HL.tierOf(m.weeklyCount));
HL.weeklyFromDays = (days) => (Array.isArray(days) ? days.length : 0);

/* ───────── 회원 상태 타임라인 ───────── */
HL.statusLogList = (m) => Object.entries(m.statusLog || {}).filter(([, v]) => v && !v.void).map(([id, v]) => ({ id, ...v })).sort((a, b) => (a.from === b.from ? String(a.at).localeCompare(String(b.at)) : a.from.localeCompare(b.from)));
HL.NEW_DAYS = 30; // 가입일부터 이 일수가 지나면 '신규'는 자동으로 '재원'으로 본다 (저장값은 그대로, 계산해서 보여줌)
HL.statusAt = (m, date) => {
  const list = HL.statusLogList(m).filter((e) => e.from <= date);
  const st = list.length ? list[list.length - 1].status : (m.status || '재원');
  if (st === '신규' && m.joinDate && HL.isDate(date) && HL.daysBetween(m.joinDate, date) >= HL.NEW_DAYS) return '재원';
  return st;
};
HL.isActiveStatus = (s) => s === '재원' || s === '신규';
HL.currentStatus = (m, today) => HL.statusAt(m, today || HL.today());
/** 예정된 상태 변경 (오늘 이후 시작) */
HL.plannedStatus = (m, today) => HL.statusLogList(m).filter((e) => e.from > (today || HL.today())).pop() || null;
HL.joinedBy = (m, date) => !m.joinDate || m.joinDate <= date;
HL.isActiveAt = (m, date) => HL.isActiveStatus(HL.statusAt(m, date)) && HL.joinedBy(m, date);

/* ───────── 가족 할인 ───────── */
HL.familyMembers = (members, familyId) => members.filter((x) => familyId && x.familyId === familyId);
HL.oldestFirst = (a, b) => {
  const ay = a.birthYear || 9999, by = b.birthYear || 9999;
  if (ay !== by) return ay - by;
  return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
};
HL.familyRep = (members, familyId, date) => {
  const act = HL.familyMembers(members, familyId).filter((x) => HL.isActiveAt(x, date)).sort(HL.oldestFirst);
  return act[0] || null;
};
HL.familyDiscountFor = (m, date, members, families) => {
  if (!m.familyId) return { disc: 0 };
  const fam = (families || []).find((f) => f.id === m.familyId) || {};
  const all = HL.familyMembers(members, m.familyId);
  const act = all.filter((x) => HL.isActiveAt(x, date)).sort(HL.oldestFirst);
  if (!act.length || act[0].id !== m.id) return { disc: 0 };
  const decision = fam.decision || 'auto';
  if (decision === 'stop') return { disc: 0, rep: m.id };
  if (act.length >= 2) return { disc: HL.FAMILY_DISCOUNT, rep: m.id };
  if (act.length === 1 && (decision === 'keep' || decision === 'pending') && all.some((x) => HL.statusAt(x, date) === '휴원')) return { disc: HL.FAMILY_DISCOUNT, rep: m.id };
  return { disc: 0, rep: m.id };
};

/** 가족 연결 시 이번 달 할인 계획 (확인창에 보여줄 내용)
 * - 할인 대표(나이 많은 재원)의 이번 달 회비가 아직 안 냈으면 → 대표 회비에서 10,000원
 * - 대표가 이미 냈으면 → 새로 연결된 회원의 이번 달 회비에서 10,000원
 * - 다음 달부터는 늘 대표에게 */
HL.familyPlan = (selfId, famId, ctx) => {
  const { members, today, idx } = ctx;
  const ym = ctx.applyYm || HL.ym(today);
  if (!famId) return { action: 'none', ym };
  const fam = members.filter((x) => x.familyId === famId);
  const self = fam.find((x) => x.id === selfId);
  const isAct = (x) => HL.isActiveStatus(HL.statusAt(x, today)) && (!x.joinDate || HL.ym(x.joinDate) <= ym);
  const act = fam.filter(isAct).sort(HL.oldestFirst);
  if (!self || !isAct(self) || act.length < 2) return { action: 'none', ym };
  if (fam.some((x) => x.fees && x.fees[ym] && !x.fees[ym].cancelled && x.fees[ym].disc > 0)) return { action: 'done', ym };
  const rep = act[0];
  const stOf = (x) => (x.fees && x.fees[ym] ? HL.feeState(x, ym, idx, today) : null);
  const open = (x) => { const st = stOf(x); return !st || (st.cat !== 'cancelled' && st.paid === 0); };
  const pick = (x, repPaid) => (x.id === selfId ? { action: 'self', targetId: x.id, repId: rep.id, repPaid, ym } : { action: 'other', targetId: x.id, repId: rep.id, repPaid, ym });
  if (rep.id !== selfId && !stOf(rep)) return { action: 'auto', repId: rep.id, targetId: rep.id, ym };
  if (open(rep)) return pick(rep, false);
  // 대표가 이번 달 이미 냈으면 → 이번에 연결된 회원(없으면 아직 안 낸 다른 가족)
  const order = [self, ...act.filter((x) => x.id !== selfId && x.id !== rep.id)].filter((x) => x.id !== rep.id);
  const t = order.find(open);
  return t ? pick(t, true) : { action: 'paid', repId: rep.id, ym };
};

/* ───────── 회비 대상 판정 ───────── */
/** 결제일. 가입한 달은 결제일이 가입일보다 앞서면 가입일을 그 달 결제일로 본다 (가입한 달도 회비 대상) */
HL.feeDue = (m, ym) => {
  const f = m.fees && m.fees[ym]; if (f && f.due) return f.due;
  const d = HL.dueDate(ym, m.payday);
  if (d && m.joinDate && HL.ym(m.joinDate) === ym && d < m.joinDate) return m.joinDate;
  return d;
};
/** 이 회원이 이 달 회비 대상인가 (5-6) */
/** 시뮬레이션용: true면 장부 시작 월 이전의 지난 달도 모두 추적한다. 실제 운영에서 시작 월 규칙으로 돌아가려면 false */
HL.TRACK_ALL_PAST = false;
HL.expectedFor = (m, ym, cfg, today) => {
  if (!cfg || (ym < cfg.startMonth && !HL.TRACK_ALL_PAST)) return { expected: false, reason: '장부 시작 전' };
  if (m.skip && m.skip[ym]) return { expected: false, reason: m.skip[ym].reason || '결제일 연장', skip: true };
  const due = HL.feeDue(m, ym);
  if (!due) {
    // 결제일이 없으면 대상 여부만 판단하고 누락으로 드러나게 한다
    const ref = ym === HL.ym(today) ? today : `${ym}-${pad(HL.lastDay(ym))}`;
    if (HL.isActiveAt(m, ref)) return { expected: true, due: null, reason: '결제일 없음' };
    return { expected: false, reason: '재원 아님' };
  }
  if (!HL.joinedBy(m, due)) return { expected: false, reason: '가입 전', due };
  const st = HL.statusAt(m, due);
  if (!HL.isActiveStatus(st)) return { expected: false, reason: st, due };
  return { expected: true, due };
};
/** 새로 만들어야 할 회비 기록 (앱을 열 때 실행) */
HL.feeSnapshot = (m, ym, ctx) => {
  const due = HL.feeDue({ ...m, fees: {} }, ym);
  const { base, src } = HL.baseFor(m, ctx.cfg, ym);
  const fd = HL.familyDiscountFor(m, due, ctx.members, ctx.families);
  return { due, base, src, disc: base == null ? 0 : fd.disc, at: HL.nowIso() };
};
HL.feesToGenerate = (ctx) => {
  const { members, cfg, today } = ctx;
  const out = [];
  if (!cfg || !cfg.startMonth) return out;
  const cur = HL.ym(today);
  for (const m of members) {
    if (!m.payday) continue;
    let ym = cfg.startMonth;
    const jm = m.joinDate ? HL.ym(m.joinDate) : null;
    if (jm && jm > ym) ym = jm;
    for (; ym <= cur; ym = HL.addMonths(ym, 1)) {
      if (m.fees && m.fees[ym]) continue;
      const ex = HL.expectedFor(m, ym, cfg, today);
      if (!ex.expected) continue;
      out.push({ memberId: m.id, ym, fee: HL.feeSnapshot(m, ym, ctx) });
    }
  }
  return out;
};

/* ───────── 장부 색인 ───────── */
HL.allEntries = (ledgerDocs) => {
  const out = [];
  for (const d of ledgerDocs || []) for (const [id, e] of Object.entries(d.entries || {})) out.push({ ...e, id, bucket: d.id });
  return out.sort((a, b) => (a.date === b.date ? String(a.at).localeCompare(String(b.at)) : a.date.localeCompare(b.date)));
};
HL.giftOf = (e) => (e.methods || []).filter((x) => x.m === HL.GIFT).reduce((s, x) => s + Number(x.a || 0), 0);
HL.buildIndex = (entries) => {
  const byFee = new Map(), carryTo = new Map();
  for (const e of entries) {
    if (e.cancelled || e.kind !== 'fee' || !e.memberId) continue;
    const k = `${e.memberId}|${e.feeMonth}`;
    if (!byFee.has(k)) byFee.set(k, []);
    byFee.get(k).push(e);
    if (e.remainder && e.remainder.action === 'carry' && e.remainder.amount > 0 && e.remainder.carryTo) {
      const k2 = `${e.memberId}|${e.remainder.carryTo}`;
      if (!carryTo.has(k2)) carryTo.set(k2, []);
      carryTo.get(k2).push({ amount: e.remainder.amount, from: e.feeMonth, entryId: e.id });
    }
  }
  return { byFee, carryTo };
};

/* ───────── 월별 회비 상태 (납부액은 거래에서 계산) ───────── */
HL.feeState = (m, ym, idx, today, opts) => {
  const fee = (opts && opts.fee) || (m.fees && m.fees[ym]);
  if (!fee) return null;
  const key = `${m.id}|${ym}`;
  const pays = ((idx.byFee.get(key)) || []).filter((e) => !(opts && opts.excludeId && e.id === opts.excludeId));
  const carries = idx.carryTo.get(key) || [];
  const carryIn = carries.reduce((s, c) => s + c.amount, 0);
  const due = fee.base == null ? null : fee.base - (fee.disc || 0);
  const r = { ym, fee, due, base: fee.base, disc: fee.disc || 0, carryIn, carries, pays, paid: 0, curCash: 0, curGift: 0, carryPaid: 0, curWaive: 0, curCarryOut: 0, carryWaive: 0, carryReCarry: 0, over: 0, lastPayDate: null };
  let carryRem = carryIn, curRem = due == null ? 0 : due;
  for (const e of pays) {
    const g = HL.giftOf(e), c = Number(e.amount) - g;
    const amt = Number(e.amount);
    const toCarry = e.payFor === 'cur' ? 0 : Math.min(amt, Math.max(carryRem, 0));
    carryRem -= toCarry;
    const carryCash = Math.min(toCarry, c), carryGift = toCarry - carryCash;
    r.carryPaid += toCarry; r.curCash += c - carryCash; r.curGift += g - carryGift;
    curRem -= amt - toCarry;
    r.paid += amt;
    if (!r.lastPayDate || e.date > r.lastPayDate) r.lastPayDate = e.date;
    if (e.remainder && e.remainder.amount > 0 && e.remainder.action !== 'unpaid') {
      let ra = Number(e.remainder.amount);
      const toC = e.payFor === 'cur' ? 0 : Math.min(ra, Math.max(carryRem, 0)); carryRem -= toC; ra -= toC; curRem -= ra;
      if (e.remainder.action === 'waive') { r.carryWaive += toC; r.curWaive += ra; } else { r.carryReCarry += toC; r.curCarryOut += ra; }
    }
  }
  if (curRem < 0 && due != null) { r.over = -curRem; curRem = 0; }
  r.carryRem = Math.max(carryRem, 0);
  r.curRem = due == null ? null : curRem;
  r.outstanding = due == null ? null : r.carryRem + curRem;
  r.total = due == null ? null : carryIn + due;
  const past = fee.due ? today > fee.due : false;
  r.past = past;
  r.prepaid = pays.length > 0 && pays.every((e) => HL.ym(e.date) < ym);
  if (fee.cancelled) { r.cat = 'cancelled'; r.label = '취소'; }
  else if (due == null) { r.cat = r.paid > 0 ? 'done' : (past ? 'unpaid' : 'upcoming'); r.label = r.paid > 0 ? '납부(금액 미정)' : (past ? '미납(금액 미정)' : '결제예정(금액 미정)'); r.undecided = true; }
  else if (r.outstanding <= 0) {
    r.cat = 'done';
    r.label = due === 0 && r.paid === 0 ? '수강료 0원' : r.curCarryOut > 0 ? '처리완료(이월)' : r.curWaive > 0 ? '납부완료(감면)' : r.prepaid ? '납부완료(선납)' : '납부완료';
  } else {
    r.cat = past ? 'unpaid' : 'upcoming';
    r.label = past ? (r.paid > 0 ? '부분납부(미납)' : '미납') : (r.paid > 0 ? '부분납부' : '결제예정');
  }
  r.settled = r.cat === 'done';
  return r;
};
/** 한 줄 표기: "230,000원 (회비 165,000 + 10월 이월 65,000)" */
HL.billLine = (st) => {
  if (!st) return '';
  if (st.due == null) return st.carryIn ? `미정 + 이월 ${HL.fmt(st.carryIn)}` : '금액 미정';
  if (!st.carryIn) return `${HL.fmt(st.due)}원`;
  const parts = st.carries.map((c) => `${HL.monthLabel(c.from)} 이월 ${HL.fmt(c.amount)}`).join(' + ');
  return `${HL.fmt(st.total)}원 (회비 ${HL.fmt(st.due)} + ${parts})`;
};
HL.nextFeeMonth = (m, ym) => { let n = HL.addMonths(ym, 1); for (let i = 0; i < 24 && m.skip && m.skip[n]; i++) n = HL.addMonths(n, 1); return n; };

/** 처음 결제 방식을 기준으로 채운다: 신규는 가입 당시, 기존 회원은 장부에 처음 입력된 회비 (금액이 다르면 마지막 수단에서 맞춘다) */
HL.methodName = (m) => (m.payMethod === '기타' ? (m.payMethodOther ? `기타:${m.payMethodOther}` : '') : (m.payMethod || ''));
HL.payTemplate = (m, ctx, amount) => {
  const last = (ctx.entries || []).filter((e) => e.kind === 'fee' && e.memberId === m.id && !e.cancelled && (e.methods || []).length)
    .sort((a, b) => (a.date === b.date ? String(a.at).localeCompare(String(b.at)) : a.date.localeCompare(b.date)))[0];
  // 앱에서 새로 등록한 회원은 등록 때 정한 결제방법 기준 (등록 때 나눠 냈어도 다음부터는 결제방법대로)
  const appMember = m.origin === 'app' || (!m.origin && m.log && m.log.h0 && /앱에서 등록|직원 등록 요청/.test(String(m.log.h0.after || '')));
  const mn0 = HL.methodName(m);
  if (appMember && mn0) return { methods: [{ m: mn0, a: amount }], note: `가입 때 정한 결제방법(${mn0.replace(/^기타:/, '')})을 채웠어요.` };
  if (!last) { const mn = HL.methodName(m); return { methods: [{ m: mn, a: amount }], note: mn ? `가입 때 정한 결제방법(${mn.replace(/^기타:/, '')})을 채웠어요.` : '' }; }
  const rows = last.methods.map((r) => ({ m: r.m, a: Number(r.a) }));
  const desc = rows.map((r) => (rows.length > 1 ? `${r.m.replace(/^기타:/, '')} ${HL.fmt(r.a)}` : r.m.replace(/^기타:/, ''))).join(' + ');
  const note = `처음 결제 방식(${HL.md(last.date)}: ${desc})을 그대로 채웠어요.`;
  if (rows.length === 1) return { methods: [{ m: rows[0].m, a: amount }], note };
  if (amount == null) return { methods: rows.map((r) => ({ m: r.m, a: null })), note };
  const sum = rows.reduce((s, r) => s + r.a, 0);
  if (sum === Number(amount)) return { methods: rows, note };
  const fixed = rows.slice(0, -1).reduce((s, r) => s + r.a, 0);
  const lastAmt = Number(amount) - fixed;
  if (lastAmt > 0) return { methods: [...rows.slice(0, -1), { m: rows[rows.length - 1].m, a: lastAmt }], note: `${note} 금액이 달라 ${rows[rows.length - 1].m.replace(/^기타:/, '')} 금액을 맞췄어요.` };
  return { methods: [{ m: rows[0].m, a: amount }], note };
};

/* ───────── 검증 (5-6) ───────── */
HL.verifyMonth = (ctx, ym) => {
  const { members, cfg, idx, today } = ctx;
  const res = { ym, expected: [], done: [], unpaid: [], upcoming: [], missing: [], extra: [], skipped: [], undecided: [] };
  if (!cfg || (ym < cfg.startMonth && !HL.TRACK_ALL_PAST)) { res.notTracked = true; res.pass = true; return res; }
  if (ym > HL.ym(today)) { res.future = true; }
  for (const m of members) {
    const ex = HL.expectedFor(m, ym, cfg, today);
    const fee = m.fees && m.fees[ym] && !m.fees[ym].cancelled ? m.fees[ym] : null;
    if (m.skip && m.skip[ym]) res.skipped.push({ m, reason: m.skip[ym].reason });
    if (ex.expected) {
      res.expected.push(m);
      if (!fee) { res.missing.push({ m, reason: ex.reason === '결제일 없음' ? '결제일이 없어 회비 기록을 만들 수 없음' : (m.fees && m.fees[ym] && m.fees[ym].cancelled ? '회비 기록이 취소됨' : '회비 기록 없음') }); continue; }
      const st = HL.feeState(m, ym, idx, today);
      if (st.undecided) res.undecided.push({ m, st });
      res[st.cat].push({ m, st });
    } else if (fee) {
      const st = HL.feeState(m, ym, idx, today);
      if (st.paid > 0) { res.extra.push({ m, st, reason: `${ex.reason}인데 회비 기록 있음(납부 있음)` }); res[st.cat === 'cancelled' ? 'done' : st.cat].push({ m, st, extra: true }); }
      else res.extra.push({ m, st, reason: `${ex.reason}인데 회비 기록 있음` });
    }
  }
  const counted = res.done.filter((x) => !x.extra).length + res.unpaid.length + res.upcoming.length;
  res.target = res.expected.length;
  res.counted = counted;
  res.pass = !res.future && res.missing.length === 0 && res.extra.filter((x) => !(x.st && x.st.paid > 0)).length === 0 && counted === res.target;
  if (res.future) res.pass = res.missing.length === 0;
  return res;
};

/* ───────── 결산 ───────── */
HL.cashOf = (e) => Number(e.amount) - HL.giftOf(e);
/** 실제 돈이 오간 날짜 기준 (8-1) */
HL.cashSummary = (entries, from, to) => {
  const r = { fee: 0, misc: 0, miscBy: {}, income: 0, expense: 0, expenses: [], gift: 0, profit: 0, count: 0 };
  for (const e of entries) {
    if (e.cancelled || e.date < from || e.date > to) continue;
    r.count++;
    if (e.kind === 'expense') { r.expense += Number(e.amount); r.expenses.push(e); continue; }
    const cash = HL.cashOf(e), gift = HL.giftOf(e);
    r.gift += gift;
    if (e.kind === 'fee') r.fee += cash;
    else { r.misc += cash; r.miscBy[e.content || '기타'] = (r.miscBy[e.content || '기타'] || 0) + cash; }
  }
  r.income = r.fee + r.misc; r.profit = r.income - r.expense;
  return r;
};
HL.monthRange = (ym) => [`${ym}-01`, `${ym}-${pad(HL.lastDay(ym))}`];
/** 회비 월 기준 발생액·수납액 (8-2) */
HL.feeEquation = (ctx, ym) => {
  const { members, idx, today } = ctx;
  const q = { occurred: 0, cash: 0, gift: 0, waive: 0, carryOut: 0, unpaid: 0, upcoming: 0, over: 0, discount: 0, baseTotal: 0, undecided: 0,
    carryIn: 0, carryPaid: 0, carryWaive: 0, carryReCarry: 0, carryRem: 0, rows: [] };
  for (const m of members) {
    const fee = m.fees && m.fees[ym];
    if (!fee || fee.cancelled) continue;
    const st = HL.feeState(m, ym, idx, today);
    q.carryIn += st.carryIn; q.carryPaid += st.carryPaid; q.carryWaive += st.carryWaive; q.carryReCarry += st.carryReCarry; q.carryRem += st.carryRem;
    if (st.due == null) { q.undecided++; continue; }
    q.baseTotal += st.base; q.discount += st.disc;
    q.occurred += st.due; q.cash += st.curCash; q.gift += st.curGift; q.waive += st.curWaive; q.carryOut += st.curCarryOut; q.over += st.over;
    if (st.cat === 'unpaid') q.unpaid += st.curRem; else if (st.cat === 'upcoming') q.upcoming += st.curRem;
    q.rows.push({ m, st });
  }
  q.rhs = q.cash + q.gift + q.waive + q.unpaid + q.carryOut + q.upcoming - q.over;
  q.ok = q.rhs === q.occurred;
  return q;
};
/** 미납·미수 전체 (모든 달) */
HL.overdueList = (ctx) => {
  const { members, idx, today } = ctx;
  const out = [];
  for (const m of members) for (const ym of Object.keys(m.fees || {}).sort()) {
    const st = HL.feeState(m, ym, idx, today);
    if (st && st.cat === 'unpaid') out.push({ m, ym, st, left: HL.statusAt(m, today) === '퇴관', days: HL.daysBetween(st.fee.due, today) });
  }
  return out.sort((a, b) => a.st.fee.due.localeCompare(b.st.fee.due) || a.m.name.localeCompare(b.m.name, 'ko'));
};
HL.oldestUnpaidMonth = (m, ctx) => {
  for (const ym of Object.keys(m.fees || {}).sort()) {
    const st = HL.feeState(m, ym, ctx.idx, ctx.today);
    if (st && st.cat === 'unpaid') return ym;
  }
  return null;
};

/* ───────── 금액·날짜 해석 (규칙 기반) ───────── */
const UNIT = { 만: 10000, 천: 1000, 백: 100, '': 1 };
const NOT_MONEY = /^\s*(월|일|년|회|명|개|주|살|세|시|분|번|달|째|차|기|등|위|kg|cm)/;
HL.parseAmounts = (text) => {
  const out = [];
  if (!text) return out;
  const re = /((?:\d[\d,]*(?:\.\d+)?\s*[만천백]?\s*)+)(원)?/g;
  let mt;
  while ((mt = re.exec(text))) {
    const chunk = mt[1];
    const after = text.slice(mt.index + mt[0].length);
    let total = 0, hasUnit = false;
    const tre = /(\d[\d,]*(?:\.\d+)?)\s*([만천백]?)/g;
    let t;
    while ((t = tre.exec(chunk))) { const v = parseFloat(t[1].replace(/,/g, '')); total += v * UNIT[t[2]]; if (t[2]) hasUnit = true; }
    total = Math.round(total);
    if (!mt[2] && NOT_MONEY.test(after)) continue;
    if (!mt[2] && !hasUnit && total < 1000) continue;
    out.push({ value: total, text: mt[0].trim(), index: mt.index, end: mt.index + mt[0].length });
  }
  const bare = /(^|[^\d])만\s*원/g; // "만원"
  while ((mt = bare.exec(text))) if (!out.some((a) => mt.index + mt[1].length >= a.index && mt.index < a.end)) out.push({ value: 10000, text: '만원', index: mt.index + mt[1].length, end: mt.index + mt[0].length });
  return out.sort((a, b) => a.index - b.index);
};
HL.parseAmount = (text) => { if (text == null) return null; if (typeof text === 'number') return text; const a = HL.parseAmounts(String(text)); return a.length ? a.reduce((s, x) => s + x.value, 0) : null; };
const NUMW = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6 };
/** 날짜 표현 → YYYY-MM-DD. 못 찾으면 null */
HL.parseDate = (text, today) => {
  if (!text) return null;
  const t = String(text);
  let mt;
  if ((mt = t.match(/(\d{4})[-.\/]\s*(\d{1,2})[-.\/]\s*(\d{1,2})/))) return `${mt[1]}-${pad(mt[2])}-${pad(mt[3])}`;
  if ((mt = t.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/))) return `${HL.nearYear(Number(mt[1]), today)}-${pad(mt[1])}-${pad(mt[2])}`;
  if ((mt = t.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?!\d)/))) return `${HL.nearYear(Number(mt[1]), today)}-${pad(mt[1])}-${pad(mt[2])}`;
  if (/그저께|그제/.test(t)) return HL.addDays(today, -2);
  if (/어제/.test(t)) return HL.addDays(today, -1);
  if (/모레/.test(t)) return HL.addDays(today, 2);
  if (/내일/.test(t)) return HL.addDays(today, 1);
  if (/다음\s*주/.test(t)) { const w = HL.weekday(today); return HL.addDays(today, ((8 - w) % 7) || 7); }
  if (/오늘|지금|방금/.test(t)) return today;
  return null;
};
HL.nearYear = (month, today) => {
  const y = Number(today.slice(0, 4)), cm = Number(today.slice(5, 7));
  const diff = month - cm;
  if (diff > 6) return y - 1;
  if (diff < -9) return y + 1;
  return y;
};
HL.nearYm = (month, today) => `${HL.nearYear(month, today)}-${pad(month)}`;
HL.parseMethods = (text) => {
  const keys = [[/울산\s*페이/g, '울산페이'], [/결제\s*선생/g, '결제선생'], [/(해랑경희\s*)?상품권/g, HL.GIFT], [/계좌\s*이체|계좌|이체|송금/g, '계좌이체'], [/카드/g, '카드'], [/현금/g, '기타:현금']];
  const found = [];
  for (const [re, name] of keys) { let mt; re.lastIndex = 0; while ((mt = re.exec(text))) { if (!found.some((f) => mt.index >= f.index && mt.index < f.end)) found.push({ m: name, index: mt.index, end: mt.index + mt[0].length }); } }
  return found.sort((a, b) => a.index - b.index);
};

/* ───────── 자연어 → 의도 (규칙 기반) ───────── */
const STOP = new Set('오늘 어제 그제 그저께 내일 모레 회비 주유 도복 이번 지난 저번 다음 미납 미납된 밀린 가입비 행사 행사비 심사 심사비 대회 대회비 지출 수입 잡수입 카드 계좌 현금 상품권 울산페이 결제선생 전기 수도 월세 관리비 간식 식비 택배 구입 구매 이번달 다음달 저번달 지난달 올해 장부 결산 아직 모두 전부 결제일 휴원 퇴관 복귀 도장 학원 관장님 기름 주차 회식 선납 이월 감면'.split(' '));
const EXPENSE_WORDS = /주유|기름|식비|간식|회식|월세|임대료|관리비|전기|수도|가스|통신|인터넷|보험|수리|택배|문구|비품|장비|미트|보호대|매트|청소|세탁|차량|주차|통행료|광고|현수막|구입|구매|샀|썼|지출|사용했|결제했|냈어|냈음|했어|했음|나갔/;
const QUERY_WORDS = /보여|알려|누구|얼마\s*벌|얼마나\s*벌|몇\s*명|현황|조회|확인해\s*줘|어때/;
HL.splitInput = (text, today) => {
  const segs = String(text || '').split(/\n|\s\/\s|^\/|\/$/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  let ctxDate = null;
  for (const s of segs) {
    const onlyDate = s.replace(/오늘|어제|그저께|그제|내일|\d{1,2}\s*월\s*\d{1,2}\s*일|\d{4}-\d{2}-\d{2}|에|는|은|기록|장부/g, '').trim() === '';
    if (onlyDate && HL.parseDate(s, today)) { ctxDate = HL.parseDate(s, today); continue; }
    out.push({ text: s, ctxDate });
  }
  return out;
};
HL.findNames = (text, members) => {
  const names = [...new Set(members.map((m) => m.name))].sort((a, b) => b.length - a.length);
  const hits = [];
  for (const n of names) { let i = text.indexOf(n); while (i >= 0) { if (!hits.some((h) => i < h.end && i + n.length > h.index)) hits.push({ name: n, index: i, end: i + n.length }); i = text.indexOf(n, i + 1); } }
  return hits.sort((a, b) => a.index - b.index);
};
HL.guessUnknownName = (text) => {
  const tokens = text.replace(/[,.!?]/g, ' ').split(/\s+/).filter(Boolean);
  for (const raw of tokens.slice(0, 2)) {
    const tok = raw.replace(/(이가|이는|이도|님이|님은|님|이|가|은|는|도)$/, '');
    if (/^[가-힣]{2,4}$/.test(tok) && !STOP.has(tok) && !STOP.has(raw) && !/[0-9]/.test(tok)) {
      if (/^(오늘|어제|이번|지난|다음)/.test(tok)) continue;
      return tok;
    }
  }
  return null;
};
HL.parseMonthRef = (t, today) => {
  if (/미납된|밀린|못\s*낸|안\s*낸|미납\s*회비|미납분/.test(t)) return { kind: 'unpaid' };
  const months = [];
  let mt;
  const re = /(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월(?!\s*\d{1,2}\s*일)/g;
  while ((mt = re.exec(t))) { const mo = Number(mt[2]); if (mo >= 1 && mo <= 12) months.push(mt[1] ? `${mt[1]}-${pad(mo)}` : HL.nearYm(mo, today)); }
  if (months.length) return { kind: 'months', months: [...new Set(months)] };
  const cnt = t.match(/(\d+|한|두|세|네|다섯|여섯)\s*(개월|달)\s*(치|분)?/);
  if (cnt && !/다음\s*달|지난\s*달|저번\s*달|이번\s*달/.test(cnt[0])) { const n = NUMW[cnt[1]] || Number(cnt[1]); if (n >= 1 && n <= 12) return { kind: 'count', count: n, prepay: /선납|미리/.test(t) }; }
  if (/다음\s*달/.test(t)) return { kind: 'months', months: [HL.addMonths(HL.ym(today), 1)] };
  if (/지난\s*달|저번\s*달/.test(t)) return { kind: 'months', months: [HL.addMonths(HL.ym(today), -1)] };
  if (/선납|미리/.test(t)) return { kind: 'prepay' };
  return { kind: 'current' };
};
HL.extractContent = (t) => t
  .replace(/(\d{4}-\d{2}-\d{2})|(\d{1,2}\s*월\s*\d{1,2}\s*일)|오늘|어제|그저께|그제|내일/g, ' ')
  .replace(/((?:\d[\d,]*(?:\.\d+)?\s*[만천백]?\s*)+)원?|만\s*원/g, ' ')
  .replace(/울산\s*페이|결제\s*선생|카드|계좌\s*이체|계좌|이체|현금|상품권/g, ' ')
  .replace(/(을|를|로|으로)?\s*(받았어요|받았어|받았음|받음|받았다|들어왔어|입금됐어|입금|했어요|했어|했음|했다|냈어요|냈어|냈음|썼어|썼음|샀어|샀음|결제했어|결제|지출했어|지출|나갔어|구입|구매|사용)\s*$/g, ' ')
  .replace(/\s+(에서|에|비용|값|대)\s*$/, ' ')
  .replace(/\s+/g, ' ').trim();
HL.mapMisc = (t) => { for (const [re, v] of HL.MISC_MAP) if (re.test(t)) return v; return null; };

HL.ruleParse = (seg, ctx) => {
  const t = seg.text;
  const today = ctx.today;
  const names = HL.findNames(t, ctx.members);
  const nameText = names.length ? names[0].name : HL.guessUnknownName(t);
  const amounts = HL.parseAmounts(t);
  const methodsFound = HL.parseMethods(t);
  const date = HL.parseDate(t, today) || seg.ctxDate || null;
  const base = { raw: t, nameText, date, dateExplicit: !!HL.parseDate(t, today) };
  // 결제수단별 금액 (카드 10만 계좌 6.5만)
  let methods = [];
  if (methodsFound.length >= 2) {
    for (const mf of methodsFound) {
      const a = amounts.find((x) => x.index >= mf.end && x.index - mf.end <= 3) || amounts.find((x) => x.end <= mf.index && mf.index - x.end <= 3);
      methods.push({ m: mf.m, a: a ? a.value : null, aText: a ? a.text : null });
    }
  } else if (methodsFound.length === 1) methods = [{ m: methodsFound[0].m }];
  const paired = new Set(methods.map((x) => x.aText && amounts.find((a) => a.text === x.aText)).filter(Boolean));
  const unpaired = amounts.filter((a) => !paired.has(a));
  let amountTotal = null, amountText = null;
  if (unpaired.length) { amountTotal = unpaired[0].value; amountText = unpaired[0].text; }
  else if (methods.length >= 2 && methods.every((x) => x.a != null)) { amountTotal = methods.reduce((s, x) => s + x.a, 0); amountText = methods.map((x) => x.aText).join(' + '); }
  base.amount = amountTotal; base.amountText = amountText; base.methods = methods;

  if (/결제일|결제\s*날짜/.test(t) && /(연장|미뤄|미루|늦춰|뒤로|바꿔|변경|로\s*해)/.test(t)) {
    const ext = t.match(/(\d+)\s*일\s*(만큼\s*)?(연장|미뤄|미루|늦춰|뒤로)/);
    const abs = t.match(/(\d+)\s*일\s*(결석|빠졌|못\s*나)/);
    const set = t.match(/결제\s*(일|날짜)[을를은는이가]?\s*(\d{1,2})\s*일\s*(로|으로)/);
    const reason = abs ? `${abs[1]}일 결석` : '';
    if (set) return { ...base, kind: 'payday', mode: 'set', payday: Number(set[2]), reason };
    const days = ext ? Number(ext[1]) : abs ? Number(abs[1]) : null;
    return { ...base, kind: 'payday', mode: 'extend', days, reason };
  }
  if (/휴원|쉬어|쉰대|쉰다|쉬기로|쉴게/.test(t)) return { ...base, kind: 'status', action: '휴원', date: date || today };
  if (/퇴관|그만\s*(둬|뒀|둔|다녀|다닌|나와)|그만뒀|그만둔|관뒀|관둔|안\s*다닌대|끊었/.test(t)) return { ...base, kind: 'status', action: '퇴관', date: date || today };
  if (/다시\s*(다녀|다닌|나와|나온|와|시작)|복귀|재등록|돌아와|돌아온/.test(t)) return { ...base, kind: 'status', action: '복귀', date: date || today };
  if (QUERY_WORDS.test(t) || (/\?$/.test(t) && /누구|얼마|몇|어디/.test(t))) {
    let query = 'unknown';
    if (/미납|안\s*낸|안냈|안\s*냈|밀린|못\s*낸/.test(t)) query = 'unpaid';
    else if (/올해|연간|1년|이번\s*해/.test(t) && /벌|수입|손익|얼마|매출|결산/.test(t)) query = 'year';
    else if (/장부|거래/.test(t)) query = 'ledger';
    else if (/결산|손익|수입|지출|벌|매출/.test(t)) query = 'month';
    else if (/회원|재원|몇\s*명/.test(t)) query = 'members';
    const mr = t.match(/(\d{1,2})\s*월/);
    let ym = HL.ym(today);
    if (mr) ym = HL.nearYm(Number(mr[1]), today); else if (/지난\s*달|저번\s*달/.test(t)) ym = HL.addMonths(ym, -1);
    return { ...base, kind: 'query', query, ym };
  }
  const feeLike = names.length && /냈|줬|입금|보냈|받았|받음/.test(t) && (/이번\s*달|지난\s*달|저번\s*달|다음\s*달|\d{1,2}\s*월|선납|미납|밀린/.test(t) || /만\s*(냈|줬|입금|보냈)/.test(t));
  if (/회비|수강료|원비/.test(t) || (/선납/.test(t) && nameText) || feeLike) {
    return { ...base, kind: 'fee', monthRef: HL.parseMonthRef(t, today), partial: /만\s*(냈|줬|받|입금|보냈)/.test(t) };
  }
  const misc = HL.mapMisc(t);
  if (misc) return { ...base, kind: 'misc', content: misc };
  const isIncomeVerb = /받았|받음|받았다|들어왔|입금|수입/.test(t);
  if (isIncomeVerb && !names.length) return { ...base, kind: 'misc', content: HL.extractContent(t) };
  if (EXPENSE_WORDS.test(t) && !names.length && !(nameText && /냈|줬/.test(t) && !/주유|기름|월세|관리비|구입|구매|샀|썼/.test(t))) return { ...base, kind: 'expense', content: HL.extractContent(t) };
  if (nameText && /냈|줬|입금|받았|받음|돈|보냈/.test(t)) return { ...base, kind: 'question' };
  return { ...base, kind: 'unknown' };
};

/* ───────── 의도 → 확인 카드 ───────── */
let cardSeq = 0;
const newCard = (type, f) => ({ cid: `c${Date.now().toString(36)}${(cardSeq++).toString(36)}`, type, sel: true, ...f });
HL.newCard = newCard;
HL.memberChoices = (nameText, members) => (nameText ? members.filter((m) => m.name === nameText) : []);
HL.resolveIntent = (it, ctx) => {
  const today = ctx.today;
  const date = it.date || today;
  const needMember = ['fee', 'status', 'payday', 'question'].includes(it.kind);
  let memberId = null, candidates = [];
  if (needMember) {
    candidates = HL.memberChoices(it.nameText, ctx.members);
    if (!candidates.length) return [newCard('newmember', { nameText: it.nameText || '', intent: it, raw: it.raw, sel: false })];
    if (candidates.length === 1) memberId = candidates[0].id;
  }
  const cands = candidates.map((m) => m.id);
  const base = { raw: it.raw, src: it.src || 'nl', aiAmountBad: !!it.amountBad };
  const methodsFrom = (amount, m) => {
    if (it.methods && it.methods.length >= 2) return it.methods.map((x) => ({ m: x.m, a: x.a }));
    const meth = it.methods && it.methods[0] ? it.methods[0].m : (m && m.payMethod ? m.payMethod : '');
    return [{ m: meth, a: amount }];
  };
  switch (it.kind) {
    case 'fee': {
      const m = memberId ? ctx.members.find((x) => x.id === memberId) : null;
      const ref = it.monthRef || { kind: 'current' };
      let months = [];
      let note = '';
      const cur = HL.ym(today);
      const firstOpen = (from) => {
        let ym = from;
        for (let i = 0; i < 24; i++) {
          if (m && m.skip && m.skip[ym]) { ym = HL.addMonths(ym, 1); continue; }
          const st = m && m.fees && m.fees[ym] ? HL.feeState(m, ym, ctx.idx, today) : null;
          if (st && (st.settled || st.cat === 'cancelled')) { ym = HL.addMonths(ym, 1); continue; }
          return ym;
        }
        return from;
      };
      if (ref.kind === 'unpaid') {
        const o = m ? HL.oldestUnpaidMonth(m, ctx) : null;
        if (o) months = [o]; else { months = [cur]; note = '미납된 회비가 없어서 이번 달로 채웠어요.'; }
      } else if (ref.kind === 'months') months = ref.months;
      else if (ref.kind === 'count') { let ym = firstOpen(ref.prepay ? HL.addMonths(cur, 1) : cur); for (let i = 0; i < ref.count; i++) { months.push(ym); ym = m ? HL.nextFeeMonth(m, ym) : HL.addMonths(ym, 1); } }
      else if (ref.kind === 'prepay') months = [firstOpen(HL.addMonths(cur, 1))];
      else months = [m && m.skip && m.skip[cur] ? HL.nextFeeMonth(m, cur) : cur];
      const cards = months.map((ym) => {
        let amount = null;
        const st = m ? HL.virtualFeeState(m, ym, ctx) : null;
        if (months.length === 1) amount = it.amount != null ? it.amount : (st && st.outstanding > 0 ? st.outstanding : (st && st.total) || null);
        else amount = st ? (st.outstanding > 0 ? st.outstanding : st.total) : null;
        let methods = methodsFrom(amount, m), tnote = '';
        if (m && !(it.methods && it.methods.length)) { const t = HL.payTemplate(m, ctx, amount); methods = t.methods; tnote = t.note; }
        return newCard('fee', { ...base, memberId, candidates: cands, nameText: it.nameText, feeMonth: ym, amount, methods, date, memo: '', remainder: null, dupChoice: null, note: [note, tnote].filter(Boolean).join(' ') });
      });
      if (months.length > 1 && it.amount != null) {
        const sum = cards.reduce((s, c) => s + (c.amount || 0), 0);
        if (sum !== it.amount) cards.forEach((c) => { c.amount = null; c.methods = methodsFrom(null, m); c.note = `입력한 금액 ${HL.fmt(it.amount)}원이 ${months.length}개월 합계 ${HL.fmt(sum)}원과 달라요. 달마다 금액을 확인해 주세요.`; });
        else cards[0].note = `${HL.fmt(it.amount)}원을 ${months.length}개월로 나눠 기록해요.`;
      }
      return cards;
    }
    case 'misc': return [newCard('misc', { ...base, content: it.content || '', amount: it.amount, methods: it.methods && it.methods.length ? methodsFrom(it.amount, null) : [{ m: '', a: it.amount }], date, memo: '', dupOk: false })];
    case 'expense': return [newCard('expense', { ...base, content: it.content || '', amount: it.amount, date, memo: '', dupOk: false })];
    case 'status': return [newCard('status', { ...base, memberId, candidates: cands, nameText: it.nameText, action: it.action, date, keepCurrentFee: null, famChoice: null, newPayday: it.action === '복귀' ? Math.min(Number(date.slice(8, 10)), 30) : null, reason: '' })];
    case 'payday': return [newCard('payday', { ...base, memberId, candidates: cands, nameText: it.nameText, mode: it.mode, days: it.days, setPayday: it.payday || null, confirm: null, manualPayday: null, reason: it.reason || '' })];
    case 'question': return [newCard('question', { ...base, memberId, candidates: cands, nameText: it.nameText, amount: it.amount, date, intent: it, sel: false })];
    default: return [newCard('unparsed', { ...base, sel: false })];
  }
};
/** 아직 없는 달(선납 등)도 계산할 수 있게 가상 회비 기록을 만든다 */
HL.virtualFeeState = (m, ym, ctx, opts) => {
  if (m.fees && m.fees[ym]) return HL.feeState(m, ym, ctx.idx, ctx.today, opts);
  if (!ctx.cfg || (ym < ctx.cfg.startMonth && !HL.TRACK_ALL_PAST)) return null;
  const fee = HL.feeSnapshot(m, ym, ctx);
  if (!fee.due) return null;
  return HL.feeState(m, ym, ctx.idx, ctx.today, { ...(opts || {}), fee });
};

/* ───────── 카드 검증 ───────── */
const posInt = (v) => Number.isInteger(Number(v)) && Number(v) > 0 && v !== '' && v != null;
HL.memberById = (ctx, id) => ctx.members.find((m) => m.id === id) || null;
HL.validateCard = (c, ctx) => {
  const E = {}, I = {};
  const today = ctx.today;
  const m = c.memberId ? HL.memberById(ctx, c.memberId) : null;
  const needDate = ['fee', 'misc', 'expense', 'status'].includes(c.type);
  if (needDate && !HL.isDate(c.date)) E.date = '날짜를 확인해 주세요.';
  const checkMethods = (required) => {
    const rows = c.methods || [];
    if (rows.length === 1) {
      if (required && !rows[0].m) E.methods = '결제방법을 선택해 주세요.';
      if (rows[0].m === '기타' ) E.methods = '기타 결제방법을 입력해 주세요.';
      return;
    }
    if (rows.some((r) => !r.m || r.m === '기타')) { E.methods = '결제방법을 선택해 주세요.'; return; }
    if (rows.some((r) => !posInt(r.a))) { E.methods = '결제수단별 금액을 입력해 주세요.'; return; }
    const sum = rows.reduce((s, r) => s + Number(r.a), 0);
    I.methodSum = sum;
    if (posInt(c.amount) && sum !== Number(c.amount)) E.methods = `결제수단별 합계 ${HL.fmt(sum)}원이 납부액 ${HL.fmt(c.amount)}원과 달라요.`;
  };
  switch (c.type) {
    case 'fee': {
      if (!m) { E.member = c.candidates && c.candidates.length > 1 ? `같은 이름이 ${c.candidates.length}명 있어요. 회원을 선택해 주세요.` : '회원을 선택해 주세요.'; }
      if (!HL.isYm(c.feeMonth)) E.feeMonth = '회비 월을 확인해 주세요.';
      const zeroOk = c.amount !== '' && c.amount != null && Number(c.amount) === 0 && c.type === 'fee';
      if (!posInt(c.amount) && !zeroOk) E.amount = '금액을 확인해 주세요. (0원 납부는 0을 입력)';
      if (c.aiAmountBad) E.amount = '금액을 확인해 주세요. (입력 문장에서 금액을 찾지 못했어요)';
      checkMethods(!zeroOk);
      if (!m || !HL.isYm(c.feeMonth)) break;
      const backfill = c.feeMonth < ctx.cfg.startMonth && !HL.TRACK_ALL_PAST && !(m.fees && m.fees[c.feeMonth] && !m.fees[c.feeMonth].cancelled);
      I.backfill = backfill;
      if (backfill) { I.lines = [`${HL.monthLabelFull(c.feeMonth)} 회비 · 장부 시작 전 기록이라 미납 추적은 하지 않아요.`]; break; }
      const exists = !!(m.fees && m.fees[c.feeMonth]);
      if (!exists) {
        const ex = HL.expectedFor(m, c.feeMonth, ctx.cfg, today);
        if (!m.payday) { E.feeMonth = '이 회원은 결제일이 없어요. 회원 정보에서 결제일을 먼저 정해 주세요.'; break; }
        if (!ex.expected && !(HL.TRACK_ALL_PAST && c.feeMonth < HL.ym(today) && ex.reason === '가입 전')) { E.feeMonth = `${HL.monthLabel(c.feeMonth)}은 회비 대상이 아니에요 (${ex.reason}).`; break; }
      } else if (m.fees[c.feeMonth].cancelled) { E.feeMonth = `${HL.monthLabel(c.feeMonth)} 회비 기록은 취소된 상태예요.`; break; }
      const st = HL.virtualFeeState(m, c.feeMonth, ctx, { excludeId: c.entryId });
      if (!st) { E.feeMonth = '회비 기록을 만들 수 없어요.'; break; }
      I.st = st; I.created = !exists;
      const lines = [];
      lines.push(`${HL.monthLabel(c.feeMonth)} 회비 · 결제일 ${HL.md(st.fee.due)}${st.due == null ? ' · 금액 미정' : ''}`);
      if (st.due != null) {
        lines.push(`회비 ${HL.fmt(st.base)}원${st.disc ? ` − 가족할인 ${HL.fmt(st.disc)}원` : ''}`);
        for (const cr of st.carries) lines.push(`+ ${HL.monthLabel(cr.from)} 이월 ${HL.fmt(cr.amount)}원`);
        lines.push(`청구 합계 ${HL.fmt(st.total)}원${st.paid ? ` · 이미 납부 ${HL.fmt(st.paid)}원` : ''}`);
      }
      I.lines = lines;
      I.prepaid = HL.isDate(c.date) && HL.ym(c.date) < c.feeMonth;
      if (st.settled && !c.dupChoice) {
        const last = st.pays[st.pays.length - 1];
        E.dup = `이미 ${HL.monthLabel(c.feeMonth)} 회비 ${HL.fmt(st.paid)}원 ${st.label}${last ? `(${HL.md(last.date)})` : ''}가 있습니다. 그래도 기록할까요?`;
        I.dup = true; I.dupNext = HL.nextFeeMonth(m, c.feeMonth);
      }
      if (st.due == null) { I.undecided = true; break; }
      const force = c.dupChoice === 'force';
      const outstanding = c.payFor === 'carry' ? st.carryRem : c.payFor === 'cur' ? st.curRem : st.outstanding;
      I.outstanding = outstanding;
      if (posInt(c.amount) || zeroOk) {
        const amtN = Number(c.amount), owe = Math.max(outstanding, 0);
        if (amtN > owe) {
          if (owe <= 0 && !force) { if (!E.dup) E.amount = '이미 모두 납부된 달이에요.'; }
          else {
            I.over = amtN - owe;
            const cands = []; let yy = c.feeMonth;
            for (let i = 0; i < 4; i++) { yy = HL.nextFeeMonth(m, yy); const sv = HL.virtualFeeState(m, yy, ctx, { excludeId: c.entryId }); if (sv && sv.due != null && sv.outstanding > 0) cands.push({ ym: yy, amount: sv.outstanding, st: sv }); }
            let left = I.over; const pre = [];
            for (const cd of cands) if ((c.prepayMonths || []).includes(cd.ym) && cd.amount <= left) { pre.push(cd); left -= cd.amount; }
            I.cands = cands; I.pre = pre; I.overLeft = left;
            if (left > 0 && !String(c.overReason || '').trim()) E.overReason = `${pre.length ? '선납으로 돌리고도' : `${c.payFor === 'carry' ? '이월분' : c.payFor === 'cur' ? '이번 달 회비' : '청구 합계'}보다`} ${HL.fmt(left)}원 많아요. 많이 낸 이유를 적어 주세요. (예: 형제 회비 같이 냄)`;
          }
        } else if (amtN < outstanding && !force) {
          I.partial = true; I.remainderAmount = outstanding - amtN;
          I.carryTo = HL.nextFeeMonth(m, c.feeMonth);
          if (!c.remainder) E.remainder = `남은 ${HL.fmt(I.remainderAmount)}원을 어떻게 할지 선택해 주세요.`;
        }
      }
      break;
    }
    case 'misc':
    case 'expense': {
      if (!c.content || !String(c.content).trim() || c.content === '기타') E.content = '내용을 입력해 주세요.';
      if (!posInt(c.amount)) E.amount = '금액을 확인해 주세요.';
      if (c.aiAmountBad) E.amount = '금액을 확인해 주세요. (입력 문장에서 금액을 찾지 못했어요)';
      if (c.type === 'misc') { checkMethods(false); if (c.guest) { if (!String(c.guestName || '').trim()) E.member = '비회원 이름(또는 내용)을 입력해 주세요.'; } else if (!c.memberId || !HL.memberById(ctx, c.memberId)) E.member = '어느 회원의 수입인지 선택해 주세요. (회원이 아니면 \'비회원\'을 체크)'; }
      if (!E.content && !E.amount && !E.date) {
        const dup = ctx.entries.find((e) => !e.cancelled && e.kind === c.type && e.date === c.date && Number(e.amount) === Number(c.amount) && String(e.content).trim() === String(c.content).trim() && (c.type !== 'misc' || !c.memberId || !e.memberId || e.memberId === c.memberId) && e.id !== c.entryId);
        if (dup && !c.dupOk) { E.dup = `같은 날 같은 내용(${dup.content} ${HL.fmt(dup.amount)}원)이 이미 있어요. 중복이 아니면 체크해 주세요.`; I.dup = true; }
        else if (dup) I.dup = true;
      }
      break;
    }
    case 'status': {
      if (!m) { E.member = c.candidates && c.candidates.length > 1 ? `같은 이름이 ${c.candidates.length}명 있어요. 회원을 선택해 주세요.` : '회원을 선택해 주세요.'; break; }
      if (!HL.isDate(c.date)) break;
      const eff = HL.statusEffect(m, c, ctx);
      I.eff = eff;
      if (eff.error) E.action = eff.error;
      if (eff.askRefunds) {
        const R = c.refunds || {};
        let firstFull = null;
        for (const a of eff.askRefunds) {
          const r = R[a.ym];
          if (!r || !r.mode) { E.refunds = `${HL.monthLabel(a.ym)} 회비를 환불할지 선택해 주세요.`; break; }
          if (r.mode === 'partial' && !(Number(r.amount) > 0 && Number(r.amount) <= a.paid)) { E.refunds = `${HL.monthLabel(a.ym)} 부분환불 금액을 1원~${HL.fmt(a.paid)}원 사이로 입력해 주세요.`; break; }
        }
      }
      if (eff.askFamily && !c.famChoice) E.famChoice = '가족 할인을 어떻게 할지 선택해 주세요.';
      if (c.action === '복귀' && !(Number(c.newPayday) >= 1 && Number(c.newPayday) <= 30)) E.newPayday = '새 결제일(1~30일)을 선택해 주세요.';
      break;
    }
    case 'payday': {
      if (!m) { E.member = c.candidates && c.candidates.length > 1 ? `같은 이름이 ${c.candidates.length}명 있어요. 회원을 선택해 주세요.` : '회원을 선택해 주세요.'; break; }
      if (!m.payday) { E.member = '이 회원은 결제일이 없어요. 회원 정보에서 결제일을 먼저 정해 주세요.'; break; }
      const eff = HL.paydayEffect(m, c, ctx);
      I.eff = eff;
      if (eff.error) E.days = eff.error;
      else if (c.confirm == null) E.confirm = `결제일이 ${eff.suggest}일 맞습니까?`;
      else if (c.confirm === 'no' && !(Number(c.manualPayday) >= 1 && Number(c.manualPayday) <= 30)) E.manualPayday = '결제일(1~30일)을 입력해 주세요.';
      if (eff.payError) E.days = eff.payError;
      break;
    }
    case 'question': E.question = `${c.nameText || ''} — 회비인가요, 잡수입인가요?`; break;
    case 'newmember': E.newmember = `명단에 없는 이름이에요${c.nameText ? ` (${c.nameText})` : ''}. 신규 등록할까요?`; break;
    case 'unparsed': E.unparsed = '어떤 기록인지 알 수 없어요. 종류를 골라 직접 입력해 주세요.'; break;
    default: break;
  }
  return { errors: E, info: I, ok: Object.keys(E).length === 0 };
};

/* ───────── 상태 변경 효과 (4-4) ───────── */
HL.paidPlan = (m, c, ctx, eff, d, word) => {
  const today = ctx.today;
  // 낸 돈이 있고 아직 끝나지 않은 달(진행 중이거나 앞으로의 달)은 환불/부분환불/유지를 고른다. 안 낸 청구는 묻지 않고 조용히 취소한다.
  const cycleEnd = (ym) => (m.payday ? HL.dueDate(HL.addMonths(ym, 1), m.payday) : ((m.fees[ym] && m.fees[ym].due) || ''));
  const asks = [];
  for (const ym of Object.keys(m.fees || {}).sort()) {
    const f = m.fees[ym];
    if (!f || f.cancelled) continue;
    const st = HL.feeState(m, ym, ctx.idx, today);
    if (st && st.paid > 0 && cycleEnd(ym) > d) asks.push({ ym, due: f.due, paid: st.paid });
  }
  if (asks.length) eff.askRefunds = asks;
  const R = c.refunds || {};
  const fullYms = asks.filter((a) => R[a.ym] && R[a.ym].mode === 'full').map((a) => a.ym);
  eff.refunds = [];
  for (const a of asks) {
    const r = R[a.ym];
    if (!r || !r.mode || r.mode === 'keep') continue;
    const amt = r.mode === 'full' ? a.paid : Number(r.amount) || 0;
    if (amt > 0) eff.refunds.push({ ym: a.ym, amount: amt, full: r.mode === 'full' });
  }
  const from = d; // 휴원 시작일 = 신청(입력)한 날짜
  eff.from = from;
  for (const ym of Object.keys(m.fees || {}).sort()) {
    const f = m.fees[ym];
    if (!f || f.cancelled) continue;
    if (fullYms.includes(ym)) { if (f.due >= from) eff.cancels.push({ ym, reason: `${word} 환불` }); continue; }
    if (cycleEnd(ym) > from) {
      const st = HL.feeState(m, ym, ctx.idx, today);
      if (st && st.paid === 0) eff.cancels.push({ ym, reason: word });
    }
  }
  eff.notes.push(word === '휴원' ? `휴원 시작일은 ${HL.md(eff.from)}로 기록해요. 그날부터 새 회비가 생기지 않아요. 안 낸 청구는 미납으로 남기지 않고 취소해요.` : `${HL.md(eff.from)}에 퇴관으로 기록해요. 안 낸 청구는 미납으로 남기지 않고 취소해요.`);
  for (const r of eff.refunds) eff.notes.push(`${HL.monthLabel(r.ym)} 회비 ${r.full ? '전액' : '일부'} ${HL.fmt(r.amount)}원을 환불로 기록해요(지출 장부에 남아요).`);
};
HL.statusEffect = (m, c, ctx) => {
  const today = ctx.today, d = c.date;
  const cur = HL.currentStatus(m, d);
  const planned = HL.plannedStatus(m, today);
  const eff = { ops: [], cancels: [], notes: [], from: d };
  const fam = m.familyId ? HL.familyMembers(ctx.members, m.familyId) : [];
  const othersActive = fam.filter((x) => x.id !== m.id && HL.isActiveStatus(HL.statusAt(x, d))); // 아직 가입일 전인 가족도 '남는 가족'으로 센다
  const famDoc = m.familyId ? (ctx.families || []).find((f) => f.id === m.familyId) : null;
  if (c.action === '휴원') {
    if (cur === '휴원' || (planned && planned.status === '휴원')) return { error: '이미 휴원(또는 휴원 예정)이에요.' };
    if (cur === '퇴관') return { error: '퇴관한 회원이에요. 다시 다니면 "복귀"로 기록해 주세요.' };
    if (!m.payday) { eff.from = d; eff.notes.push(`결제일이 없어 ${HL.md(d)}부터 휴원으로 기록해요.`); }
    else {
      HL.paidPlan(m, c, ctx, eff, d, '휴원');
    }
    if (m.familyId && othersActive.length === 1) eff.askFamily = { kind: 'hold', options: ['keep', 'stop', 'later'] };
  } else if (c.action === '퇴관') {
    if (cur === '퇴관') return { error: '이미 퇴관한 회원이에요.' };
    HL.paidPlan(m, c, ctx, eff, d, '퇴관');
    const owed = HL.overdueList(ctx).filter((x) => x.m.id === m.id);
    if (owed.length) eff.notes.push(`밀린 회비 ${owed.length}건 ${HL.fmt(owed.reduce((s, x) => s + x.st.outstanding, 0))}원은 미수로 계속 표시돼요.`);
    if (m.familyId) {
      if (othersActive.length === 1) { eff.famEnd = true; eff.notes.push('가족 중 재원이 1명만 남아 가족 할인이 끝나요.'); }
    }
  } else if (c.action === '복귀') {
    if (HL.isActiveStatus(cur) && !(planned && !HL.isActiveStatus(planned.status))) return { error: '이미 다니고 있는 회원이에요.' };
    if (HL.isActiveStatus(cur) && planned && !HL.isActiveStatus(planned.status)) {
      // 아직 시작 전인 휴원·퇴관 예정 → 예정만 없던 일로 하고, 그 때문에 취소된 청구를 되살린다
      eff.cancelPlanned = planned; eff.restore = [];
      for (const [ym, f] of Object.entries(m.fees || {})) if (f.cancelled && /^(휴원|퇴관)(?! 환불)/.test(f.cancelled.reason || '') && f.due >= planned.from) eff.restore.push(ym);
      eff.notes.push(`${HL.md(planned.from)}부터 ${planned.status} 예정이던 것을 취소해요.${eff.restore.length ? ` 취소됐던 ${eff.restore.map(HL.monthLabel).join(', ')} 회비 청구도 되살려요.` : ''} 결제일은 그대로예요.`);
      return eff;
    }
    eff.notes.push(`${HL.md(d)}부터 재원, 새 결제일 ${c.newPayday || '?'}일. 휴원 기간 회비는 만들지 않아요.`);
    if (famDoc && famDoc.decision && famDoc.decision !== 'auto') eff.famReset = true;
  } else return { error: '상태를 선택해 주세요.' };
  return eff;
};
HL.statusOps = (c, ctx) => {
  const m = HL.memberById(ctx, c.memberId);
  const eff = HL.statusEffect(m, c, ctx);
  const at = HL.nowIso(), by = ctx.by || '대표';
  const sid = c.opIds.s, hid = c.opIds.h;
  const newStatus = c.action === '복귀' ? '재원' : c.action;
  if (eff.cancelPlanned) {
    const up = { status: HL.currentStatus(m, ctx.today), statusLog: { [eff.cancelPlanned.id]: { void: true, voidAt: at } }, updatedAt: at,
      log: { [hid]: { at, by, type: '상태 변경', field: '회원 상태', before: `${eff.cancelPlanned.status} 예정 (${HL.md(eff.cancelPlanned.from)}부터)`, after: '예정 취소 (계속 다님)', reason: c.reason || '' } } };
    if (eff.restore.length) { up.fees = {}; for (const ym of eff.restore) up.fees[ym] = { cancelled: null }; }
    return [{ op: 'update', path: `members/${m.id}`, data: up }];
  }
  const upd = { status: newStatus, statusLog: { [sid]: { status: newStatus, from: eff.from, at } }, updatedAt: at,
    log: { [hid]: { at, by, type: '상태 변경', field: '회원 상태', before: HL.currentStatus(m, ctx.today), after: `${newStatus} (${HL.md(eff.from)}부터)`, reason: c.reason || '' } } };
  if (eff.cancels.length) {
    upd.fees = {};
    for (const x of eff.cancels) upd.fees[x.ym] = { cancelled: { at, by, reason: x.reason } };
  }
  const refundOps = (eff.refunds || []).map((r) => ({ op: 'entry', id: HL.uid('e'), entry: { kind: 'expense', date: c.date, amount: r.amount, content: `${m.name} ${HL.monthLabel(r.ym)} 회비 ${r.full ? '환불' : '부분환불'}`, methods: [], memo: c.action, by, src: 'status', raw: '', at, cancelled: null, memberId: m.id, memberName: m.name, refundFor: r.ym } }));
  if (c.action === '복귀') {
    upd.payday = Number(c.newPayday);
    upd.log[hid + 'p'] = { at, by, type: '결제일 변경', field: '결제일', before: m.payday, after: Number(c.newPayday), reason: '복귀' };
    // 복귀일 이후 결제일이 지난 달 건너뛰기 표시가 있으면 지운다
  }
  const ops = [{ op: 'update', path: `members/${m.id}`, data: upd }, ...refundOps];
  if (m.familyId) {
    let decision = null, why = '';
    if (eff.askFamily && c.famChoice) { decision = c.famChoice === 'later' ? 'pending' : c.famChoice === 'keep' ? (eff.askFamily.kind === 'leave' ? 'auto' : 'keep') : 'stop'; why = `${m.name} ${newStatus}`; }
    if (eff.famEnd || eff.famReset) { decision = 'auto'; why = `${m.name} ${newStatus}`; }
    if (decision) ops.push({ op: 'update', path: `families/${m.familyId}`, data: { decision, log: { [hid]: { at, by, type: '가족 할인', after: { auto: '자동', keep: '할인 유지', stop: '할인 종료', pending: '결정 대기(유지)' }[decision], reason: why } } } });
  }
  return ops;
};

/* ───────── 결제일 변경 (6장) ───────── */
HL.paydayEffect = (m, c, ctx) => {
  const today = ctx.today;
  const old = Number(m.payday);
  const eff = { old };
  if (c.mode === 'extend') {
    if (!(Number(c.days) >= 1 && Number(c.days) <= 60)) return { error: '연장할 일수를 입력해 주세요.', old };
    let s = old + Number(c.days);
    while (s > 30) s -= 30;
    eff.suggest = s;
  } else {
    if (!(Number(c.setPayday) >= 1 && Number(c.setPayday) <= 30)) return { error: '바꿀 결제일을 입력해 주세요.', old };
    eff.suggest = Number(c.setPayday);
  }
  const np = c.confirm === 'no' ? Number(c.manualPayday) : eff.suggest;
  eff.newPayday = np;
  // 적용할 주기: 이번 달 회비가 아직 안 끝났으면 이번 달, 끝났으면 다음 달
  let T = HL.ym(today);
  if (m.skip && m.skip[T]) T = HL.nextFeeMonth(m, T);
  const stT = m.fees && m.fees[T] ? HL.feeState(m, T, ctx.idx, today) : null;
  if (c.applyMonth != null && c.applyMonth !== '') T = HL.addMonths(HL.ym(today), Number(c.applyMonth));
  else if (stT && (stT.settled || stT.cat === 'cancelled')) T = HL.nextFeeMonth(m, T);
  const st = m.fees && m.fees[T] ? HL.feeState(m, T, ctx.idx, today) : null;
  eff.T = T;
  const oldDue = st ? st.fee.due : HL.dueDate(T, old);
  eff.oldDue = oldDue;
  if (!(np >= 1 && np <= 30)) return eff;
  const wrap = c.mode === 'extend' && np < old;
  eff.wrap = wrap;
  if (wrap) {
    if (st && st.paid > 0) { eff.payError = `${HL.monthLabel(T)} 회비에 이미 일부 납부가 있어요. 남은 금액을 먼저 처리해 주세요.`; return eff; }
    const N = HL.addMonths(T, 1);
    eff.newDue = HL.dueDate(N, np);
    eff.skipMonth = T;
    eff.text = `${HL.monthLabel(T)} 회비(결제일 ${HL.md(oldDue)})가 ${HL.monthLabel(N)}로 넘어가요 → ${HL.monthLabel(N)} 회비 결제일 ${HL.md(eff.newDue)}. 이후 결제일은 매달 ${np}일.`;
  } else {
    eff.newDue = HL.dueDate(T, np);
    eff.text = `${HL.monthLabel(T)} 회비 결제일 ${HL.md(oldDue)} → ${HL.md(eff.newDue)}. 이후 결제일은 매달 ${np}일.`;
    if (eff.newDue < today) eff.warn = '바뀐 결제일이 이미 지나서 바로 미납이 돼요.';
  }
  return eff;
};
HL.paydayOps = (c, ctx) => {
  const m = HL.memberById(ctx, c.memberId);
  const eff = HL.paydayEffect(m, c, ctx);
  const at = HL.nowIso(), by = ctx.by || '대표', hid = c.opIds.h;
  const upd = { payday: eff.newPayday, updatedAt: at, log: { [hid]: { at, by, type: '결제일 변경', field: '결제일', before: eff.old, after: eff.newPayday, days: c.mode === 'extend' ? Number(c.days) : null, reason: c.reason || '', detail: eff.text } } };
  if (eff.wrap) {
    upd.skip = { [eff.skipMonth]: { reason: `결제일 연장으로 ${HL.monthLabel(HL.addMonths(eff.skipMonth, 1))}로 넘어감`, at } };
    if (m.fees && m.fees[eff.skipMonth]) upd.fees = { [eff.skipMonth]: { cancelled: { at, by, reason: `결제일 연장 → ${HL.monthLabel(HL.addMonths(eff.skipMonth, 1))}` } } };
  } else if (m.fees && m.fees[eff.T]) upd.fees = { [eff.T]: { due: eff.newDue } };
  const after = eff.wrap ? HL.addMonths(eff.T, 1) : eff.T;
  for (const ym of Object.keys(m.fees || {}).sort()) {
    if (ym <= after || (m.fees[ym] || {}).cancelled) continue;
    const st = HL.feeState(m, ym, ctx.idx, ctx.today);
    if (st && st.paid === 0) { upd.fees = upd.fees || {}; upd.fees[ym] = { due: HL.dueDate(ym, eff.newPayday) }; }
  }
  return [{ op: 'update', path: `members/${m.id}`, data: upd }];
};

/* ───────── 카드 → 저장 작업 ───────── */
HL.ensureOpIds = (c) => { if (!c.opIds) c.opIds = { e: HL.uid('t'), s: HL.uid('s'), h: HL.uid('h') }; if (!c.entryId && ['fee', 'misc', 'expense'].includes(c.type)) c.entryId = c.opIds.e; return c; };
HL.cleanMethods = (c) => {
  const rows = (c.methods || []).filter((r) => r.m);
  if (rows.length === 1) return [{ m: rows[0].m, a: Number(c.amount) }];
  return rows.map((r) => ({ m: r.m, a: Number(r.a) }));
};
HL.cardOps = (c, ctx) => {
  HL.ensureOpIds(c);
  const at = HL.nowIso(), by = ctx.by || '대표';
  const v = HL.validateCard(c, ctx);
  const m = c.memberId ? HL.memberById(ctx, c.memberId) : null;
  const entryBase = { date: c.date, amount: Number(c.amount), memo: c.memo || '', by, src: c.src || 'nl', raw: c.raw || '', at, cancelled: null };
  switch (c.type) {
    case 'fee': {
      const ops = [];
      const I = v.info;
      if (!I.backfill && I.created) ops.push({ op: 'update', path: `members/${m.id}`, data: { fees: { [c.feeMonth]: I.st.fee } } });
      let remainder = null;
      if (I.partial && c.remainder) remainder = { action: c.remainder, amount: I.remainderAmount, carryTo: c.remainder === 'carry' ? I.carryTo : null };
      const pre = I.pre || [];
      const preSum = pre.reduce((t, x) => t + x.amount, 0);
      const mainAmt = Number(c.amount) - preSum;
      const rows = HL.cleanMethods(c).map((r) => ({ m: r.m, a: Number(r.a) }));
      const parts = [mainAmt, ...pre.map((x) => x.amount)].map((p) => { const out = []; let need = p; for (const r of rows) { if (need <= 0) break; const t = Math.min(r.a, need); if (t > 0) { out.push({ m: r.m, a: t }); r.a -= t; need -= t; } } return out; });
      const left = pre.length ? (I.overLeft || 0) : (I.over || 0);
      ops.push({ op: 'entry', id: c.entryId, entry: { ...entryBase, amount: mainAmt, kind: 'fee', memberId: m.id, memberName: m.name, feeMonth: c.feeMonth, content: `${c.feeMonth} 회비`, methods: pre.length ? parts[0] : HL.cleanMethods(c), remainder, payFor: c.payFor || null, prepaid: !!I.prepaid, backfill: !!I.backfill, dupForced: c.dupChoice === 'force', overReason: left ? String(c.overReason || '').trim() : null, overAmount: left || 0 } });
      c.opIds.pre = c.opIds.pre || {};
      pre.forEach((x, i) => {
        if (!(m.fees && m.fees[x.ym])) ops.push({ op: 'update', path: `members/${m.id}`, data: { fees: { [x.ym]: x.st.fee } } });
        const pid = c.opIds.pre[x.ym] || (c.opIds.pre[x.ym] = HL.uid('t'));
        ops.push({ op: 'entry', id: pid, entry: { ...entryBase, amount: x.amount, kind: 'fee', memberId: m.id, memberName: m.name, feeMonth: x.ym, content: `${x.ym} 회비`, methods: parts[i + 1], remainder: null, payFor: null, prepaid: true, backfill: false, dupForced: false, overReason: null, overAmount: 0 } });
      });
      return ops;
    }
    case 'misc': { const mm = HL.memberById(ctx, c.memberId); return [{ op: 'entry', id: c.entryId, entry: { ...entryBase, kind: 'misc', content: String(c.content).trim(), methods: HL.cleanMethods(c), memberId: c.guest ? null : (mm ? mm.id : null), memberName: c.guest ? String(c.guestName || '').trim() : (mm ? mm.name : (c.nameText || '')), ...(c.guest ? { guest: true } : {}) } }]; }
    case 'expense': return [{ op: 'entry', id: c.entryId, entry: { ...entryBase, kind: 'expense', content: String(c.content).trim(), methods: [] } }];
    case 'status': return HL.statusOps(c, ctx);
    case 'payday': return HL.paydayOps(c, ctx);
    default: return [];
  }
};
HL.cardTitle = (c, ctx) => {
  const m = c.memberId ? HL.memberById(ctx, c.memberId) : null;
  const nm = m ? m.name : (c.nameText || '');
  switch (c.type) {
    case 'fee': return `${nm} ${c.feeMonth ? HL.monthLabel(c.feeMonth) : ''} 회비`;
    case 'misc': return `잡수입 ${c.content || ''}`;
    case 'expense': return `지출 ${c.content || ''}`;
    case 'status': return `${nm} ${c.action}`;
    case 'payday': return `${nm} 결제일 변경`;
    default: return nm || '기록';
  }
};

/* ───────── 저장 작업 적용 (테스트·모의 저장용) ───────── */
HL.deepMerge = (target, src) => {
  const out = { ...(target || {}) };
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = HL.deepMerge(out[k], v);
    else out[k] = v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
  }
  return out;
};
HL.bucketFor = (date) => HL.ym(date || HL.today());

/* ───────── 컨텍스트 ───────── */
HL.makeCtx = (state, extra) => {
  const today = (extra && extra.today) || HL.today();
  const members = Object.values(state.members || {});
  const families = Object.values(state.families || {});
  const entries = HL.allEntries(Object.values(state.ledger || {}));
  const idx = HL.buildIndex(entries);
  return { today, members, families, entries, idx, cfg: state.config || null, by: (extra && extra.by) || '대표' };
};

/* ───────── 엑셀 가져오기 행 해석 ───────── */
HL.IMPORT_COLS = ['이름*', '출생연도*', '수련요일(예: 월,수,금)', '주 횟수', '정기결제일(1~30)', '현재 회비(원)', '결제방법', '회원상태', '가입일(YYYY-MM-DD)', '가족그룹(같은 가족은 같은 이름)', '가입비 납부(O/X)', '메모', '기존 특이사항(원본)', '성별(남/여)'];
HL.parseImportRow = (row, rowNo, ctx) => {
  const s = (v) => (v == null ? '' : (typeof v === 'object' && v.text ? v.text : v instanceof Date ? v.toISOString().slice(0, 10) : String(v))).trim();
  const [name, by, days, wc, pd, fee, pm, st, jd, fam, jf, memo, legacy, genderRaw] = row.map(s);
  if (![name, by, days, wc, pd, fee, pm, st, jd, fam, jf, memo, legacy].some(Boolean)) return null;
  const errors = [], review = {};
  if (!name) errors.push('이름이 없어요');
  let birthYear = null;
  const byN = Number(String(by).replace(/[^0-9]/g, ''));
  if (by && byN >= 1900 && byN <= 2100) birthYear = byN; else if (by && byN >= 0 && byN < 100) birthYear = byN + 2000 > Number(ctx.today.slice(0, 4)) ? byN + 1900 : byN + 2000;
  if (!birthYear) review.birthYear = '출생연도 확인 필요';
  const dayList = HL.DAYS.filter((d) => days.includes(d));
  let weeklyCount = null, weeklyCountOther = '';
  const wcN = Number(String(wc).replace(/[^0-9]/g, ''));
  if (wc && wcN >= 1 && wcN <= 7 && /^\s*(주\s*)?\d\s*(회)?\s*$/.test(wc)) weeklyCount = wcN;
  else if (!wc && dayList.length) weeklyCount = dayList.length;
  else if (wc) weeklyCountOther = wc;
  if (weeklyCount && dayList.length && dayList.length !== weeklyCount) review.weekly = `수련 횟수 확인 필요 (요일 ${dayList.length}개, 주 ${weeklyCount}회)`;
  let payday = null;
  const pdN = Number(String(pd).replace(/[^0-9]/g, ''));
  if (pd && pdN >= 1 && pdN <= 30) payday = pdN; else if (pd) errors.push(`정기결제일 "${pd}"은 1~30만 가능해요`);
  if (!payday) review.payday = '결제일 확인 필요';
  let feeMode = 'auto', customFee = null;
  const feeN = HL.parseAmount(fee);
  const tierNow = HL.feeTier({ birthYear, weeklyCount }, HL.ym(ctx.today));
  const tierPrice = tierNow ? HL.priceFor(ctx.cfg, HL.ym(ctx.today))[tierNow] : null;
  if (fee && feeN) { if (feeN !== tierPrice) { feeMode = 'custom'; customFee = feeN; } }
  else if (fee) errors.push(`현재 회비 "${fee}"를 읽을 수 없어요`);
  if (feeMode === 'auto' && !tierNow) review.weekly = '수련 횟수 확인 필요';
  let payMethod = '', payMethodOther = '';
  if (pm) { const hit = HL.METHODS.find((x) => x === pm || (x === HL.GIFT && /상품권/.test(pm)) || (x === '계좌이체' && /계좌|이체/.test(pm))); if (hit) payMethod = hit; else { payMethod = '기타'; payMethodOther = pm; } }
  let status = '재원';
  if (st) { if (HL.STATUSES.includes(st)) status = st; else errors.push(`회원상태 "${st}"는 재원/휴원/퇴관/신규만 가능해요`); } else review.status = '회원 상태 확인 필요 (재원으로 등록)';
  let joinDate = null;
  if (jd) { const d = HL.parseDate(jd.replace(/\./g, '-').replace(/\s/g, ''), ctx.today); if (d && HL.isDate(d)) joinDate = d; else errors.push(`가입일 "${jd}"을 읽을 수 없어요`); }
  else review.joinDate = '가입일 확인 필요';
  let joinFeePaid = null;
  if (jf) { if (/^o$/i.test(jf) || jf === '○') joinFeePaid = true; else if (/^x$/i.test(jf) || jf === '×') joinFeePaid = false; else errors.push(`가입비 납부 "${jf}"는 O/X만 가능해요`); }
  const legacyNote = [legacy, pm && payMethod === '기타' ? `(원본 결제방법: ${pm})` : ''].filter(Boolean).join(' ');
  const existing = name && birthYear ? ctx.members.find((x) => x.name === name && Number(x.birthYear) === birthYear) || null : null;
  if (!existing && name && ctx.members.some((x) => x.name === name)) review.dup = '같은 이름 회원이 이미 있어요 (출생연도 다름)';
  return { rowNo, errors, review, key: name && birthYear ? `${name}|${birthYear}` : null, existingId: existing ? existing.id : null, data: { name, gender: /^(남|m|male)/i.test(genderRaw || '') ? '남' : /^(여|f|female)/i.test(genderRaw || '') ? '여' : '', birthYear, days: dayList, weeklyCount, weeklyCountOther, payday, feeMode, customFee, payMethod, payMethodOther, status, joinDate, familyName: fam, joinFeePaid, memo, legacyNote } };
};
HL.newMemberDoc = (d, ctx, id) => {
  const at = HL.nowIso();
  const doc = {
    id, name: d.name, birthYear: d.birthYear || null, birthYearOther: d.birthYearOther || '', days: d.days || [], weeklyCount: d.weeklyCount || null, weeklyCountOther: d.weeklyCountOther || '',
    payday: d.payday || null, feeMode: d.feeMode || 'auto', customFee: d.customFee || null, customFeeMemo: d.customFeeMemo || '', customFees: {}, payMethod: d.payMethod || '', payMethodOther: d.payMethodOther || '',
    gender: d.gender === '남' || d.gender === '여' ? d.gender : '', familyId: d.familyId || null, joinDate: d.joinDate || null, joinFeePaid: !!d.joinFeePaid, status: d.status || '신규', memo: d.memo || '', legacyNote: d.legacyNote || '',
    origin: d.origin || (/엑셀/.test(d.source || '') ? 'import' : 'app'), importBatch: d.importBatch || null, review: Array.isArray(d.review) ? d.review : Object.values(d.review || {}), fees: {}, skip: {}, statusLog: { s0: { status: d.status || '신규', from: '0000-00-00', at } }, log: { h0: { at, by: ctx.by || '대표', type: '등록', after: d.source || '회원 등록' } }, createdAt: at, updatedAt: at,
  };
  if (d.status === '휴원' && d.joinDate) doc.statusLog.s0.from = '0000-00-00';
  return doc;
};
HL.reviewList = (m) => (Array.isArray(m.review) ? m.review : Object.values(m.review || {}));
/** 동명이인 구분 이름: 같은 이름이 있으면 "한채원(18년생)", 출생연도까지 같으면 결제일도 붙인다 */
HL.displayName = (m, members) => {
  if (!m) return '';
  const same = (members || []).filter((x) => x.id !== m.id && x.name === m.name);
  if (!same.length) return m.name;
  const yy = m.birthYear ? `${String(m.birthYear).slice(2)}년생` : '출생연도 미정';
  const sameYear = same.some((x) => x.birthYear === m.birthYear);
  return `${m.name}(${yy}${sameYear ? `·결제일 ${m.payday || '-'}일` : ''})`;
};
/** 회원 정보에서 생긴 "확인이 필요한" 사유 */
HL.memberIssues = (m, ctx) => {
  const out = [];
  const st = HL.currentStatus(m, ctx.today);
  if (st === '퇴관') return out;
  if (m.feeMode !== 'custom' && !HL.feeTier(m, HL.ym(ctx.today))) out.push('수련 횟수 확인 필요');
  if (m.feeMode === 'custom' && HL.customFeeAt(m, HL.ym(ctx.today)) == null) out.push('기타 수강료 금액 확인 필요');
  if (!m.payday) out.push('결제일 확인 필요');
  for (const v of HL.reviewList(m)) {
    if (v === '결제일 확인 필요' && m.payday) continue;
    if (v === '출생연도 확인 필요' && m.birthYear) continue;
    if (v === '수련 횟수 확인 필요' && (m.feeMode === 'custom' || HL.feeTier(m, HL.ym(ctx.today)))) continue;
    out.push(v);
  }
  return [...new Set(out)];
};

if (typeof module !== 'undefined' && module.exports) module.exports = HL;
root.HL = HL;
})(typeof globalThis !== 'undefined' ? globalThis : this);
// ==== HL 끝 ====
