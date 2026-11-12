// 해랑 장부 서버 (haerang-ledger) — 2026-11-12
// 필요한 설정(바인딩): D1 DB → haerang-ledger, Service TEAM → haerang-team, Service NOTICE → haerang-push(관리자 비밀번호 확인)
// 기기 등록: 폰에 처음 깔면 관리자 비밀번호(알림 앱 ADMIN_PASSWORD, 알림 서버가 확인) 한 번 → 이 기기에서 관리자가 PIN으로 장부 전체를 열 수 있음.
// 로그인은 열 때마다 PIN (12시간 지나면 다시). 관리자(boss) = 장부 전체(등록된 기기에서만), '직원이에요' = 관리자가 허락한 직원만, 직원 화면(회원 조회·입력 → 관리자 승인).
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
    return json(r.ok ? { ok: true, members: (r.members || []).filter(m => !m.shared).map(m => ({ id: m.id, name: m.name, boss: !!m.boss })) } : r);
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
      const allow = J((await one(env, "SELECT data FROM docs WHERE path = 'config/staff' AND del = 0") || {}).data, {}) || {};
      if (!r.boss && !(Array.isArray(allow.ids) && allow.ids.includes(r.id))) return json({ ok: false, error: '아직 장부 사용을 허락받지 않았어요. 관리자에게 말해 주세요' }, 403);
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
  return json({ ok: false, error: '없는 주소' }, 404);
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
