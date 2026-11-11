// 해랑경희 알림 서버 (Cloudflare Workers 무료 요금제용)
// 앱 3개가 이 서버 하나를 같이 씁니다: 학부모용(/notice/), 관리용(/notice/admin.html), 출결 태블릿(/notice/kiosk.html)
// ─────────────────────────────────────────────
// 필요한 설정 (Cloudflare 대시보드 → 이 Worker → 설정)
//   1) KV 네임스페이스 바인딩: 변수 이름 DB
//   2) 비밀 변수(Secret): ADMIN_PASSWORD  ← 관장님 비밀번호
// 푸시 서명 키(VAPID)는 처음 실행될 때 자동으로 만들어 DB에 저장합니다.
// ─────────────────────────────────────────────

const SITE = 'https://haerangtkd.github.io';
const BATCH = 40;               // 무료 요금제 외부 요청 한도(50) 안에서 한 번에 보낼 기기 수
const MAX_NOTICES = 50;         // 공개 공지 목록에 남길 개수
const RELATIONS = ['엄마', '아빠', '할머니', '할아버지', '이모', '고모', '삼촌'];

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    try {
      const url = new URL(req.url);
      return cors(await route(url.pathname, req, env));
    } catch (e) {
      return cors(json({ ok: false, error: String(e && e.message || e) }, 500));
    }
  },
};

async function route(path, req, env) {
  const b = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

  // ── 학부모용 ──
  if (path === '/vapid') return json({ ok: true, publicKey: (await getVapid(env)).publicKey });
  if (path === '/notices') return json({ ok: true, notices: (await env.DB.get('notices', 'json')) || [] });
  if (path === '/subscribe' && req.method === 'POST') {
    const s = b.subscription || {};
    if (!s.endpoint || !s.keys || !s.keys.p256dh || !s.keys.auth || !/^https:\/\//.test(s.endpoint)) return json({ ok: false, error: '구독 정보가 올바르지 않습니다' }, 400);
    const id = await subId(s.endpoint);
    const old = (await env.DB.getWithMetadata('sub:' + id)).metadata;
    // 앱을 열 때 하는 재확인(resync)은 서버에 있는 정보(관장님이 고친 이름 포함)를 그대로 유지
    const keep = b.resync && old;
    if (b.resync && !old) return json({ ok: true, removed: true }); // 관장님이 지웠거나 거절한 경우
    const children = keep ? old.c : cleanNames(b.children);
    const rel = keep ? old.r : (RELATIONS.includes(b.relation) ? b.relation : '');
    const ph = keep ? old.ph : String(b.phone4 || '').replace(/\D/g, '');
    if (!children.length || !rel || ph.length !== 4) return json({ ok: false, error: '아이 이름, 관계, 전화번호 뒷자리를 확인해 주세요' }, 400);
    // 같은 휴대폰이 같은 정보로 다시 등록하면 승인 유지, 정보가 바뀌면 다시 승인 필요
    const same = old && old.ok && old.r === rel && old.ph === ph && sameList(old.c, children);
    const meta = { e: s.endpoint, p: s.keys.p256dh, a: s.keys.auth, c: children, r: rel, ph, t: old ? old.t : Date.now(), ok: !!same };
    if (!old || JSON.stringify(old) !== JSON.stringify(meta)) await env.DB.put('sub:' + id, '1', { metadata: meta });
    return json({ ok: true, id, approved: meta.ok, children, relation: rel, phone4: ph });
  }
  if (path === '/unsubscribe' && req.method === 'POST') {
    if (b.endpoint) await env.DB.delete('sub:' + await subId(b.endpoint));
    return json({ ok: true });
  }

  // ── 출결 태블릿 ──
  if (path.startsWith('/kiosk/')) {
    const tok = String(b.token || '').replace(/[^0-9a-f]/g, '');
    if (!tok || !(await env.DB.get('kiosk:' + tok))) return json({ ok: false, error: '출결 태블릿 등록이 풀렸습니다. 관장님 비밀번호로 다시 등록해 주세요', relogin: true }, 401);
    if (path === '/kiosk/lookup') {
      const code = String(b.code || '').replace(/\D/g, '');
      const kids = (await env.DB.get('kids', 'json')) || {};
      const att = await getAtt(env);
      const found = Object.keys(kids).filter(n => kids[n].codes.includes(code)).sort((a, c) => a.localeCompare(c, 'ko'))
        .map(n => ({ name: n, in: (att[n] || {}).in || null, out: (att[n] || {}).out || null }));
      return json({ ok: true, kids: found });
    }
    if (path === '/kiosk/check') return json(await checkIn(env, b.name, b.act, '태블릿'));
  }

  // ── 관장님 전용 ──
  if (path.startsWith('/admin/')) {
    const pw = b.password || '';
    // 비밀번호를 10번 틀리면 그 인터넷 주소는 15분 동안 잠금
    const failKey = 'fail:' + (req.headers.get('cf-connecting-ip') || 'x');
    const fails = +(await env.DB.get(failKey)) || 0;
    if (fails >= 10) return json({ ok: false, error: '비밀번호를 여러 번 틀려 15분 동안 잠겼습니다' }, 429);
    if (!env.ADMIN_PASSWORD || !(await sameText(pw, env.ADMIN_PASSWORD))) {
      await env.DB.put(failKey, String(fails + 1), { expirationTtl: 900 });
      return json({ ok: false, error: '비밀번호가 맞지 않습니다' }, 401);
    }

    if (path === '/admin/status') {
      const subs = await listSubs(env);
      const kids = (await env.DB.get('kids', 'json')) || {};
      const att = await getAtt(env);
      const list = Object.keys(kids).sort((a, c) => a.localeCompare(c, 'ko')).map(n => ({
        name: n, codes: kids[n].codes, today: att[n] || {},
        guardians: subs.filter(s => s.ok && s.c.includes(n)).map(s => ({ id: s.key.slice(4), rel: s.r, ph: s.ph })),
      }));
      const pending = subs.filter(s => !s.ok).sort((a, c) => c.t - a.t).map(s => ({ id: s.key.slice(4), children: s.c, rel: s.r, ph: s.ph, at: s.t }));
      return json({ ok: true, devices: subs.length, kids: list, pending });
    }
    if (path === '/admin/approve') {
      const key = 'sub:' + String(b.id || '').replace(/[^0-9a-f]/g, '');
      const r = await env.DB.getWithMetadata(key);
      if (!r.metadata) return json({ ok: false, error: '이미 지워진 등록입니다' });
      if (!b.approve) { await env.DB.delete(key); return json({ ok: true }); }
      // 승인하면 아이를 명단에 넣고, 학부모 전화 뒷자리를 출결번호로 연결
      const kids = (await env.DB.get('kids', 'json')) || {};
      for (const n of r.metadata.c) {
        kids[n] = kids[n] || { codes: [], at: Date.now() };
        if (r.metadata.ph && !kids[n].codes.includes(r.metadata.ph)) kids[n].codes.push(r.metadata.ph);
      }
      await env.DB.put('kids', JSON.stringify(kids));
      await env.DB.put(key, '1', { metadata: { ...r.metadata, ok: true } });
      return json({ ok: true });
    }
    if (path === '/admin/remove-device') {
      await env.DB.delete('sub:' + String(b.id || '').replace(/[^0-9a-f]/g, ''));
      return json({ ok: true });
    }
    if (path === '/admin/kid-save') {
      const name = cleanNames([b.name])[0];
      const codes = [...new Set((Array.isArray(b.codes) ? b.codes : []).map(c => String(c).replace(/\D/g, '')).filter(c => c.length === 4))].slice(0, 6);
      if (!name) return json({ ok: false, error: '이름을 확인해 주세요' });
      const kids = (await env.DB.get('kids', 'json')) || {};
      const old = b.oldName && kids[b.oldName];
      if (b.oldName && b.oldName !== name) {
        delete kids[b.oldName];
        await renameInSubs(env, b.oldName, name);
      }
      kids[name] = { ...(old || kids[name] || { at: Date.now() }), codes };
      await env.DB.put('kids', JSON.stringify(kids));
      return json({ ok: true });
    }
    if (path === '/admin/kid-delete') {
      const kids = (await env.DB.get('kids', 'json')) || {};
      delete kids[b.name];
      await env.DB.put('kids', JSON.stringify(kids));
      return json({ ok: true });
    }
    if (path === '/admin/check') return json(await checkIn(env, b.name, b.act, '관리'));
    if (path === '/admin/send') return json(await send(env, b));
    if (path === '/admin/delete-notice') {
      const list = ((await env.DB.get('notices', 'json')) || []).filter(n => n.id !== b.id);
      await env.DB.put('notices', JSON.stringify(list));
      return json({ ok: true });
    }
    if (path === '/admin/kiosk-token') {
      const tok = hex(crypto.getRandomValues(new Uint8Array(16)));
      await env.DB.put('kiosk:' + tok, String(Date.now()));
      return json({ ok: true, token: tok });
    }
    if (path === '/admin/kiosk-reset') {
      const r = await env.DB.list({ prefix: 'kiosk:' });
      await Promise.all(r.keys.map(k => env.DB.delete(k.name)));
      return json({ ok: true, removed: r.keys.length });
    }
  }
  return json({ ok: false, error: 'not found' }, 404);
}

// ── 등원·하원 처리 (태블릿·관리 화면 공통) ──
async function checkIn(env, name, act, by) {
  if (act !== 'in' && act !== 'out') return { ok: false, error: 'act' };
  const kids = (await env.DB.get('kids', 'json')) || {};
  if (!kids[name]) return { ok: false, error: '명단에 없는 아이입니다' };
  const now = new Date();
  const t = kstTime(now);
  const day = kstDay(now);
  const att = (await env.DB.get('att:' + day, 'json')) || {};
  att[name] = act === 'in' ? { in: t } : { ...(att[name] || {}), out: t };
  await env.DB.put('att:' + day, JSON.stringify(att), { expirationTtl: 60 * 60 * 24 * 40 });
  const body = act === 'in'
    ? name + ' 학생이 ' + t + '에 도장에 도착했습니다.'
    : name + ' 학생이 ' + t + '에 수련을 마치고 하원했습니다.';
  const r = await send(env, { kind: act === 'in' ? '등원' : '하원', title: (act === 'in' ? '등원 알림' : '하원 알림') + ' · ' + name, body, children: [name] });
  return { ok: true, time: t, sent: r.sent || 0, total: r.total || 0, by };
}

async function getAtt(env) { return (await env.DB.get('att:' + kstDay(new Date()), 'json')) || {}; }
function kst(d) { return new Date(d.getTime() + 9 * 3600 * 1000); }
function kstDay(d) { return kst(d).toISOString().slice(0, 10); }
function kstTime(d) { const k = kst(d); const h = k.getUTCHours(), m = k.getUTCMinutes(); return (h < 12 ? '오전 ' : '오후 ') + ((h % 12) || 12) + '시' + (m ? ' ' + m + '분' : ''); }

async function renameInSubs(env, from, to) {
  const subs = await listSubs(env);
  await Promise.all(subs.filter(s => s.c.includes(from)).map(s => {
    const { key, ...meta } = s;
    meta.c = [...new Set(s.c.map(c => (c === from ? to : c)))];
    return env.DB.put(key, '1', { metadata: meta });
  }));
}

// 발송: children 이 비어 있으면 전체, 있으면 그 아이의 승인된 보호자 휴대폰에만
// 관리 화면이 offset 을 늘려 가며 여러 번 불러 BATCH 개씩 보냅니다.
async function send(env, b) {
  const title = String(b.title || '').slice(0, 80).trim();
  const body = String(b.body || '').slice(0, 500).trim();
  const kind = String(b.kind || '공지').slice(0, 10);
  if (!title) return { ok: false, error: '제목이 비어 있습니다' };
  const targets = cleanNames(b.children);
  const offset = Math.max(0, b.offset | 0);
  const msgId = b.msgId || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));

  if (offset === 0 && targets.length === 0) {
    const list = (await env.DB.get('notices', 'json')) || [];
    if (!list.some(n => n.id === msgId)) {
      list.unshift({ id: msgId, kind, title, body, at: Date.now() });
      await env.DB.put('notices', JSON.stringify(list.slice(0, MAX_NOTICES)));
    }
  }

  let subs = await listSubs(env);
  if (targets.length) subs = subs.filter(s => s.ok && s.c.some(c => targets.includes(c)));
  const total = subs.length;
  const slice = subs.slice(offset, offset + BATCH);
  const vapid = await getVapid(env);
  const payload = JSON.stringify({
    title, body, kind,
    url: SITE + '/notice/' + (targets.length ? '' : '#n-' + msgId),
    tag: (targets.length ? 'p-' : 'n-') + msgId,
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
function sameList(a, b) { return JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort()); }

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
