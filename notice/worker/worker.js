// 해랑경희 알림 서버 (Cloudflare Workers 무료 요금제용)
// ─────────────────────────────────────────────
// 필요한 설정 (Cloudflare 대시보드 → 이 Worker → 설정)
//   1) KV 네임스페이스 바인딩: 변수 이름 DB
//   2) 비밀 변수(Secret): ADMIN_PASSWORD  ← 관장님 발송 페이지 비밀번호
// 푸시 서명 키(VAPID)는 처음 실행될 때 자동으로 만들어 DB에 저장합니다.
// ─────────────────────────────────────────────

const SITE = 'https://haerangtkd.github.io';
const BATCH = 40;               // 무료 요금제 외부 요청 한도(50) 안에서 한 번에 보낼 기기 수
const MAX_NOTICES = 50;         // 공개 공지 목록에 남길 개수

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    try {
      const url = new URL(req.url);
      const r = await route(url.pathname, req, env);
      return cors(r);
    } catch (e) {
      return cors(json({ ok: false, error: String(e && e.message || e) }, 500));
    }
  },
};

async function route(path, req, env) {
  if (path === '/vapid' && req.method === 'GET') {
    const v = await getVapid(env);
    return json({ ok: true, publicKey: v.publicKey });
  }
  if (path === '/notices' && req.method === 'GET') {
    const list = (await env.DB.get('notices', 'json')) || [];
    return json({ ok: true, notices: list });
  }
  if (path === '/subscribe' && req.method === 'POST') {
    const b = await req.json();
    const s = b.subscription || {};
    if (!s.endpoint || !s.keys || !s.keys.p256dh || !s.keys.auth) return json({ ok: false, error: '구독 정보가 올바르지 않습니다' }, 400);
    if (!/^https:\/\//.test(s.endpoint)) return json({ ok: false, error: 'endpoint' }, 400);
    const children = cleanNames(b.children);
    const id = await subId(s.endpoint);
    const old = (await env.DB.getWithMetadata('sub:' + id)).metadata;
    // 같은 휴대폰이 같은 이름으로 다시 등록하면 승인 상태 유지, 이름이 바뀌면 다시 승인 필요
    const same = old && old.ok && JSON.stringify([...old.c].sort()) === JSON.stringify([...children].sort());
    const meta = { e: s.endpoint, p: s.keys.p256dh, a: s.keys.auth, c: children, t: old ? old.t : Date.now(), ok: !!same };
    const changed = !old || old.ok !== meta.ok || old.e !== meta.e || old.p !== meta.p || old.a !== meta.a || JSON.stringify(old.c) !== JSON.stringify(meta.c);
    if (changed) await env.DB.put('sub:' + id, '1', { metadata: meta });
    return json({ ok: true, id, approved: meta.ok });
  }
  if (path === '/unsubscribe' && req.method === 'POST') {
    const b = await req.json();
    if (b.endpoint) await env.DB.delete('sub:' + await subId(b.endpoint));
    return json({ ok: true });
  }

  // ── 여기부터 관장님 전용 ──
  if (path.startsWith('/admin/')) {
    const b = req.method === 'POST' ? await req.json() : {};
    const pw = b.password || req.headers.get('x-admin-password') || '';
    // 비밀번호를 10번 틀리면 그 인터넷 주소는 15분 동안 잠금
    const ip = req.headers.get('cf-connecting-ip') || 'x';
    const failKey = 'fail:' + ip;
    const fails = +(await env.DB.get(failKey)) || 0;
    if (fails >= 10) return json({ ok: false, error: '비밀번호를 여러 번 틀려 15분 동안 잠겼습니다' }, 429);
    if (!env.ADMIN_PASSWORD || !(await sameText(pw, env.ADMIN_PASSWORD))) {
      await env.DB.put(failKey, String(fails + 1), { expirationTtl: 900 });
      return json({ ok: false, error: '비밀번호가 맞지 않습니다' }, 401);
    }

    if (path === '/admin/status') {
      const subs = await listSubs(env);
      const map = {};
      for (const s of subs) if (s.ok) for (const c of s.c) map[c] = (map[c] || 0) + 1;
      const children = Object.keys(map).sort((a, b) => a.localeCompare(b, 'ko')).map(n => ({ name: n, devices: map[n] }));
      const pending = subs.filter(s => !s.ok && s.c.length).sort((a, b) => b.t - a.t).map(s => ({ id: s.key.slice(4), children: s.c, at: s.t }));
      return json({ ok: true, devices: subs.length, children, pending });
    }
    if (path === '/admin/approve') {
      const key = 'sub:' + String(b.id || '').replace(/[^0-9a-f]/g, '');
      const r = await env.DB.getWithMetadata(key);
      if (!r.metadata) return json({ ok: false, error: '이미 지워진 등록입니다' });
      if (b.approve) await env.DB.put(key, '1', { metadata: { ...r.metadata, ok: true } });
      else await env.DB.delete(key);
      return json({ ok: true });
    }
    if (path === '/admin/send') return json(await send(env, b));
    if (path === '/admin/delete-notice') {
      let list = (await env.DB.get('notices', 'json')) || [];
      list = list.filter(n => n.id !== b.id);
      await env.DB.put('notices', JSON.stringify(list));
      return json({ ok: true });
    }
  }
  return json({ ok: false, error: 'not found' }, 404);
}

// 발송: children 이 비어 있으면 전체, 있으면 그 아이를 등록한 기기에만
// 관장님 페이지가 offset 을 늘려 가며 여러 번 불러 BATCH 개씩 보냅니다.
async function send(env, b) {
  const title = String(b.title || '').slice(0, 80).trim();
  const body = String(b.body || '').slice(0, 500).trim();
  const kind = String(b.kind || '공지').slice(0, 10);
  if (!title) return { ok: false, error: '제목이 비어 있습니다' };
  const targets = cleanNames(b.children);
  const offset = Math.max(0, b.offset | 0);
  const msgId = b.msgId || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));

  // 전체 공지는 첫 묶음 보낼 때 공개 목록에 저장
  if (offset === 0 && targets.length === 0 && b.save !== false) {
    const list = (await env.DB.get('notices', 'json')) || [];
    if (!list.some(n => n.id === msgId)) {
      list.unshift({ id: msgId, kind, title, body, at: Date.now() });
      await env.DB.put('notices', JSON.stringify(list.slice(0, MAX_NOTICES)));
    }
  }

  let subs = await listSubs(env);
  // 아이를 지정한 알림(등원·하원·개별 회비)은 관장님이 승인한 휴대폰에만
  if (targets.length) subs = subs.filter(s => s.ok && s.c.some(c => targets.includes(c)));
  const total = subs.length;
  const slice = subs.slice(offset, offset + BATCH);

  const vapid = await getVapid(env);
  const payload = JSON.stringify({
    title, body, kind,
    url: SITE + '/notice/' + (targets.length ? '' : '#n-' + msgId),
    tag: targets.length ? 'p-' + msgId : 'n-' + msgId,
  });

  let sent = 0, failed = 0, removed = 0;
  await Promise.all(slice.map(async s => {
    try {
      const res = await webPush({ endpoint: s.e, p256dh: s.p, auth: s.a }, payload, vapid);
      if (res.status === 404 || res.status === 410) { await env.DB.delete(s.key); removed++; }
      else if (res.ok) sent++;
      else failed++;
    } catch (e) { failed++; }
  }));
  // 만료된 기기를 지우면 뒤 순서가 당겨지므로 그만큼 빼고 다음 위치를 계산
  const nextAt = offset + slice.length - removed;
  const next = nextAt < total - removed ? nextAt : null;
  return { ok: true, msgId, total, sent, failed, removed, next };
}

async function listSubs(env) {
  const out = [];
  let cursor;
  do {
    const r = await env.DB.list({ prefix: 'sub:', cursor, limit: 1000 });
    for (const k of r.keys) if (k.metadata && k.metadata.e) out.push({ key: k.name, ...k.metadata, c: k.metadata.c || [] });
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  out.sort((a, b) => (a.key < b.key ? -1 : 1));
  return out;
}

function cleanNames(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  for (const x of arr) {
    const n = String(x || '').replace(/\s+/g, '').slice(0, 20);
    if (n) seen.add(n);
  }
  return [...seen].slice(0, 6);
}

async function sameText(a, b) {
  const [x, y] = await Promise.all([a, b].map(v => crypto.subtle.digest('SHA-256', enc(String(v)))));
  const p = new Uint8Array(x), q = new Uint8Array(y);
  let d = 0; for (let i = 0; i < p.length; i++) d |= p[i] ^ q[i];
  return d === 0;
}

async function subId(endpoint) {
  const h = await crypto.subtle.digest('SHA-256', enc(endpoint));
  return hex(new Uint8Array(h)).slice(0, 32);
}

// ─────────── VAPID 키 ───────────
async function getVapid(env) {
  let v = await env.DB.get('vapid', 'json');
  if (!v) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    v = { publicKey: b64u(raw), privateJwk: jwk };
    await env.DB.put('vapid', JSON.stringify(v));
  }
  return v;
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
