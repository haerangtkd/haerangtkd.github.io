// 해랑경희 알림 서버 (Cloudflare Workers 무료 요금제 + D1 데이터베이스)
// 앱 3개가 이 서버 하나를 같이 씁니다
//   학부모용  /notice/            관리용  /notice/admin.html      출결 태블릿  /notice/kiosk.html
// ─────────────────────────────────────────────
// 필요한 설정 (Cloudflare 대시보드 → 이 Worker → 설정 → 바인딩)
//   1) D1 데이터베이스 바인딩: 변수 이름 DB
//   2) 비밀 변수(Secret): ADMIN_PASSWORD  ← 관장님 비밀번호
// 표(테이블)와 푸시 서명 키는 처음 실행될 때 자동으로 만듭니다.
// ─────────────────────────────────────────────

const SITE = 'https://haerangtkd.github.io';
const BATCH = 40;               // 무료 요금제 외부 요청 한도(50) 안에서 한 번에 보낼 기기 수
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
];
let ready = false;
async function setup(env) {
  if (ready) return;
  await env.DB.batch(SCHEMA.map(s => env.DB.prepare(s)));
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

async function route(path, req, env) {
  const b = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

  // ═════════ 누구나 ═════════
  if (path === '/vapid') return json({ ok: true, publicKey: (await getVapid(env)).publicKey });
  if (path === '/notices') return json({ ok: true, notices: await listPosts(env, 'notice', null, 50) });

  // ═════════ 학부모용 ═════════
  if (path === '/join' && req.method === 'POST') {
    // 가입 또는 정보 수정. token 이 있으면 그 보호자 정보를 고침
    const kids = cleanNames(b.children);
    const rel = RELATIONS.includes(b.relation) ? b.relation : '';
    const ph = String(b.phone4 || '').replace(/\D/g, '');
    if (!kids.length || !rel || ph.length !== 4) return json({ ok: false, error: '아이 이름, 관계, 전화번호 뒷자리를 확인해 주세요' }, 400);
    const sub = b.subscription && b.subscription.endpoint && /^https:\/\//.test(b.subscription.endpoint) && b.subscription.keys ? b.subscription : null;
    let p = b.token ? await one(env, 'SELECT * FROM parents WHERE tok = ?', String(b.token)) : null;
    if (p) {
      const same = p.rel === rel && p.ph === ph && sameList(J(p.kids, []), kids);
      await run(env, 'UPDATE parents SET kids = ?, rel = ?, ph = ?, ok = ?, ep = COALESCE(?, ep), p256 = COALESCE(?, p256), auth = COALESCE(?, auth) WHERE id = ?',
        JSON.stringify(kids), rel, ph, same ? p.ok : 0, sub ? sub.endpoint : null, sub ? sub.keys.p256dh : null, sub ? sub.keys.auth : null, p.id);
      return json({ ok: true, token: p.tok, approved: !!(same && p.ok) });
    }
    if (sub) await run(env, 'DELETE FROM parents WHERE ep = ?', sub.endpoint); // 같은 휴대폰의 예전 등록 정리
    const id = rid(8), tok = rid(16);
    await run(env, 'INSERT INTO parents (id, tok, kids, rel, ph, ok, created, ep, p256, auth) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)',
      id, tok, JSON.stringify(kids), rel, ph, Date.now(), sub ? sub.endpoint : null, sub ? sub.keys.p256dh : null, sub ? sub.keys.auth : null);
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
    if (path === '/p/leave') { await run(env, 'DELETE FROM parents WHERE id = ?', p.id); return json({ ok: true }); }
    if (path === '/p/schedule') return json({ ok: true, me, items: await listSchedule(env, b.month) });
    if (path === '/p/notices') return json({ ok: true, me, items: await listPosts(env, 'notice', null, 100) });
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
        const fees = await all(env, 'SELECT name, paid FROM fees WHERE month = ?', fm);
        out.fee = { month: fm, kids: myKids.map(k => ({ name: k, paid: !!(fees.find(f => f.name === k) || {}).paid })) };
      }
      return json(out);
    }
    // 여기부터는 관장님 승인 후에만
    if (!p.ok) return json({ ok: false, error: '관장님 승인 후에 볼 수 있습니다', pending: true, me });
    if (path === '/p/journal') return json({ ok: true, me, items: await listPosts(env, 'journal', myKids, 100) });
    if (path === '/p/albums') return json({ ok: true, me, items: await listPosts(env, 'album', myKids, 60) });
    if (path === '/p/photo') return photo(env, b.id, b.size);
    if (path === '/p/attendance') {
      const m = /^\d{4}-\d{2}$/.test(b.month || '') ? b.month : kstDay(new Date()).slice(0, 7);
      const rows = await all(env, 'SELECT day, name, tin, tout FROM att WHERE day LIKE ? ORDER BY day', m + '-%');
      return json({ ok: true, me, month: m, items: rows.filter(r => myKids.includes(r.name)).map(r => ({ day: r.day, name: r.name, in: r.tin, out: r.tout })) });
    }
    if (path === '/p/fees') {
      const rows = await all(env, 'SELECT month, name, paid, at FROM fees ORDER BY month DESC LIMIT 200');
      return json({ ok: true, me, status: rows.filter(r => myKids.includes(r.name)), items: await listPosts(env, 'fee', myKids, 50) });
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
      const kids = (await all(env, 'SELECT name, codes FROM kids')).filter(k => J(k.codes, []).includes(code)).map(k => k.name).sort((a, c) => a.localeCompare(c, 'ko'));
      const att = await all(env, 'SELECT name, tin, tout FROM att WHERE day = ?', today);
      return json({ ok: true, kids: kids.map(n => { const a = att.find(x => x.name === n) || {}; return { name: n, in: a.tin || null, out: a.tout || null }; }) });
    }
    if (path === '/kiosk/check') return json(await checkIn(env, b.name, b.act));
  }

  // ═════════ 관장님 전용 ═════════
  if (path.startsWith('/admin/')) {
    const ip = req.headers.get('cf-connecting-ip') || 'x';
    const f = await one(env, 'SELECT n, until FROM fails WHERE ip = ?', ip);
    if (f && f.until > Date.now()) return json({ ok: false, error: '비밀번호를 여러 번 틀려 15분 동안 잠겼습니다' }, 429);
    if (!env.ADMIN_PASSWORD || !(await sameText(b.password || '', env.ADMIN_PASSWORD))) {
      const n = (f && f.until <= Date.now() && f.n >= 10 ? 0 : (f ? f.n : 0)) + 1;  // 비밀번호 10번 틀리면 15분 잠금
      await run(env, 'INSERT INTO fails (ip, n, until) VALUES (?, ?, ?) ON CONFLICT(ip) DO UPDATE SET n = excluded.n, until = excluded.until', ip, n, n >= 10 ? Date.now() + 15 * 60000 : 0);
      return json({ ok: false, error: '비밀번호가 맞지 않습니다' }, 401);
    }
    if (f) await run(env, 'DELETE FROM fails WHERE ip = ?', ip);

    if (path === '/admin/status') {
      const today = kstDay(new Date());
      const parents = await all(env, 'SELECT id, kids, rel, ph, ok, created, ep FROM parents ORDER BY created DESC');
      const kids = await all(env, 'SELECT name, codes FROM kids');
      const att = await all(env, 'SELECT name, tin, tout FROM att WHERE day = ?', today);
      const list = kids.map(k => k.name).sort((a, c) => a.localeCompare(c, 'ko')).map(n => {
        const k = kids.find(x => x.name === n), a = att.find(x => x.name === n);
        return {
          name: n, codes: J(k.codes, []), today: a ? { in: a.tin, out: a.tout } : {},
          guardians: parents.filter(p => p.ok && J(p.kids, []).includes(n)).map(p => ({ id: p.id, rel: p.rel, ph: p.ph, push: !!p.ep })),
        };
      });
      const pending = parents.filter(p => !p.ok).map(p => ({ id: p.id, children: J(p.kids, []), rel: p.rel, ph: p.ph, at: p.created }));
      return json({ ok: true, devices: parents.filter(p => p.ep).length, kids: list, pending });
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
    if (path === '/admin/remove-device') { await run(env, 'DELETE FROM parents WHERE id = ?', String(b.id || '')); return json({ ok: true }); }
    if (path === '/admin/kid-save') {
      const name = cleanNames([b.name])[0];
      const codes = [...new Set((Array.isArray(b.codes) ? b.codes : []).map(c => String(c).replace(/\D/g, '')).filter(c => c.length === 4))].slice(0, 6);
      if (!name) return json({ ok: false, error: '이름을 확인해 주세요' });
      if (b.oldName && b.oldName !== name) {
        if (await one(env, 'SELECT name FROM kids WHERE name = ?', name)) return json({ ok: false, error: '같은 이름이 이미 명단에 있습니다' });
        await env.DB.batch([
          q(env, 'UPDATE kids SET name = ? WHERE name = ?', name, b.oldName),
          q(env, 'UPDATE att SET name = ? WHERE name = ?', name, b.oldName),
          q(env, 'UPDATE fees SET name = ? WHERE name = ?', name, b.oldName),
        ]);
        for (const p of await all(env, 'SELECT id, kids FROM parents')) {
          const ks = J(p.kids, []);
          if (ks.includes(b.oldName)) await run(env, 'UPDATE parents SET kids = ? WHERE id = ?', JSON.stringify([...new Set(ks.map(k => (k === b.oldName ? name : k)))]), p.id);
        }
      }
      await run(env, 'INSERT INTO kids (name, codes, created) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET codes = excluded.codes', name, JSON.stringify(codes), Date.now());
      return json({ ok: true });
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
      const r = await run(env, 'INSERT INTO posts (type, kind, title, body, date, target, photos, pin, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        type, String(b.kind || '').slice(0, 10), title, String(b.body || '').slice(0, 3000), date, JSON.stringify(target), JSON.stringify(photos), b.pin ? 1 : 0, Date.now());
      return json({ ok: true, id: r.meta && r.meta.last_row_id });
    }
    if (path === '/admin/post-delete') {
      const p = await one(env, 'SELECT photos FROM posts WHERE id = ?', b.id | 0);
      if (p) for (const ph of J(p.photos, [])) await run(env, 'DELETE FROM photos WHERE id = ?', ph);
      await run(env, 'DELETE FROM posts WHERE id = ?', b.id | 0);
      return json({ ok: true });
    }
    if (path === '/admin/posts') {
      const type = POST_TYPES.includes(b.type) ? b.type : 'notice';
      if (type === 'schedule') return json({ ok: true, items: await listSchedule(env, b.month) });
      return json({ ok: true, items: await listPosts(env, type, null, 100, true) });
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
    .map(r => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, date: r.date, target: J(r.target, []), photos: J(r.photos, []), pin: !!r.pin, at: r.created }));
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
async function checkIn(env, name, act) {
  if (act !== 'in' && act !== 'out') return { ok: false, error: 'act' };
  if (!(await one(env, 'SELECT name FROM kids WHERE name = ?', String(name || '')))) return { ok: false, error: '명단에 없는 아이입니다' };
  const now = new Date(), t = kstTime(now), day = kstDay(now);
  if (act === 'in') await run(env, 'INSERT INTO att (day, name, tin, tout) VALUES (?, ?, ?, NULL) ON CONFLICT(day, name) DO UPDATE SET tin = excluded.tin, tout = NULL', day, name, t);
  else await run(env, 'INSERT INTO att (day, name, tin, tout) VALUES (?, ?, NULL, ?) ON CONFLICT(day, name) DO UPDATE SET tout = excluded.tout', day, name, t);
  const body = act === 'in' ? name + ' 학생이 ' + t + '에 도장에 도착했습니다.' : name + ' 학생이 ' + t + '에 수련을 마치고 하원했습니다.';
  const r = await send(env, { kind: act === 'in' ? '등원' : '하원', title: (act === 'in' ? '등원 알림' : '하원 알림') + ' · ' + name, body, children: [name], view: 'attendance' });
  return { ok: true, time: t, sent: r.sent || 0, total: r.total || 0 };
}
function kst(d) { return new Date(d.getTime() + 9 * 3600 * 1000); }
function kstDay(d) { return kst(d).toISOString().slice(0, 10); }
function kstTime(d) { const k = kst(d); const h = k.getUTCHours(), m = k.getUTCMinutes(); return (h < 12 ? '오전 ' : '오후 ') + ((h % 12) || 12) + '시' + (m ? ' ' + m + '분' : ''); }

// ─────────── 푸시 발송 ───────────
// children 이 비어 있으면 전체, 있으면 그 아이의 승인된 보호자에게만. 관리 화면이 offset 을 늘려 가며 나눠 부릅니다.
async function send(env, b) {
  const title = String(b.title || '').slice(0, 100).trim();
  const body = String(b.body || '').slice(0, 300).trim();
  if (!title) return { ok: false, error: '제목이 비어 있습니다' };
  const targets = cleanNames(b.children);
  const offset = Math.max(0, b.offset | 0);
  let subs = await all(env, 'SELECT id, kids, ok, ep, p256, auth FROM parents WHERE ep IS NOT NULL ORDER BY id');
  if (targets.length) subs = subs.filter(s => s.ok && J(s.kids, []).some(c => targets.includes(c)));
  const total = subs.length;
  const slice = subs.slice(offset, offset + BATCH);
  const vapid = await getVapid(env);
  const view = /^[a-z]+$/.test(b.view || '') ? b.view : '';
  const payload = JSON.stringify({ title, body, kind: String(b.kind || ''), url: SITE + '/notice/' + (view ? '#' + view : ''), tag: (b.tag || view || 'n') + '-' + Date.now() });

  let sent = 0, failed = 0, removed = 0;
  await Promise.all(slice.map(async s => {
    try {
      const res = await webPush({ endpoint: s.ep, p256dh: s.p256, auth: s.auth }, payload, vapid);
      if (res.status === 404 || res.status === 410) { await run(env, 'UPDATE parents SET ep = NULL WHERE id = ?', s.id); removed++; }
      else if (res.ok) sent++;
      else failed++;
    } catch (e) { failed++; }
  }));
  const nextAt = offset + slice.length - removed;   // 만료된 기기가 빠지면 뒤 순서가 당겨짐
  return { ok: true, total, sent, failed, removed, next: nextAt < total - removed ? nextAt : null };
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

async function webPush(sub, text, vapid) {
  const body = await encryptPayload(sub.p256dh, sub.auth, text);
  return fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL: '86400',
      Urgency: 'high',
      Authorization: await vapidHeader(sub.endpoint, vapid),
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
