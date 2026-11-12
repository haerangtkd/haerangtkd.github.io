// 해랑 장부 — 예전 claude.ai 아티팩트 장부 화면을 그대로 쓰기 위한 연결 (2026-11-12)
// window.claude.use('db' | 'downloads' | 'sample') 를 장부 서버(haerang-ledger)로 바꿔 준다.
// 로그인: 업무 앱 이름 + PIN. 관리자 = 'owner'(장부 전체), 다른 직원 = 'staff'(직원 입력만).
(function () {
  const API = (window.HAERANG_LEDGER_API || '').replace(/\/$/, '');
  const TK = 'haerang-ledger-tok';
  const LS = { get: k => { try { return localStorage.getItem(k) || ''; } catch (_) { return ''; } }, set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (_) {} } };
  let tok = LS.get(TK), since = 0, readable = [];
  const cache = {};                // 'members' -> { id: data }
  const subs = [];                 // { coll, id, cb, err }
  const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const merge = (a, b) => { const o = isObj(a) ? { ...a } : {}; for (const [k, v] of Object.entries(b || {})) o[k] = isObj(v) && isObj(o[k]) ? merge(o[k], v) : v; return o; };

  let readyRes; window.HL_READY = new Promise(r => { readyRes = r; });

  async function call(path, body) {
    let r;
    try { r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tok, ...body }) }); }
    catch (_) { throw { code: 'unavailable', message: '인터넷 연결을 확인해 주세요' }; }
    const j = await r.json().catch(() => ({ ok: false, error: '서버 응답을 읽지 못했어요' }));
    if (j.relogin) { logout(); throw { code: 'revoked', message: j.error }; }
    if (!j.ok) throw { code: j.code || 'unavailable', message: j.error };
    return j;
  }

  // ── 바뀐 것 받아오기 ──
  let syncing = null;
  function sync() { if (!syncing) syncing = doSync().finally(() => { syncing = null; }); return syncing; }
  async function doSync() {
    const j = await call('/api/sync', { since });
    readable = j.colls || readable;
    for (const c of ['config', 'members', 'families', 'ledger', 'pending', 'notes', 'ulsanpay', 'snapshots']) cache[c] = cache[c] || {};
    for (const d of j.docs) {
      const [c, id] = [d.path.slice(0, d.path.indexOf('/')), d.path.slice(d.path.indexOf('/') + 1)];
      if (d.data == null) delete cache[c][id]; else cache[c][id] = d.data;
      if (d.upd > since) since = d.upd;
    }
    fire();
  }
  function snapOf(c, id) { const v = cache[c] && cache[c][id]; return { id, exists: v !== undefined, data: () => clone(v), metadata: { fromCache: false } }; }
  function qsOf(c) { const o = cache[c] || {}; return { docs: Object.keys(o).map(id => ({ id, data: () => clone(o[id]) })), size: Object.keys(o).length, empty: !Object.keys(o).length, metadata: { fromCache: false } }; }
  function fire() { for (const s of subs) { try { s.cb(s.id ? snapOf(s.coll, s.id) : qsOf(s.coll)); } catch (e) { console.error(e); } } }
  setInterval(() => { if (tok && !document.hidden) sync().catch(() => {}); }, 20000);
  document.addEventListener('visibilitychange', () => { if (tok && !document.hidden) sync().catch(() => {}); });

  // ── 저장 ──
  async function write(op, path, data) {
    const j = await call('/api/write', { ops: [{ op, path, data: data == null ? undefined : clone(data) }] });
    const c = path.slice(0, path.indexOf('/')), id = path.slice(path.indexOf('/') + 1);
    cache[c] = cache[c] || {};
    if (op === 'delete') delete cache[c][id]; else cache[c][id] = op === 'update' ? merge(cache[c][id], data) : clone(data);
    fire(); sync().catch(() => {});
    return j;
  }
  function docRef(path) {
    const c = path.slice(0, path.indexOf('/')), id = path.slice(path.indexOf('/') + 1);
    return {
      id,
      get: async () => { if (readable.includes(c)) { await sync().catch(() => {}); return snapOf(c, id); } const j = await call('/api/get', { path }); return { id, exists: j.exists, data: () => clone(j.data), metadata: { fromCache: false } }; },
      set: d => write('set', path, d),
      update: d => write('update', path, d),
      delete: () => write('delete', path),
      onSnapshot: (cb, err) => { const s = { coll: c, id, cb, err }; subs.push(s); if (cache[c]) setTimeout(() => cb(snapOf(c, id)), 0); return () => subs.splice(subs.indexOf(s), 1); },
    };
  }
  const DB = {
    doc: docRef,
    collection: c => ({
      doc: id => docRef(c + '/' + id),
      get: async () => { await sync().catch(() => {}); return qsOf(c); },
      onSnapshot: (cb, err) => { const s = { coll: c, cb, err }; subs.push(s); if (cache[c]) setTimeout(() => cb(qsOf(c)), 0); return () => subs.splice(subs.indexOf(s), 1); },
    }),
  };
  const DL = {
    save: async ({ filename, data }) => {
      const blob = data instanceof Blob ? data : new Blob([data], { type: /\.json$/i.test(filename) ? 'application/json' : 'application/octet-stream' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      return true;
    },
  };

  function logout() { const t = tok; tok = ''; LS.set(TK, ''); if (t) fetch(API + '/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tok: t }) }).catch(() => {}); setTimeout(() => location.reload(), 50); }
  window.HL_LOGOUT = logout;

  async function start() {
    const j = await call('/api/me', {});
    window.HL_ROLE = j.role; window.HL_NAME = j.name;
    await sync();
    window.claude = { use: async n => (n === 'db' ? DB : n === 'downloads' ? DL : null) };
    readyRes();
  }

  // ── 로그인 화면 ──
  function loginScreen() {
    const box = document.createElement('div');
    box.id = 'hlLogin';
    box.setAttribute('style', 'position:fixed;inset:0;z-index:99;background:#fff;display:flex;align-items:center;justify-content:center;padding:24px;font:16px -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;color:#1d2433');
    box.innerHTML = '<div style="width:100%;max-width:340px;text-align:center"><img src="icon-192.png" alt="" style="width:72px;height:72px;border-radius:18px"><h1 style="font-size:22px;margin:14px 0 4px">해랑 장부</h1><p style="color:#667085;font-size:14px;margin:0 0 16px">이름을 고르고 업무 앱 PIN을 넣어 주세요</p><div id="hlWho" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:12px"></div><input id="hlPin" type="password" inputmode="numeric" maxlength="12" autocomplete="off" placeholder="PIN" style="width:100%;box-sizing:border-box;font-size:20px;padding:12px;border:1px solid #d0d5dd;border-radius:12px;text-align:center"><button id="hlGo" type="button" style="width:100%;margin-top:10px;padding:13px;border:0;border-radius:12px;background:#1E2A3A;color:#fff;font-size:16px;font-weight:700">들어가기</button><p id="hlMsg" style="color:#C0392B;font-size:14px;min-height:20px;margin:10px 0 0"></p><p style="color:#98a2b3;font-size:12.5px;margin-top:6px">관리자는 장부 전체, 다른 직원은 직원 입력(관리자 승인 후 반영)만 할 수 있어요.</p></div>';
    document.body.appendChild(box);
    const $ = id => document.getElementById(id);
    let who = '';
    fetch(API + '/api/members', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.json()).then(j => {
      if (!j.ok) { $('hlMsg').textContent = j.error || '직원 목록을 불러오지 못했어요'; return; }
      $('hlWho').innerHTML = j.members.map(m => '<button type="button" data-id="' + m.id + '" style="padding:10px 14px;border:1px solid #d0d5dd;border-radius:99px;background:#fff;font-size:15px">' + m.name.replace(/[<>&"]/g, '') + '</button>').join('');
    }).catch(() => { $('hlMsg').textContent = '인터넷 연결을 확인해 주세요'; });
    $('hlWho').onclick = e => { const b = e.target.closest('[data-id]'); if (!b) return; who = b.dataset.id; [...$('hlWho').children].forEach(x => { const on = x === b; x.style.background = on ? '#1E2A3A' : '#fff'; x.style.color = on ? '#fff' : ''; }); $('hlPin').focus(); };
    const go = async () => {
      $('hlMsg').textContent = '';
      if (!who) { $('hlMsg').textContent = '이름을 먼저 골라 주세요'; return; }
      const j = await fetch(API + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mid: who, pin: $('hlPin').value }) }).then(r => r.json()).catch(() => ({ ok: false, error: '인터넷 연결을 확인해 주세요' }));
      if (!j.ok) { $('hlMsg').textContent = j.error || 'PIN이 맞지 않아요'; $('hlPin').value = ''; return; }
      tok = j.tok; LS.set(TK, tok); box.remove();
      start().catch(e => { alertBox(e && e.message); });
    };
    $('hlGo').onclick = go; $('hlPin').onkeydown = e => { if (e.key === 'Enter') go(); };
  }
  function alertBox(t) { const d = document.createElement('div'); d.setAttribute('style', 'position:fixed;left:12px;right:12px;top:12px;z-index:100;background:#fee4e2;color:#912018;padding:12px;border-radius:12px'); d.textContent = t || '장부를 열지 못했어요'; document.body.appendChild(d); }

  if (!API) { document.addEventListener('DOMContentLoaded', () => alertBox('장부 서버 주소가 비어 있어요 (config.js)')); return; }
  const begin = () => { if (tok) start().catch(e => { if (!(e && e.code === 'revoked')) alertBox(e && e.message); }); else loginScreen(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin); else begin();
})();
