/* Idee — server promemoria (Cloudflare Worker + D1).
   Salva solo: id dispositivo (casuale), id idea, ora del promemoria, indirizzo push del telefono.
   Nessun testo delle idee: la notifica è "vuota" e il telefono la completa leggendo i propri dati.
   Ogni minuto (cron) invia le notifiche scadute.
   Segreto richiesto: VAPID_PRIVATE_JWK (chiave privata VAPID in formato JWK). Variabile: VAPID_PUBLIC. */

const ALLOWED_ORIGINS = ['https://ivaninstores.github.io', 'http://localhost:8765'];
const SUBJECT = 'https://ivaninstores.github.io/IDEAS/';

const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = s => new TextEncoder().encode(s);

function cors(req) {
  const o = req.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}
const json = (req, data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors(req) } });

const validDevice = d => typeof d === 'string' && /^[A-Za-z0-9_-]{32,64}$/.test(d);
const validSub = s => s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 1024;

let keyCache = null;
async function vapidKey(env) {
  if (!keyCache) keyCache = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return keyCache;
}
async function vapidJwt(env, endpoint) {
  const aud = new URL(endpoint).origin;
  const head = b64url(enc(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64url(enc(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await vapidKey(env), enc(head + '.' + body));
  return head + '.' + body + '.' + b64url(sig);
}
// Push senza contenuto: il service worker dell'app mostra la notifica giusta leggendo i dati locali.
async function sendPush(env, sub) {
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: `vapid t=${await vapidJwt(env, sub.endpoint)}, k=${env.VAPID_PUBLIC}`, TTL: '86400', Urgency: 'high', 'Content-Length': '0' },
  });
  return r.status;
}

async function handle(req, env) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname === '/') return json(req, { ok: true, app: 'idee-promemoria' });
  if (req.method !== 'POST') return json(req, { error: 'method' }, 405);
  let b; try { b = await req.json(); } catch { return json(req, { error: 'json' }, 400); }
  if (!validDevice(b.device)) return json(req, { error: 'device' }, 400);

  // Sostituisce tutti i promemoria futuri del dispositivo (chiamata idempotente).
  if (url.pathname === '/sync') {
    if (!validSub(b.sub)) return json(req, { error: 'sub' }, 400);
    const list = (Array.isArray(b.reminders) ? b.reminders : []).slice(0, 500)
      .filter(r => typeof r.idea === 'string' && r.idea.length < 64 && Number.isFinite(r.at));
    const sub = JSON.stringify({ endpoint: b.sub.endpoint, keys: b.sub.keys || {} });
    const stmts = [env.DB.prepare('DELETE FROM reminders WHERE device = ?1 AND sent = 0').bind(b.device)];
    for (const r of list) stmts.push(env.DB.prepare(
      'INSERT INTO reminders (device, idea, at, sub, sent) VALUES (?1, ?2, ?3, ?4, 0) ON CONFLICT(device, idea) DO UPDATE SET at = ?3, sub = ?4, sent = 0'
    ).bind(b.device, r.idea, Math.round(r.at), sub));
    await env.DB.batch(stmts);
    return json(req, { ok: true, count: list.length });
  }
  // Notifica di prova immediata.
  if (url.pathname === '/test') {
    if (!validSub(b.sub)) return json(req, { error: 'sub' }, 400);
    const status = await sendPush(env, b.sub);
    return json(req, { ok: status < 300, status });
  }
  // Disattiva: cancella tutto del dispositivo.
  if (url.pathname === '/forget') {
    await env.DB.prepare('DELETE FROM reminders WHERE device = ?1').bind(b.device).run();
    return json(req, { ok: true });
  }
  return json(req, { error: 'not found' }, 404);
}

async function tick(env) {
  const now = Date.now();
  const { results } = await env.DB.prepare('SELECT device, idea, sub FROM reminders WHERE sent = 0 AND at <= ?1 ORDER BY at LIMIT 40').bind(now + 30000).all();
  if (!results.length) return;
  // un solo push per dispositivo: il telefono mostra tutte le idee scadute
  const byDevice = new Map();
  for (const r of results) { if (!byDevice.has(r.device)) byDevice.set(r.device, { sub: JSON.parse(r.sub), ideas: [] }); byDevice.get(r.device).ideas.push(r.idea); }
  const stmts = [];
  for (const [device, { sub, ideas }] of byDevice) {
    let status = 0;
    try { status = await sendPush(env, sub); } catch { status = 0; }
    if (status === 404 || status === 410) stmts.push(env.DB.prepare('DELETE FROM reminders WHERE device = ?1').bind(device));
    else if (status && status < 300) for (const i of ideas) stmts.push(env.DB.prepare('UPDATE reminders SET sent = 1 WHERE device = ?1 AND idea = ?2').bind(device, i));
  }
  // pulizia: promemoria inviati da più di 30 giorni
  stmts.push(env.DB.prepare('DELETE FROM reminders WHERE sent = 1 AND at < ?1').bind(now - 30 * 864e5));
  await env.DB.batch(stmts);
}

export default {
  fetch: (req, env) => handle(req, env).catch(e => json(req, { error: String(e?.message || e) }, 500)),
  scheduled: (ev, env, ctx) => ctx.waitUntil(tick(env)),
};
