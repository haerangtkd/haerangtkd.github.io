// 세 서버(Worker)를 컴퓨터에서 한 번에 돌려 보는 테스트용 서버 (Cloudflare 없이)
// 필요: Node 22 이상 (node:sqlite 사용)
// 실행: 저장소 맨 위에서  node tools/local-test/server.mjs
// 열기: http://localhost:8787/attendance/  /team/  /notice/admin.html  /ledger/
// 비밀값(테스트용): ADMIN_PASSWORD = kwanjang, SYNC_KEY = sync123  → 실제 서버 값과 다름
// 데이터는 tools/local-test/*.db 에 저장 (지우면 처음부터)
import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const load = async p => { // .js 를 모듈로 읽으려고 임시 .mjs 로 복사
  const tmp = path.join(HERE, '.' + path.basename(path.dirname(path.dirname(p))) + '.mjs');
  fs.copyFileSync(p, tmp); return (await import(pathToFileURL(tmp).href + '?' + Date.now())).default;
};
const aw = await load(path.join(ROOT, 'attendance/worker/worker.js'));
const nw = await load(path.join(ROOT, 'notice/worker/worker.js'));
const tw = await load(path.join(ROOT, 'team/worker/worker.js'));
const lw = await load(path.join(ROOT, 'ledger/worker/worker.js'));

function D1(file) { // Cloudflare D1 흉내 (prepare/bind/first/all/run/batch)
  const db = new DatabaseSync(path.join(HERE, file));
  const mk = (sql, args = []) => ({
    bind: (...a) => mk(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
    _run: () => /^\s*(SELECT|PRAGMA)/i.test(sql) ? { results: db.prepare(sql).all(...args) } : (db.prepare(sql).run(...args), { results: [] }),
  });
  return { prepare: s => mk(s), batch: async st => { db.exec('BEGIN'); try { const out = st.map(x => x._run()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}
// 서버끼리 부를 때 주소 이름(notice·attendance·team)이 실제 서비스 바인딩과 같음 → /sync/·/ledger/ 의 주소 이름 확인도 그대로 시험됨 (화면에서 부르면 'w')
const bind = (w, env) => ({ fetch: (u, init) => w.fetch(new Request(u, init), env, ctx) });
const ctx = { waitUntil: p => p && p.catch && p.catch(() => {}) };
const aenv = { DB: D1('att.db'), ADMIN_PASSWORD: 'kwanjang', SYNC_KEY: 'sync123' };
const nenv = { DB: D1('notice.db'), ADMIN_PASSWORD: 'kwanjang', SYNC_KEY: 'sync123' };
const tenv = { DB: D1('team.db'), SYNC_KEY: 'sync123' };
const lenv = { DB: D1('ledger.db') };
aenv.NOTICE = bind(nw, nenv); nenv.ATT = bind(aw, aenv); tenv.ATT = bind(aw, aenv); tenv.NOTICE = bind(nw, nenv); nenv.TEAM = bind(tw, tenv); lenv.TEAM = bind(tw, tenv); lenv.NOTICE = bind(nw, nenv);

const API = { A: [aw, aenv], N: [nw, nenv], T: [tw, tenv], L: [lw, lenv] }; // /A/… 출석부, /N/… 알림, /T/… 업무, /L/… 장부
const CONFIG = {
  '/attendance/config.js': "window.HAERANG_ATT_API='http://localhost:8787/A';",
  '/notice/config.js': "window.HAERANG_PUSH_API='http://localhost:8787/N';",
  '/team/config.js': "window.HAERANG_TEAM_API='http://localhost:8787/T';",
  '/ledger/config.js': "window.HAERANG_LEDGER_API='http://localhost:8787/L';",
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), k = u.pathname.split('/')[1];
  if (API[k]) {
    const body = req.method === 'POST' ? await new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)); }) : undefined;
    const r = await API[k][0].fetch(new Request('http://w' + u.pathname.slice(k.length + 1), { method: req.method, body, headers: req.headers }), API[k][1], ctx);
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text()); return;
  }
  if (CONFIG[u.pathname]) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(CONFIG[u.pathname]); return; }
  let p = path.join(ROOT, decodeURIComponent(u.pathname)); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); res.end(d); });
}).listen(8787, () => console.log('http://localhost:8787/attendance/  /team/  /notice/admin.html'));
