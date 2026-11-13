// 해랑 장부 — 예전 claude.ai 아티팩트 장부 화면을 그대로 쓰기 위한 연결 (2026-11-12)
// window.claude.use('db' | 'downloads' | 'sample') 를 장부 서버(haerang-ledger)로 바꿔 준다.
// 로그인: 폰에 처음 깔면 관리자 비밀번호(알림 앱 ADMIN_PASSWORD)로 기기 등록(한 번) → 그 뒤 관리자는 열 때마다 PIN = 'owner'(장부 전체).
// '직원이에요' → 업무 앱 직원 수정에서 '장부 직원 입력'을 켠 직원이 PIN = 'staff'(회원 조회·입력, 관리자 승인 뒤 반영, 합계 없음).
(function () {
  const API = (window.HAERANG_LEDGER_API || '').replace(/\/$/, '');
  const TK = 'haerang-ledger-tok', DK = 'haerang-ledger-dev', WK = 'haerang-ledger-who'; // WK: 이 기기에서 고른 이름 (로그아웃 전까지 기억, 2026-11-13)
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
  window.HL_CALL = (path, body) => call(path, body || {}); // 장부 서버의 다른 기능 (예: 5일 회비 안내 미리 보기)
  window.HL_FORGET = () => { LS.set(DK, ''); LS.set(WK, ''); logout(); }; // 로그아웃: 이 기기 등록·고른 이름도 풀기

  async function start() {
    const j = await call('/api/me', {});
    window.HL_ROLE = j.role; window.HL_NAME = j.name;
    await sync();
    window.claude = { use: async n => (n === 'db' ? DB : n === 'downloads' ? DL : null) };
    readyRes();
  }
  // 화면을 3분 넘게 떠나 있으면 다시 PIN (보안)
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => { if (document.hidden) hiddenAt = Date.now(); else if (tok && hiddenAt && Date.now() - hiddenAt > 180000) logout(); });

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
    if (mode === 'device') body = '<p style="color:#667085;font-size:14px;margin:0 0 16px">이 기기에서 처음 열어요.<br>관리자 비밀번호(알림 관리에서 쓰던 비밀번호)를<br>한 번만 넣어 주세요.</p><input id="hlPw" type="password" autocomplete="off" placeholder="관리자 비밀번호" style="' + inp + '"><button id="hlGo" type="button" style="' + btn + '">이 기기 등록하기</button><p id="hlMsg" style="color:#C0392B;font-size:14px;min-height:20px;margin:10px 0 0"></p><button id="hlSw" type="button" style="' + link + '">직원이에요</button>';
    else body = '<p style="color:#667085;font-size:14px;margin:0 0 16px">' + (mode === 'owner' ? '관리자 이름을 고르고 PIN을 넣어 주세요' : '직원 · 이름을 고르고 업무 앱 PIN을 넣어 주세요') + '</p><div id="hlWho" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:12px"></div><input id="hlPin" type="password" inputmode="numeric" maxlength="12" autocomplete="off" placeholder="PIN" style="' + inp + '"><button id="hlGo" type="button" style="' + btn + '">들어가기</button><p id="hlMsg" style="color:#C0392B;font-size:14px;min-height:20px;margin:10px 0 0"></p><button id="hlSw" type="button" style="' + link + '">' + (mode === 'owner' ? '직원이에요' : '관리자예요') + '</button>';
    box.innerHTML = '<div style="width:100%;max-width:340px;text-align:center">' + head + body + '</div>';
    document.body.appendChild(box);
    const $ = id => document.getElementById(id), msg = t => { $('hlMsg').textContent = t || ''; };
    $('hlSw').onclick = () => loginScreen(mode === 'staff' ? (dev ? 'owner' : 'device') : 'staff');
    if (mode === 'device') {
      const go = async () => {
        msg('');
        const j = await fetch(API + '/api/device', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pw: $('hlPw').value }) }).then(r => r.json()).catch(() => ({ ok: false, error: '인터넷 연결을 확인해 주세요' }));
        if (!j.ok) { msg(j.error || '관리자 비밀번호가 맞지 않아요'); $('hlPw').value = ''; return; }
        LS.set(DK, j.dev); loginScreen('owner');
      };
      $('hlGo').onclick = go; $('hlPw').onkeydown = e => { if (e.key === 'Enter') go(); };
      return;
    }
    let who = '';
    fetch(API + '/api/members', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.json()).then(j => {
      if (!j.ok) { msg(j.error || '직원 목록을 불러오지 못했어요'); return; }
      const list = mode === 'owner' ? j.members.filter(m => m.boss) : j.members.filter(m => m.boss || m.ledger);
      const chip = (m, on) => '<button type="button" data-id="' + m.id + '" style="padding:10px 14px;border:1px solid ' + (on ? '#1E2A3A' : '#d0d5dd') + ';border-radius:99px;background:' + (on ? '#1E2A3A;color:#fff' : '#fff') + ';font-size:15px">' + m.name.replace(/[<>&"]/g, '') + '</button>';
      const saved = (() => { try { return JSON.parse(LS.get(WK) || '{}')[mode] || ''; } catch (_) { return ''; } })(), pick = list.find(m => m.id === saved);
      if (pick) { who = pick.id; $('hlWho').innerHTML = chip(pick, true) + '<button type="button" data-other="1" style="padding:10px 6px;border:0;background:none;color:#667085;font-size:14px;text-decoration:underline">다른 이름</button>'; setTimeout(() => $('hlPin').focus(), 50); } // 고른 이름은 그대로, PIN만
      else $('hlWho').innerHTML = list.map(m => chip(m, false)).join('');
      $('hlWho').dataset.all = JSON.stringify(list.map(m => ({ id: m.id, name: m.name })));
    }).catch(() => msg('인터넷 연결을 확인해 주세요'));
    $('hlWho').onclick = e => { if (e.target.closest('[data-other]')) { who = ''; const l = JSON.parse($('hlWho').dataset.all || '[]'); $('hlWho').innerHTML = l.map(m => '<button type="button" data-id="' + m.id + '" style="padding:10px 14px;border:1px solid #d0d5dd;border-radius:99px;background:#fff;font-size:15px">' + String(m.name).replace(/[<>&"]/g, '') + '</button>').join(''); return; }
      const b = e.target.closest('[data-id]'); if (!b) return; who = b.dataset.id; [...$('hlWho').children].forEach(x => { const on = x === b; x.style.background = on ? '#1E2A3A' : '#fff'; x.style.color = on ? '#fff' : ''; }); $('hlPin').focus(); };
    const go = async () => {
      msg('');
      if (!who) { msg('이름을 먼저 골라 주세요'); return; }
      const j = await fetch(API + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mid: who, pin: $('hlPin').value, as: mode, dev }) }).then(r => r.json()).catch(() => ({ ok: false, error: '인터넷 연결을 확인해 주세요' }));
      if (!j.ok) { if (j.device) { LS.set(DK, ''); return loginScreen('device'); } msg(j.error || 'PIN이 맞지 않아요'); $('hlPin').value = ''; return; }
      tok = j.tok; SS.set(TK, tok); box.remove();
      try { const w = JSON.parse(LS.get(WK) || '{}'); w[mode] = who; LS.set(WK, JSON.stringify(w)); } catch (_) {}
      start().catch(e => { alertBox(e && e.message); });
    };
    $('hlGo').onclick = go; $('hlPin').onkeydown = e => { if (e.key === 'Enter') go(); };
  }
  function alertBox(t) { const d = document.createElement('div'); d.setAttribute('style', 'position:fixed;left:12px;right:12px;top:12px;z-index:100;background:#fee4e2;color:#912018;padding:12px;border-radius:12px'); d.textContent = t || '장부를 열지 못했어요'; document.body.appendChild(d); }

  if (!API) { document.addEventListener('DOMContentLoaded', () => alertBox('장부 서버 주소가 비어 있어요 (config.js)')); return; }
  const begin = () => { if (tok) start().catch(e => { if (!(e && e.code === 'revoked')) alertBox(e && e.message); }); else loginScreen(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin); else begin();
})();
