// 해랑 장부 — 예전 claude.ai 아티팩트 장부 화면을 그대로 쓰기 위한 연결 (2026-11-12)
// window.claude.use('db' | 'downloads' | 'sample') 를 장부 서버(haerang-ledger)로 바꿔 준다.
// 로그인: 폰에 처음 깔면 장부 비밀번호로 기기 등록(한 번) → 그 뒤 관리자는 열 때마다 PIN = 'owner'(장부 전체).
// '직원이에요' → 관리자가 허락한 직원이 PIN = 'staff'(회원 조회·입력, 관리자 승인 뒤 반영, 합계 없음).
(function () {
  const API = (window.HAERANG_LEDGER_API || '').replace(/\/$/, '');
  const TK = 'haerang-ledger-tok', DK = 'haerang-ledger-dev';
  const mk = st => ({ get: k => { try { return st.getItem(k) || ''; } catch (_) { return ''; } }, set: (k, v) => { try { v ? st.setItem(k, v) : st.removeItem(k); } catch (_) {} } });
  const LS = mk(window.localStorage), SS = mk(window.sessionStorage); // 기기 등록은 계속, 로그인은 이번에 연 동안만
  let tok = SS.get(TK), since = 0, readable = [];
  try { localStorage.removeItem(TK); } catch (_) {}
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

  function logout() { const t = tok; tok = ''; SS.set(TK, ''); if (t) fetch(API + '/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tok: t }) }).catch(() => {}); setTimeout(() => location.reload(), 50); }
  window.HL_LOGOUT = logout;

  async function start() {
    const j = await call('/api/me', {});
    window.HL_ROLE = j.role; window.HL_NAME = j.name;
    await sync();
    window.claude = { use: async n => (n === 'db' ? DB : n === 'downloads' ? DL : null) };
    readyRes();
    if (j.role === 'owner') addStaffButton();
  }
  // 화면을 3분 넘게 떠나 있으면 다시 PIN (보안)
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => { if (document.hidden) hiddenAt = Date.now(); else if (tok && hiddenAt && Date.now() - hiddenAt > 180000) logout(); });

  // ── 관리자: 직원 권한 (장부 '직원이에요'로 들어올 수 있는 사람) ──
  function addStaffButton() {
    const lock = document.getElementById('lockBtn'); if (!lock || document.getElementById('hlStaffBtn')) return;
    const b = document.createElement('button'); b.id = 'hlStaffBtn'; b.type = 'button'; b.textContent = '직원 권한'; b.style.marginRight = '6px';
    lock.parentNode.insertBefore(b, lock); b.onclick = staffPanel;
  }
  async function staffPanel() {
    const ov = document.createElement('div');
    ov.setAttribute('style', 'position:fixed;inset:0;z-index:98;background:rgba(0,0,0,.4);display:flex;align-items:flex-end;justify-content:center;font:15px -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif');
    ov.innerHTML = '<div style="background:#fff;color:#1d2433;width:100%;max-width:480px;border-radius:18px 18px 0 0;padding:18px 18px 28px;max-height:80vh;overflow:auto"><h3 style="margin:0 0 4px">직원 권한</h3><p style="margin:0 0 12px;color:#667085;font-size:13.5px">체크한 직원만 \'직원이에요\'로 장부에 들어와 회원 조회(이번 달 납부 여부)와 입력을 할 수 있어요. 입력은 관리자가 승인해야 반영되고, 합계·거래 목록은 안 보여요.</p><div id="hlSL">불러오는 중…</div><div style="display:flex;gap:8px;margin-top:14px"><button type="button" id="hlSX" style="flex:1;padding:12px;border:1px solid #d0d5dd;border-radius:10px;background:#fff">닫기</button><button type="button" id="hlSS" style="flex:1;padding:12px;border:0;border-radius:10px;background:#1E2A3A;color:#fff;font-weight:700">저장</button></div></div>';
    document.body.appendChild(ov);
    const q = id => ov.querySelector('#' + id);
    q('hlSX').onclick = () => ov.remove();
    const j = await fetch(API + '/api/members', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.json()).catch(() => ({ ok: false }));
    if (!j.ok) { q('hlSL').textContent = '직원 목록을 불러오지 못했어요'; return; }
    const cur = ((cache.config || {}).staff || {}).ids || [];
    q('hlSL').innerHTML = j.members.map(m => '<label style="display:flex;align-items:center;gap:10px;padding:10px 2px;border-bottom:1px solid #f1f2f5"><input type="checkbox" data-id="' + m.id + '"' + (m.boss ? ' checked disabled' : cur.includes(m.id) ? ' checked' : '') + ' style="width:20px;height:20px"><span>' + m.name.replace(/[<>&"]/g, '') + (m.boss ? ' <small style="color:#98a2b3">관리자</small>' : '') + '</span></label>').join('');
    q('hlSS').onclick = async () => {
      const ids = [...ov.querySelectorAll('input[data-id]:not([disabled])')].filter(x => x.checked).map(x => x.dataset.id);
      try { await write('set', 'config/staff', { ids, at: new Date().toISOString() }); ov.remove(); } catch (e) { alert((e && e.message) || '저장하지 못했어요'); }
    };
  }

  // ── 로그인 화면: 기기 등록(장부 비밀번호, 한 번) → 관리자 PIN / '직원이에요' → 직원 PIN ──
  function loginScreen(mode) {
    const old = document.getElementById('hlLogin'); if (old) old.remove();
    const dev = LS.get(DK);
    if (!mode) mode = dev ? 'owner' : 'device';
    const box = document.createElement('div'); box.id = 'hlLogin';
    box.setAttribute('style', 'position:fixed;inset:0;z-index:99;background:#fff;display:flex;align-items:center;justify-content:center;padding:24px;font:16px -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;color:#1d2433');
    const inp = 'width:100%;box-sizing:border-box;font-size:20px;padding:12px;border:1px solid #d0d5dd;border-radius:12px;text-align:center';
    const btn = 'width:100%;margin-top:10px;padding:13px;border:0;border-radius:12px;background:#1E2A3A;color:#fff;font-size:16px;font-weight:700';
    const link = 'margin-top:16px;background:none;border:0;color:#1E2A3A;text-decoration:underline;font-size:15px';
    const head = '<img src="icon-192.png" alt="" style="width:72px;height:72px;border-radius:18px"><h1 style="font-size:22px;margin:14px 0 4px">해랑 장부</h1>';
    let body;
    if (mode === 'device') body = '<p style="color:#667085;font-size:14px;margin:0 0 16px">이 기기에서 처음 열어요.<br>장부 비밀번호를 한 번만 넣어 주세요.</p><input id="hlPw" type="password" autocomplete="off" placeholder="장부 비밀번호" style="' + inp + '"><button id="hlGo" type="button" style="' + btn + '">이 기기 등록하기</button><p id="hlMsg" style="color:#C0392B;font-size:14px;min-height:20px;margin:10px 0 0"></p><button id="hlSw" type="button" style="' + link + '">직원이에요</button>';
    else body = '<p style="color:#667085;font-size:14px;margin:0 0 16px">' + (mode === 'owner' ? '관리자 이름을 고르고 PIN을 넣어 주세요' : '직원 · 이름을 고르고 업무 앱 PIN을 넣어 주세요') + '</p><div id="hlWho" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:12px"></div><input id="hlPin" type="password" inputmode="numeric" maxlength="12" autocomplete="off" placeholder="PIN" style="' + inp + '"><button id="hlGo" type="button" style="' + btn + '">들어가기</button><p id="hlMsg" style="color:#C0392B;font-size:14px;min-height:20px;margin:10px 0 0"></p><button id="hlSw" type="button" style="' + link + '">' + (mode === 'owner' ? '직원이에요' : '관리자예요') + '</button>';
    box.innerHTML = '<div style="width:100%;max-width:340px;text-align:center">' + head + body + '</div>';
    document.body.appendChild(box);
    const $ = id => document.getElementById(id), msg = t => { $('hlMsg').textContent = t || ''; };
    $('hlSw').onclick = () => loginScreen(mode === 'staff' ? (dev ? 'owner' : 'device') : 'staff');
    if (mode === 'device') {
      const go = async () => {
        msg('');
        const j = await fetch(API + '/api/device', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pw: $('hlPw').value }) }).then(r => r.json()).catch(() => ({ ok: false, error: '인터넷 연결을 확인해 주세요' }));
        if (!j.ok) { msg(j.error || '장부 비밀번호가 맞지 않아요'); $('hlPw').value = ''; return; }
        LS.set(DK, j.dev); loginScreen('owner');
      };
      $('hlGo').onclick = go; $('hlPw').onkeydown = e => { if (e.key === 'Enter') go(); };
      return;
    }
    let who = '';
    fetch(API + '/api/members', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.json()).then(j => {
      if (!j.ok) { msg(j.error || '직원 목록을 불러오지 못했어요'); return; }
      const list = mode === 'owner' ? j.members.filter(m => m.boss) : j.members;
      $('hlWho').innerHTML = list.map(m => '<button type="button" data-id="' + m.id + '" style="padding:10px 14px;border:1px solid #d0d5dd;border-radius:99px;background:#fff;font-size:15px">' + m.name.replace(/[<>&"]/g, '') + '</button>').join('');
    }).catch(() => msg('인터넷 연결을 확인해 주세요'));
    $('hlWho').onclick = e => { const b = e.target.closest('[data-id]'); if (!b) return; who = b.dataset.id; [...$('hlWho').children].forEach(x => { const on = x === b; x.style.background = on ? '#1E2A3A' : '#fff'; x.style.color = on ? '#fff' : ''; }); $('hlPin').focus(); };
    const go = async () => {
      msg('');
      if (!who) { msg('이름을 먼저 골라 주세요'); return; }
      const j = await fetch(API + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mid: who, pin: $('hlPin').value, as: mode, dev }) }).then(r => r.json()).catch(() => ({ ok: false, error: '인터넷 연결을 확인해 주세요' }));
      if (!j.ok) { if (j.device) { LS.set(DK, ''); return loginScreen('device'); } msg(j.error || 'PIN이 맞지 않아요'); $('hlPin').value = ''; return; }
      tok = j.tok; SS.set(TK, tok); box.remove();
      start().catch(e => { alertBox(e && e.message); });
    };
    $('hlGo').onclick = go; $('hlPin').onkeydown = e => { if (e.key === 'Enter') go(); };
  }
  function alertBox(t) { const d = document.createElement('div'); d.setAttribute('style', 'position:fixed;left:12px;right:12px;top:12px;z-index:100;background:#fee4e2;color:#912018;padding:12px;border-radius:12px'); d.textContent = t || '장부를 열지 못했어요'; document.body.appendChild(d); }

  if (!API) { document.addEventListener('DOMContentLoaded', () => alertBox('장부 서버 주소가 비어 있어요 (config.js)')); return; }
  const begin = () => { if (tok) start().catch(e => { if (!(e && e.code === 'revoked')) alertBox(e && e.message); }); else loginScreen(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin); else begin();
})();
