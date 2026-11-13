// 해랑 출석부 서버 (Cloudflare Workers 무료 요금제 + D1 데이터베이스)
// 화면: https://haerangtkd.github.io/attendance/
// ─────────────────────────────────────────────
// 필요한 설정 (Cloudflare 대시보드 → 이 Worker → 설정)
//   1) D1 데이터베이스 바인딩: 변수 이름 DB  (출석부 전용 데이터베이스 haerang-att)
//   2) 비밀 변수(Secret) ADMIN_PASSWORD : 관장님 비밀번호 — 맨 처음 설정(첫 사범님 만들기)에만 씀
//   3) 비밀 변수(Secret) SYNC_KEY       : 알림 서버와 같은 값 — 태블릿 등원 연동, 명단 비교에 씀
//   4) (선택) 서비스 바인딩 NOTICE → haerang-push : 학부모님께 출석 보내기에 씀
// 표(테이블)는 처음 실행될 때 자동으로 만듭니다.
// ─────────────────────────────────────────────

// 틀린 횟수 잠금은 아래 failAdd (5번마다 1분·2분·3분…)
const SESSION_DAYS = 180; // 이 기간 동안 한 번도 안 열면 다시 PIN
const PERIODS = [['2', 14 * 60], ['3', 15 * 60], ['4', 16 * 60], ['5', 17 * 60], ['6', 18 * 60 + 40], ['8', 20 * 60], ['9', 21 * 60]];

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS teachers (id TEXT PRIMARY KEY, name TEXT, salt TEXT, pin TEXT, created INTEGER)',
  'CREATE TABLE IF NOT EXISTS sessions (tok TEXT PRIMARY KEY, tid TEXT, created INTEGER)',
  'CREATE TABLE IF NOT EXISTS students (id TEXT PRIMARY KEY, data TEXT, upd INTEGER)',
  'CREATE TABLE IF NOT EXISTS att (day TEXT, sid TEXT, r TEXT, p TEXT, w TEXT, mk INTEGER DEFAULT 0, who TEXT, at INTEGER, PRIMARY KEY (day, sid))',
  'CREATE TABLE IF NOT EXISTS absences (sid TEXT, date TEXT, why TEXT, PRIMARY KEY (sid, date))',
  'CREATE TABLE IF NOT EXISTS trials (id TEXT PRIMARY KEY, data TEXT, upd INTEGER)',
  'CREATE TABLE IF NOT EXISTS history (id TEXT PRIMARY KEY, sid TEXT, tid TEXT, at INTEGER, text TEXT, who TEXT)',
  'CREATE INDEX IF NOT EXISTS history_sid ON history (sid)',
  'CREATE TABLE IF NOT EXISTS closed (day TEXT PRIMARY KEY, why TEXT)',
  'CREATE TABLE IF NOT EXISTS fails (ip TEXT PRIMARY KEY, n INTEGER, until INTEGER)',
  'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)', // dlpin: 내려받기 비밀번호 (명단·출결·백업 파일)
];
let ready = false;
async function setup(env) {
  if (ready) return;
  await env.DB.batch(SCHEMA.map(s => env.DB.prepare(s)));
  try { await env.DB.prepare('ALTER TABLE att ADD COLUMN tin TEXT').run(); } catch (_) {} // 태블릿 등원 시각
  try { await env.DB.prepare('ALTER TABLE fails ADD COLUMN at INTEGER').run(); } catch (_) {} // 마지막으로 틀린 때 (잠금 시간 늘리기용)
  ready = true;
  try { await env.DB.prepare('ALTER TABLE teachers ADD COLUMN boss INTEGER DEFAULT 0').run(); } catch (_) {} // 업무 앱 관리자 (2026-11-13: 퇴관 원생은 관리자만)
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
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const cleanP = p => [...new Set(String(p || '').split('/').map(x => x.replace(/[^0-9]/g, '')).filter(Boolean))].sort((a, b) => a - b).join('/');

async function route(path, req, env) {
  // 서버끼리 부르는 길(/sync/)은 서비스 바인딩으로만 — 바깥(workers.dev 주소)에서 오면 주소 이름이 'attendance'가 아니라서 막힘 (2026-11-13 보안 보강)
  if (path.startsWith('/sync/') && new URL(req.url).hostname !== 'attendance') return json({ ok: false, error: 'not found' }, 404);
  const b = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const ip = req.headers.get('cf-connecting-ip') || 'x';

  // ═════════ 알림 서버 연동 (서비스 바인딩으로만 부름) ═════════
  if (path.startsWith('/sync/')) {
    if (!env.SYNC_KEY || !(await sameText(req.headers.get('X-Sync-Key') || '', env.SYNC_KEY))) return json({ ok: false, error: 'sync key' }, 401);
    if (path === '/sync/roster') {
      const list = (await all(env, 'SELECT id, data FROM students')).map(r => ({ id: r.id, ...J(r.data, {}) }))
        .filter(s => s.name && (b.all || s.status !== '퇴관')) // all: 퇴관까지 (알림 앱 알림 멈춤·기네스 회원 상태용)
        .map(s => ({ id: s.id, name: s.name, no: s.no || '', status: s.status || '재원', birth: s.birth || '', ...(b.phones ? { phones: [s.phone, s.phone2].map(v => String(v || '').replace(/\D/g, '')).filter(Boolean) } : {}), ...(b.fam ? { famId: s.famId || '' } : {}) })); // id: 다른 앱이 이름이 바뀌어도 같은 원생으로 알아봄 (2026-11-13)
      return json({ ok: true, students: list });
    }
    if (path === '/sync/day-absent') { // 업무 앱 등원표: 그날 결석(출석부 '결석' + 미리 연락 온 결석 예정)
      const day = isDay(b.day) ? b.day : kstDay();
      const names = new Map((await all(env, 'SELECT id, data FROM students')).map(r => [r.id, J(r.data, {}).name]));
      const x = await all(env, "SELECT sid FROM att WHERE day = ? AND r = 'x'", day), ab = await all(env, 'SELECT sid FROM absences WHERE date = ?', day);
      return json({ ok: true, names: [...new Set([...x, ...ab].map(r => names.get(r.sid)).filter(Boolean))] });
    }
    // 업무 앱 '원생' 메뉴: 명단 보기·등록·회원 상태·임시변경 (출석부와 같은 원생 기록을 씀)
    if (path === '/sync/students') {
      const rows = await all(env, 'SELECT id, data, upd FROM students');
      const day = kstDay(), att = await all(env, "SELECT sid, r FROM att WHERE day = ? AND r IN ('o', 'x')", day), ab = await all(env, 'SELECT sid FROM absences WHERE date = ?', day);
      const here = att.filter(r => r.r === 'o').map(r => r.sid), absent = [...new Set([...att.filter(r => r.r === 'x'), ...ab].map(r => r.sid))].filter(id => !here.includes(id)); // 결석 = 출석부 '결석' + 미리 연락 온 결석 (2026-11-13)
      return json({ ok: true, day, students: rows.map(r => ({ id: r.id, upd: r.upd, ...J(r.data, {}) })), here, absent });
    }
    if (path === '/sync/student-save') {
      const cur = b.student && b.student.id ? await one(env, 'SELECT upd, data FROM students WHERE id = ?', str(b.student.id, 60)) : null;
      if (cur && b.upd && cur.upd !== b.upd) return json({ ok: false, error: '다른 곳에서 먼저 바뀌었어요. 새로 불러온 뒤 다시 해 주세요', stale: true });
      if (cur && b.noRevive && J(cur.data, {}).status === '퇴관' && (b.student || {}).status !== '퇴관') return json({ ok: false, error: '퇴관한 제자를 다시 바꾸는 건 관리자만 할 수 있어요' });
      return json(await saveStudentRow(env, b, str(b.who, 20) || '업무 앱'));
    }
    if (path === '/sync/kid-today') { // 업무 앱 보호자 하원 알림: 오늘 그 제자가 들은 마지막 수업 시작 + 45분 (50분 수업, 끝나기 5분 전)
      const day = isDay(b.day) ? b.day : kstDay(), name = str(b.name, 20).replace(/\s+/g, '');
      const st = (await all(env, 'SELECT id, data FROM students')).map(r => ({ id: r.id, ...J(r.data, {}) })).find(x => x.name === name && x.status !== '퇴관');
      if (!st) return json({ ok: false, error: '출석부에 없는 이름' });
      const a = await one(env, 'SELECT r, p, tin FROM att WHERE day = ? AND sid = ?', day, st.id);
      if (!a || a.r !== 'o') return json({ ok: true, alertAt: null });
      let ps = String(a.p || '').split('/').filter(Boolean);
      if (!ps.length && a.tin) { const [h, mi] = a.tin.split(':').map(Number); const pf = periodFor(h * 60 + mi); if (pf) ps = [pf]; }
      const starts = ps.map(p => (PERIODS.find(x => x[0] === p) || [])[1]).filter(x => x != null); if (!starts.length) return json({ ok: true, alertAt: null });
      const t = Math.max(...starts) + 45;
      return json({ ok: true, alertAt: String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0') });
    }
    if (path === '/sync/closed') return json({ ok: true, closed: !!(await one(env, 'SELECT day FROM closed WHERE day = ?', isDay(b.day) ? b.day : kstDay())) });
    if (path === '/sync/dlpin-set') { // 업무 앱 이사범님이 정함
      const pin = String(b.pin || ''); if (!/^\d{4,8}$/.test(pin)) return json({ ok: false, error: '숫자 4~8자리로 정해 주세요' });
      const salt = rid(8); await run(env, "INSERT INTO kv (k, v) VALUES ('dlpin', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", JSON.stringify({ salt, h: await pinHash(salt, pin) }));
      return json({ ok: true });
    }
    if (path === '/sync/export') return json({ ok: true, backup: await exportAll(env) }); // 업무 앱 '한 파일 백업' (관리자 비밀번호는 업무 서버가 먼저 확인)
    if (path === '/sync/dlpin-check') return json(await dlCheck(env, b.pin, 'team:' + str(b.who, 20)));
    if (path === '/sync/history') return json({ ok: true, items: await all(env, 'SELECT id, sid, tid, at, text, who FROM history WHERE sid = ? ORDER BY at DESC LIMIT 100', str(b.sid, 60)) });
    if (path === '/sync/teachers') { // 업무 앱: 사범님 이름·PIN(암호화된 값)을 그대로 가져가 같은 PIN으로 로그인
      return json({ ok: true, teachers: await all(env, 'SELECT id, name, salt, pin FROM teachers ORDER BY created') });
    }
    if (path === '/sync/checkin') {
      const name = str(b.name, 30).replace(/\s+/g, '');
      const at = Number(b.at) || Date.now();
      const st = (await all(env, 'SELECT id, data FROM students')).map(r => ({ id: r.id, ...J(r.data, {}) }))
        .filter(s => (s.name || '').replace(/\s+/g, '') === name && s.status !== '퇴관');
      if (!st.length) return json({ ok: false, error: '출석부에 없는 이름' });
      const k = new Date(at + 9 * 3600e3), day = k.toISOString().slice(0, 10), min = k.getUTCHours() * 60 + k.getUTCMinutes();
      const per = periodFor(min);
      const s = st[0];
      const tin = String(k.getUTCHours()).padStart(2, '0') + ':' + String(k.getUTCMinutes()).padStart(2, '0');
      const cur = await one(env, 'SELECT r, p FROM att WHERE day = ? AND sid = ?', day, s.id);
      if (cur && cur.r === 'x') { // 사범님이 결석으로 해 둔 아이는 바꾸지 않고 태블릿 시각만 남김 → 출석부에 '기록 다름'으로 표시
        await run(env, 'UPDATE att SET tin = ? WHERE day = ? AND sid = ?', tin, day, s.id);
        return json({ ok: true, day, period: per, mismatch: true });
      }
      const p = cleanP([cur && cur.p, per].filter(Boolean).join('/'));
      await run(env, "INSERT INTO att (day, sid, r, p, w, mk, who, at, tin) VALUES (?, ?, 'o', ?, '', 0, '태블릿', ?, ?) ON CONFLICT(day, sid) DO UPDATE SET r = 'o', p = excluded.p, w = '', who = '태블릿', at = excluded.at, tin = excluded.tin", day, s.id, p, Date.now(), tin);
      return json({ ok: true, day, period: per });
    }
    if (path === '/sync/absence') { // 업무 앱 채팅 '#등원 ○○ 결석' → 결석 예정
      const st = (await all(env, 'SELECT id, data FROM students')).map(r => ({ id: r.id, ...J(r.data, {}) })).filter(s => s.status !== '퇴관');
      const out = [];
      for (const it of (Array.isArray(b.items) ? b.items : []).slice(0, 10)) {
        const s = st.find(x => x.name === str(it.name, 20).replace(/\s+/g, '')); if (!s || !isDay(it.date)) continue;
        await run(env, 'INSERT INTO absences (sid, date, why) VALUES (?, ?, ?) ON CONFLICT(sid, date) DO UPDATE SET why = excluded.why', s.id, it.date, str(it.why || '연락옴', 40));
        out.push(s.name);
      }
      return json({ ok: true, added: out });
    }
    if (path === '/sync/fam-set') { // 업무 앱: 형제·자매 묶기/풀기 {sids, famId}
      const ids = (Array.isArray(b.sids) ? b.sids : []).slice(0, 10).map(x => str(x, 60)), fam = str(b.famId, 40), now = Date.now(), st = [];
      for (const id of ids) {
        const r = await one(env, 'SELECT data FROM students WHERE id = ?', id); if (!r) continue;
        const d = J(r.data, {}); if ((d.famId || '') === fam) continue; d.famId = fam;
        st.push(q(env, 'UPDATE students SET data = ?, upd = ? WHERE id = ?', JSON.stringify(d), now, id));
        st.push(q(env, 'INSERT INTO history (id, sid, tid, at, text, who) VALUES (?, ?, ?, ?, ?, ?)', crypto.randomUUID(), id, '', now, fam ? '형제·자매 묶음' : '형제·자매 묶음 풀기', str(b.who, 20) || '업무 앱'));
      }
      if (st.length) await env.DB.batch(st);
      return json({ ok: true });
    }
    if (path === '/sync/staff-gone') { // 업무 앱에서 직원을 지우면 출석부 로그인도 끝
      const tid = 'm:' + str(b.mid, 40);
      await env.DB.batch([q(env, 'DELETE FROM sessions WHERE tid = ?', tid), q(env, 'DELETE FROM teachers WHERE id = ?', tid)]);
      return json({ ok: true });
    }
    if (path === '/sync/absence-clear') { // 업무 앱 픽업표에서 결석을 취소하면, 픽업표가 넣은 결석 예정만 지움 (2026-11-13)
      const st = (await all(env, 'SELECT id, data FROM students')).map(r => ({ id: r.id, ...J(r.data, {}) }));
      const out = [];
      for (const it of (Array.isArray(b.items) ? b.items : []).slice(0, 10)) {
        const s = st.find(x => x.name === str(it.name, 20).replace(/\s+/g, '')); if (!s || !isDay(it.date)) continue;
        const r = await run(env, "DELETE FROM absences WHERE sid = ? AND date = ? AND why = '픽업표 결석'", s.id, it.date);
        if (r && r.meta && r.meta.changes) out.push(s.name);
      }
      return json({ ok: true, removed: out });
    }
    return json({ ok: false, error: 'not found' }, 404);
  }

  if (!path.startsWith('/api/')) return json({ ok: true, app: '해랑 출석부' });

  // ═════════ 로그인 전 ═════════
  if (path === '/api/teachers') { // 업무 앱 직원 (공용 계정 빼고). 업무 앱에 못 닿으면 예전 출석부 사범님
    const r = await noticeCall(env, '/sync/staff-members', {});
    if (r.ok && Array.isArray(r.members)) return json({ ok: true, teachers: r.members.filter(m => !m.shared).map(m => ({ id: 'm:' + m.id, name: m.name })), needSetup: false, team: true });
    const t = await all(env, 'SELECT id, name FROM teachers ORDER BY created');
    return json({ ok: true, teachers: t, needSetup: !t.length });
  }
  if (path === '/api/setup') { // 처음 한 번: 관장님 비밀번호 + 첫 사범님
    if ((await one(env, 'SELECT COUNT(*) AS n FROM teachers')).n) return json({ ok: false, error: '이미 설정되어 있습니다' });
    const e = await checkAdmin(env, ip, b.password); if (e) return e;
    const r = await addTeacher(env, b.name, b.pin); if (!r.ok) return json(r);
    return json({ ok: true, ...(await newSession(env, r.id)), name: r.name });
  }
  if (path === '/api/login') {
    const lu = await lockUntil(env, ip);
    if (lu) return json({ ok: false, error: lockText(lu) }, 429);
    const tid = str(b.tid, 60);
    if (tid.startsWith('m:')) { // 업무 앱 PIN으로
      const r = await noticeCall(env, '/sync/staff-pin', { mid: tid.slice(2), pin: str(b.pin, 12) });
      if (!r.ok && /연결/.test(r.error || '')) return json({ ok: false, error: r.error }, 503);
      if (!r.ok || r.shared) return json({ ok: false, error: failText('PIN이 맞지 않아요', await failAdd(env, ip)) }, 401);
      await failClear(env, ip);
      await run(env, 'INSERT INTO teachers (id, name, salt, pin, created, boss) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, boss = excluded.boss', tid, str(r.name, 20), rid(8), rid(16), Date.now(), r.boss ? 1 : 0);
      return json({ ok: true, ...(await newSession(env, tid)), name: r.name });
    }
    const t = await one(env, 'SELECT * FROM teachers WHERE id = ?', tid);
    if (!t || !(await sameText(await pinHash(t.salt, b.pin), t.pin))) return json({ ok: false, error: failText('PIN이 맞지 않아요', await failAdd(env, ip)) }, 401);
    await failClear(env, ip);
    return json({ ok: true, ...(await newSession(env, t.id)), name: t.name });
  }

  // ═════════ 관장님 비밀번호가 필요한 일 ═════════
  if (path.startsWith('/api/admin/')) { // 로그인한 사범님(PIN)이면 됨. 관장님 비밀번호로도 가능
    const am = await auth(env, b.tok); // 백업 불러오기·초기화 등은 관리자만 (업무 앱 관리자로 로그인했거나 관리자 비밀번호) 2026-11-13
    if (!am || !am.boss) { const e = await checkAdmin(env, ip, b.password); if (e) return e; }
    if (path === '/api/admin/check') return json({ ok: true });
    if (/^\/api\/admin\/teacher-/.test(path)) return json({ ok: false, error: '사범님 추가·PIN·삭제는 업무 앱 → 설정 → 직원 관리에서 해요' }); // 2026-11-13
    if (path === '/api/admin/teacher-add') return json(await addTeacher(env, b.name, b.pin));
    if (path === '/api/admin/teacher-pin') {
      const pin = String(b.pin || '');
      if (!/^\d{4,6}$/.test(pin)) return json({ ok: false, error: 'PIN은 숫자 4~6자리로 정해 주세요' });
      const salt = rid(8);
      await run(env, 'UPDATE teachers SET salt = ?, pin = ? WHERE id = ?', salt, await pinHash(salt, pin), str(b.tid, 40));
      await run(env, 'DELETE FROM sessions WHERE tid = ?', str(b.tid, 40));
      return json({ ok: true });
    }
    if (path === '/api/admin/teacher-del') {
      await run(env, 'DELETE FROM teachers WHERE id = ?', str(b.tid, 40));
      await run(env, 'DELETE FROM sessions WHERE tid = ?', str(b.tid, 40));
      return json({ ok: true });
    }
    if (path === '/api/admin/wipe') { // 출석부 초기화 (사범님 PIN은 그대로)
      await env.DB.batch(['students', 'att', 'absences', 'trials', 'history', 'closed'].map(t => env.DB.prepare('DELETE FROM ' + t)));
      return json({ ok: true });
    }
    if (path === '/api/admin/import') return json(await importChunk(env, b));
    return json({ ok: false, error: 'not found' }, 404);
  }

  // ═════════ 사범님 로그인 후 ═════════
  const me = await auth(env, b.tok);
  if (!me) return json({ ok: false, error: '다시 로그인해 주세요', relogin: true }, 401);
  const who = me.name;

  if (path === '/api/logout') { await run(env, 'DELETE FROM sessions WHERE tok = ?', str(b.tok, 64)); return json({ ok: true }); }
  if (path === '/api/pin-change') {
    if (String(me.id).startsWith('m:')) return json({ ok: false, error: 'PIN은 업무 앱 → 설정에서 바꿔요 (출석부도 같은 PIN을 써요)' });
    const t = await one(env, 'SELECT * FROM teachers WHERE id = ?', me.id);
    if (!(await sameText(await pinHash(t.salt, b.old), t.pin))) return json({ ok: false, error: '지금 PIN이 맞지 않습니다' });
    if (!/^\d{4,6}$/.test(String(b.pin || ''))) return json({ ok: false, error: '새 PIN은 숫자 4~6자리로 정해 주세요' });
    const salt = rid(8);
    await run(env, 'UPDATE teachers SET salt = ?, pin = ? WHERE id = ?', salt, await pinHash(salt, String(b.pin)), me.id);
    return json({ ok: true });
  }

  if (path === '/api/boot') {
    const [students, absences, trials, closed, th, teachers] = await Promise.all([
      all(env, 'SELECT id, data FROM students'),
      all(env, 'SELECT sid, date, why FROM absences WHERE date >= ?', addDays(kstDay(), -100)),
      all(env, 'SELECT id, data FROM trials'),
      all(env, 'SELECT day, why FROM closed'),
      all(env, "SELECT id, sid, tid, at, text, who FROM history WHERE tid <> '' ORDER BY at DESC LIMIT 500"),
      all(env, 'SELECT id, name FROM teachers ORDER BY created'),
    ]);
    return json({ ok: true, me: { id: me.id, name: me.name, boss: me.boss }, teachers,
      students: students.map(r => ({ id: r.id, ...J(r.data, {}) })).filter(x => me.boss || x.status !== '퇴관'), // 퇴관 원생은 관리자만 (2026-11-13)
      trials: trials.map(r => ({ id: r.id, ...J(r.data, {}) })),
      absences, closed, trialHistory: th });
  }

  if (path === '/api/att') {
    let rows;
    if (/^\d{4}$/.test(String(b.year || ''))) rows = await all(env, 'SELECT day, sid, r, p, w, mk, who, at, tin FROM att WHERE day LIKE ?', b.year + '-%');
    else if (/^\d{4}-\d{2}$/.test(String(b.ym || ''))) rows = await all(env, 'SELECT day, sid, r, p, w, mk, who, at, tin FROM att WHERE day LIKE ?', b.ym + '-%');
    else if (isDay(b.day)) rows = await all(env, 'SELECT day, sid, r, p, w, mk, who, at, tin FROM att WHERE day = ?', b.day);
    else return json({ ok: false, error: '기간을 확인해 주세요' });
    const ym = b.ym || (b.day ? b.day.slice(0, 7) : null);
    const ab = ym ? await all(env, 'SELECT sid, date, why FROM absences WHERE date LIKE ?', ym + '-%') : await all(env, 'SELECT sid, date, why FROM absences WHERE date LIKE ?', b.year + '-%');
    return json({ ok: true, rows, absences: ab });
  }

  if (path === '/api/att-set') { // 여러 명 한 번에: r 'o' 출석 / 'x' 결석 / '' 미확인, del 이면 줄 지움(보강 취소 등)
    if (!isDay(b.day)) return json({ ok: false, error: '날짜를 확인해 주세요' });
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 200);
    const now = Date.now(), st = [];
    for (const it of items) {
      const sid = str(it.sid, 60); if (!sid) continue;
      if (it.del) { // 태블릿 기록이 있으면 줄은 남기고 출결만 비움
        st.push(q(env, "DELETE FROM att WHERE day = ? AND sid = ? AND (tin IS NULL OR tin = '')", b.day, sid));
        st.push(q(env, "UPDATE att SET r = '', p = '', w = '', who = ?, at = ? WHERE day = ? AND sid = ?", who, now, b.day, sid));
        continue; }
      const r = ['o', 'x', ''].includes(it.r) ? it.r : '';
      st.push(q(env, 'INSERT INTO att (day, sid, r, p, w, mk, who, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(day, sid) DO UPDATE SET r = excluded.r, p = excluded.p, w = excluded.w, mk = MAX(att.mk, excluded.mk), who = excluded.who, at = excluded.at',
        b.day, sid, r, r === 'o' ? cleanP(it.p) : '', r === 'x' ? str(it.w, 40) : '', it.mk ? 1 : 0, who, now));
    }
    if (st.length) await env.DB.batch(st);
    return json({ ok: true, rows: await all(env, 'SELECT day, sid, r, p, w, mk, who, at, tin FROM att WHERE day = ?', b.day) });
  }

  if (path === '/api/student-save') return json(await saveStudentRow(env, b, who));
  if (path === '/api/dl-check') return json(await dlCheck(env, b.pin, 'att:' + me.id));
  if (path === '/api/checkin-notify') { // 태블릿을 안 누른 제자 출석 + '등원 알림 보내기' → 학부모 앱에 등원으로 기록하고 알림
    const st = await one(env, 'SELECT data FROM students WHERE id = ?', str(b.sid, 60)); if (!st) return json({ ok: false, error: '원생을 찾지 못했어요' });
    if (!env.NOTICE || !env.SYNC_KEY) return json({ ok: false, error: '학부모 알림 앱이 연결되지 않았어요' });
    try { const r = await env.NOTICE.fetch('https://notice/sync/teacher-checkin', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sync-Key': env.SYNC_KEY }, body: JSON.stringify({ name: J(st.data, {}).name }) }); return json(await r.json()); }
    catch (_) { return json({ ok: false, error: '학부모 알림 앱에 연결하지 못했어요' }); }
  }
  if (path === '/api/student-delete') {
    const id = str(b.id, 60);
    await env.DB.batch(['students WHERE id', 'att WHERE sid', 'absences WHERE sid', 'history WHERE sid'].map(t => q(env, 'DELETE FROM ' + t + ' = ?', id)));
    return json({ ok: true });
  }
  if (path === '/api/history') return json({ ok: true, items: await all(env, 'SELECT id, sid, tid, at, text, who FROM history WHERE sid = ? ORDER BY at DESC LIMIT 200', str(b.sid, 60)) });

  if (path === '/api/absence-set') { // 미리 연락 온 결석
    const st = [];
    for (const a of (Array.isArray(b.add) ? b.add : []).slice(0, 100)) if (a.sid && isDay(a.date)) st.push(q(env, 'INSERT INTO absences (sid, date, why) VALUES (?, ?, ?) ON CONFLICT(sid, date) DO UPDATE SET why = excluded.why', str(a.sid, 60), a.date, str(a.why, 40)));
    for (const a of (Array.isArray(b.remove) ? b.remove : []).slice(0, 100)) if (a.sid && isDay(a.date)) st.push(q(env, 'DELETE FROM absences WHERE sid = ? AND date = ?', str(a.sid, 60), a.date));
    if (st.length) await env.DB.batch(st);
    return json({ ok: true });
  }

  if (path === '/api/trial-save') {
    const t = b.trial || {};
    const d = { name: str(t.name, 20).trim(), date: isDay(t.date) ? t.date : '', per: cleanP(t.per), birth: str(t.birth, 4), guardian: str(t.guardian, 10), phone: str(t.phone, 20).replace(/[^0-9]/g, ''), inst: str(t.inst, 20), memo: str(t.memo, 500), status: ['예정', '등록', '등록 안 함', '미확인'].includes(t.status) ? t.status : '예정', studentId: str(t.studentId, 60) };
    if (!d.name || !d.date) return json({ ok: false, error: '이름과 날짜를 적어 주세요' });
    const id = str(t.id, 60) || rid(16);
    const st = [q(env, 'INSERT INTO trials (id, data, upd) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, upd = excluded.upd', id, JSON.stringify(d), Date.now())];
    for (const x of (Array.isArray(b.history) ? b.history : []).slice(0, 10)) st.push(q(env, 'INSERT INTO history (id, sid, tid, at, text, who) VALUES (?, ?, ?, ?, ?, ?)', crypto.randomUUID(), d.studentId, id, Date.now(), str(x, 200), who));
    await env.DB.batch(st);
    return json({ ok: true, id });
  }
  if (path === '/api/trial-delete') { await env.DB.batch([q(env, 'DELETE FROM trials WHERE id = ?', str(b.id, 60)), q(env, "DELETE FROM history WHERE tid = ? AND sid = ''", str(b.id, 60))]); return json({ ok: true }); }

  if (path === '/api/closed-set') {
    if (!isDay(b.day)) return json({ ok: false, error: '날짜를 확인해 주세요' });
    if (b.on) await run(env, 'INSERT INTO closed (day, why) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET why = excluded.why', b.day, str(b.why, 40));
    else await run(env, 'DELETE FROM closed WHERE day = ?', b.day);
    return json({ ok: true });
  }

  if (path === '/api/notify-parent') { // 사범님이 누를 때만: 그 아이 보호자 앱으로 출석 알림
    const s = await one(env, 'SELECT data FROM students WHERE id = ?', str(b.sid, 60));
    if (!s) return json({ ok: false, error: '원생을 찾지 못했습니다' });
    const name = J(s.data, {}).name, title = str(b.title, 100).trim(), body = str(b.body, 300).trim();
    if (!title) return json({ ok: false, error: '보낼 내용을 적어 주세요' });
    if (!env.NOTICE || !env.SYNC_KEY) return json({ ok: false, error: '학부모 알림 앱이 아직 연결되지 않았습니다 (출석부 서버 설정의 NOTICE 연결)' });
    try {
      const r = await env.NOTICE.fetch('https://notice/sync/notify', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sync-Key': env.SYNC_KEY }, body: JSON.stringify({ name, title, body }) });
      const j = await r.json();
      if (j.ok) await run(env, 'INSERT INTO history (id, sid, tid, at, text, who) VALUES (?, ?, ?, ?, ?, ?)', crypto.randomUUID(), str(b.sid, 60), '', Date.now(), '학부모님께 출석 보냄: ' + title, who);
      return json(j);
    } catch (e) { return json({ ok: false, error: '학부모 알림 앱에 연결하지 못했습니다' }); }
  }

  if (path === '/api/export') { // 백업 파일 (예전 출석부와 같은 모양) — 내려받기 비밀번호 필요
    if (!me.boss) return json({ ok: false, error: '백업 파일은 관리자만 받을 수 있어요' }, 403); // 2026-11-13 사용자 결정
    const dl = await dlCheck(env, b.dlpin, 'att:' + me.id); if (!dl.ok) return json(dl);
    return json({ ok: true, backup: await exportAll(env) });
  }

  return json({ ok: false, error: 'not found' }, 404);
}

// 백업 파일 불러오기: 화면이 조각(part)으로 나눠 보냄 — 무료 요금제 계산 한도 때문
async function importChunk(env, b) {
  const part = b.part, d = b.data || {}, st = [];
  if (part === 'students') {
    for (const [id, s] of Object.entries(d)) st.push(q(env, 'INSERT INTO students (id, data, upd) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, upd = excluded.upd', str(id, 60), JSON.stringify(cleanStudent(s)), Date.now()));
  } else if (part === 'att') { // [[day, sid, r, p, w, mk], ...]
    for (const a of (Array.isArray(d) ? d : [])) {
      if (!isDay(a[0]) || !a[1]) continue;
      const r = ['o', 'x'].includes(a[2]) ? a[2] : '';
      st.push(q(env, "INSERT INTO att (day, sid, r, p, w, mk, who, at) VALUES (?, ?, ?, ?, ?, ?, '예전 출석부', 0) ON CONFLICT(day, sid) DO UPDATE SET r = excluded.r, p = excluded.p, w = excluded.w, mk = excluded.mk",
        a[0], str(a[1], 60), r, cleanP(a[3]), str(a[4], 40), a[5] ? 1 : 0));
    }
  } else if (part === 'absences') {
    for (const a of (Array.isArray(d) ? d : [])) if (a.sid && isDay(a.date)) st.push(q(env, 'INSERT INTO absences (sid, date, why) VALUES (?, ?, ?) ON CONFLICT(sid, date) DO UPDATE SET why = excluded.why', str(a.sid, 60), a.date, str(a.why, 40)));
  } else if (part === 'trials') {
    for (const [id, t] of Object.entries(d)) st.push(q(env, 'INSERT INTO trials (id, data, upd) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data', str(id, 60), JSON.stringify(t || {}), Date.now()));
  } else if (part === 'history') {
    for (const [id, h] of Object.entries(d)) st.push(q(env, 'INSERT OR REPLACE INTO history (id, sid, tid, at, text, who) VALUES (?, ?, ?, ?, ?, ?)', str(id, 60), str(h.sid, 60), str(h.tid, 60), Date.parse(h.at) || 0, str(h.text, 200), str(h.who, 20)));
  } else if (part === 'closed') {
    for (const [day, why] of Object.entries(d)) if (isDay(day)) st.push(q(env, 'INSERT OR REPLACE INTO closed (day, why) VALUES (?, ?)', day, str(typeof why === 'string' ? why : (why && why.why) || '', 40)));
  } else return { ok: false, error: 'part' };
  if (st.length > 400) return { ok: false, error: '한 번에 너무 많습니다' };
  if (st.length) await env.DB.batch(st);
  return { ok: true, n: st.length };
}

// 내려받기 비밀번호 확인 (5번마다 잠금, 1분·2분·3분…)
// 업무 앱 직원·PIN은 알림 서버를 거쳐 업무 서버에서 확인 (출석부에는 업무 서버 연결이 없음) — 2026-11-13 사용자 결정: 사범님 PIN은 업무 앱에서만
async function noticeCall(env, path, body) {
  if (!env.NOTICE || !env.SYNC_KEY) return { ok: false, error: '업무 앱에 연결되지 않았어요' };
  try { return await (await env.NOTICE.fetch('https://notice' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sync-Key': env.SYNC_KEY }, body: JSON.stringify(body) })).json(); }
  catch (_) { return { ok: false, error: '업무 앱에 연결하지 못했어요' }; }
}
// 내려받기(명단·출결·백업 파일)는 관리자 비밀번호 (알림 앱 관리자 비밀번호 = 장부 기기 등록과 같은 것) — 2026-11-13 사용자 결정
async function dlCheck(env, pin, key) {
  const k = 'dl:' + key, lu = await lockUntil(env, k);
  if (lu) return { ok: false, error: lockText(lu) };
  let ok = false, reached = false;
  if (env.NOTICE) { try { const r = await (await env.NOTICE.fetch('https://notice/ledger/admin-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: String(pin || '').slice(0, 100) }) })).json(); reached = !r.error; ok = !!r.ok; } catch (_) {} }
  if (!reached) ok = !!(env.ADMIN_PASSWORD && await sameText(String(pin || ''), env.ADMIN_PASSWORD)); // 알림 서버에 못 닿으면 출석부 관리자 비밀번호로
  if (!ok) return { ok: false, error: failText('관리자 비밀번호가 맞지 않아요', await failAdd(env, k)) };
  await failClear(env, k);
  return { ok: true };
}
async function dlCheckOld(env, pin, key) { // 예전 '내려받기 비밀번호' (안 씀, 기록용)
  const r = await one(env, "SELECT v FROM kv WHERE k = 'dlpin'"); if (!r) return { ok: false, notSet: true, error: '아직 내려받기 비밀번호가 없어요. 이사범님이 업무 앱 설정에서 먼저 정해 주세요' };
  const k = 'dl:' + key, lu = await lockUntil(env, k);
  if (lu) return { ok: false, error: lockText(lu) };
  const d = J(r.v, {});
  if (!(await sameText(await pinHash(d.salt, String(pin || '')), d.h))) return { ok: false, error: failText('내려받기 비밀번호가 맞지 않아요', await failAdd(env, k)) };
  await failClear(env, k);
  return { ok: true };
}

async function saveStudentRow(env, b, who) {
  const s = cleanStudent(b.student || {});
  if (!s.name) return { ok: false, error: '이름을 적어 주세요' };
  const id = str(b.student && b.student.id, 60) || crypto.randomUUID(), upd = Date.now();
  const st = [q(env, 'INSERT INTO students (id, data, upd) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, upd = excluded.upd', id, JSON.stringify(s), upd)];
  for (const t of (Array.isArray(b.history) ? b.history : []).slice(0, 20)) st.push(q(env, 'INSERT INTO history (id, sid, tid, at, text, who) VALUES (?, ?, ?, ?, ?, ?)', crypto.randomUUID(), id, str(b.tid, 60), upd, str(t, 200), who));
  await env.DB.batch(st);
  return { ok: true, id, upd };
}

function cleanStudent(s) {
  const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
  const days = arr => (Array.isArray(arr) ? arr : []).filter(x => DAYS.includes(x)).sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b));
  const okDay = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : '');
  return {
    name: str(s.name, 20).trim(),
    birth: (+s.birth > 1900 && +s.birth < 2100) ? +s.birth : '',
    days: days(s.days),
    status: ['재원', '휴원', '퇴관'].includes(s.status) ? s.status : '재원',
    joined: okDay(s.joined),
    gender: ['남', '여'].includes(s.gender) ? s.gender : '',
    memo: str(s.memo, 500),
    no: str(s.no, 4).replace(/\D/g, ''),
    guardian: str(s.guardian, 10),
    phone: str(s.phone, 20).replace(/[^0-9]/g, ''),
    phone2: str(s.phone2, 20).replace(/[^0-9]/g, ''), // 다른 보호자 연락처 (학부모 앱 가입 확인용, 2026-11-13)
    famId: str(s.famId, 40), // 형제·자매 묶음 (업무 앱에서 묶음, 2026-11-13)
    inst: str(s.inst, 20),
    leavePeriods: (Array.isArray(s.leavePeriods) ? s.leavePeriods : []).slice(0, 20).map(p => ({ start: okDay(p.start), end: okDay(p.end) })).filter(p => p.start || p.end),
    temporarySchedules: (Array.isArray(s.temporarySchedules) ? s.temporarySchedules : []).slice(0, 20).map(p => ({ start: okDay(p.start), end: okDay(p.end), days: days(p.days) })).filter(p => p.start),
    noAsk: !!s.noAsk, // 태블릿을 안 눌러도 '등원 알림 보낼까요?'를 묻지 않음 (보호자가 데려다주는 제자)
    // 회원 상태 바뀐 기록 (날짜·사유) — 업무 앱 원생 메뉴와 출석부가 같이 씀
    statusLog: (Array.isArray(s.statusLog) ? s.statusLog : []).slice(-40).map(p => ({ date: okDay(p.date), from: ['재원', '휴원', '퇴관', ''].includes(p.from) ? p.from : '', to: ['재원', '휴원', '퇴관'].includes(p.to) ? p.to : '재원', why: str(p.why, 100), who: str(p.who, 20), at: +p.at || 0 })),
  };
}

function periodFor(min) { // 도착 시각 → 수업 시간부 (시작 1시간 전 ~ 시작 25분 뒤에 온 수업)
  for (const [k, start] of PERIODS) if (min >= start - 60 && min <= start + 25) return k;
  return '';
}

// ─────────── 로그인 ───────────
async function addTeacher(env, name, pin) {
  name = str(name, 12).trim(); pin = String(pin || '');
  if (!name) return { ok: false, error: '사범님 이름을 적어 주세요' };
  if (!/^\d{4,6}$/.test(pin)) return { ok: false, error: 'PIN은 숫자 4~6자리로 정해 주세요' };
  if (await one(env, 'SELECT id FROM teachers WHERE name = ?', name)) return { ok: false, error: '같은 이름이 이미 있습니다' };
  const id = rid(8), salt = rid(8);
  await run(env, 'INSERT INTO teachers (id, name, salt, pin, created) VALUES (?, ?, ?, ?, ?)', id, name, salt, await pinHash(salt, pin), Date.now());
  return { ok: true, id, name };
}
async function newSession(env, tid) {
  const tok = rid(24);
  await run(env, 'INSERT INTO sessions (tok, tid, created) VALUES (?, ?, ?)', tok, tid, Date.now());
  await run(env, 'DELETE FROM sessions WHERE created < ?', Date.now() - SESSION_DAYS * 86400e3);
  return { tok };
}
async function auth(env, tok) {
  if (!tok) return null;
  const s = await one(env, 'SELECT s.tid, s.created, t.name, t.boss FROM sessions s JOIN teachers t ON t.id = s.tid WHERE s.tok = ?', str(tok, 64));
  if (!s || s.created < Date.now() - SESSION_DAYS * 86400e3) return null;
  if (s.created < Date.now() - 86400e3) await run(env, 'UPDATE sessions SET created = ? WHERE tok = ?', Date.now(), str(tok, 64)); // 쓰는 동안은 로그인 계속 유지
  return { id: s.tid, name: s.name, boss: !!s.boss };
}
async function checkAdmin(env, ip, password) {
  const lu = await lockUntil(env, ip);
  if (lu) return json({ ok: false, error: lockText(lu) }, 429);
  if (!env.ADMIN_PASSWORD || !(await sameText(password || '', env.ADMIN_PASSWORD))) return json({ ok: false, error: failText('관리자 비밀번호가 맞지 않아요', await failAdd(env, ip)) }, 401);
  return null;
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
  const p = new Uint8Array(x), r = new Uint8Array(y);
  let d = 0; for (let i = 0; i < p.length; i++) d |= p[i] ^ r[i];
  return d === 0;
}

// ─────────── 도구 ───────────
function kstDay(d = new Date()) { return new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10); }
function addDays(day, n) { return new Date(Date.parse(day + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10); }
function enc(s) { return new TextEncoder().encode(s); }
function hex(b) { return [...b].map(x => x.toString(16).padStart(2, '0')).join(''); }
async function exportAll(env) { // 백업 파일 (예전 출석부와 같은 모양 — '백업 불러오기'로 다시 넣을 수 있음)
  const [students, att, absences, trials, history, closed] = await Promise.all([
    all(env, 'SELECT id, data FROM students'), all(env, 'SELECT day, sid, r, p, w, mk FROM att ORDER BY day'),
    all(env, 'SELECT sid, date, why FROM absences'), all(env, 'SELECT id, data FROM trials'),
    all(env, 'SELECT id, sid, tid, at, text, who FROM history'), all(env, 'SELECT day, why FROM closed'),
  ]);
  const out = { app: '해랑 출석부', exportedAt: new Date().toISOString(), att: {}, absences: {}, trials: {}, students: {}, history: {}, closed: {}, makeup: {} };
  for (const s of students) out.students[s.id] = J(s.data, {});
  for (const a of att) {
    const d = out.att[a.day] || (out.att[a.day] = { ym: a.day.slice(0, 7), r: {}, p: {}, w: {} });
    d.r[a.sid] = a.r; if (a.p) d.p[a.sid] = a.p; if (a.w) d.w[a.sid] = a.w;
    if (a.mk) (out.makeup[a.day] || (out.makeup[a.day] = [])).push(a.sid);
  }
  for (const a of absences) out.absences[a.sid + '_' + a.date] = { sid: a.sid, date: a.date, why: a.why, ym: a.date.slice(0, 7) };
  for (const t of trials) out.trials[t.id] = J(t.data, {});
  for (const h of history) out.history[h.id] = { sid: h.sid, tid: h.tid, at: new Date(h.at).toISOString(), text: h.text, who: h.who || '' };
  for (const c of closed) out.closed[c.day] = c.why || '';
  return out;
}
function json(o, status = 200) { return new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } }); }
function cors(r) {
  const h = new Headers(r.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type');
  return new Response(r.body, { status: r.status, headers: h });
}
