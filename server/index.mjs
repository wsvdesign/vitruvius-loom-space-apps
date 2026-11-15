/**
 * Vitruvius Loom API. Zero dependencies (Node 24: node:http + fetch).
 *
 *   npm run api        (node --env-file-if-exists=.env server/index.mjs)
 *
 *   GET  /api/health          { ok, ask, tiles }: whether each feature is configured, nothing else
 *   GET  /api/tiles/:world    Cesium ion endpoint for moon | mars: { type, url, accessToken, attributions, fetchedAt }
 *                             The ion token stays here; the browser gets ion's short-lived accessToken only.
 *   POST /api/ask             { question, world? } -> { answer, sources, grounded }, answered only from server/facts
 *
 * Same-origin only (no CORS headers). Logs method, path, status and time; never bodies, headers or keys.
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, normalize, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateAsk,
  normalizeFacts,
  factsFromGinny,
  pickFacts,
  retrieve,
  buildGeminiRequest,
  extractGeminiText,
  checkReply,
  safeReply,
  createRateLimiter,
  clientIp,
  pickIonEndpoint,
} from './core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FACTS_PATH = join(ROOT, 'server', 'facts', 'nasa-facts.json');
const GINNY_PATH = join(ROOT, 'src', 'content', 'ginny.json');

const PORT = Number(process.env.API_PORT || process.env.PORT || 8787);
const HOST = process.env.API_HOST || '127.0.0.1';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

const ION_ASSETS = { moon: 2684829, mars: 3644333 };
const TILE_CACHE_MS = 45 * 60 * 1000; // ion's endpoint tokens last about an hour
const ION_TIMEOUT_MS = 10_000;
const ASK_TIMEOUT_MS = 12_000;
const MAX_BODY = 4096;

const env = (name) => (typeof process.env[name] === 'string' ? process.env[name].trim() : '');
const has = (name) => env(name).length > 0;

/* ---------- responses ---------- */

const BASE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

function send(res, status, body, headers = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { ...BASE_HEADERS, ...headers });
  res.end(JSON.stringify(body));
}

const MESSAGES = {
  'not-found': 'Nothing here.',
  'method-not-allowed': 'That isn’t allowed here.',
  'cross-origin': 'That isn’t allowed here.',
  'unsupported-type': 'Send the question as JSON.',
  'too-large': 'That question is too long.',
  'invalid-question': 'Ask a question between 1 and 300 characters.',
  'personal-info': 'Please leave out personal details like your name, email, address or phone number, then ask again.',
  'ask-not-configured': 'Ginny can’t take new questions yet.',
  'too-many-questions': 'That’s a lot of questions! Give Ginny a minute to catch up.',
  'ask-timeout': 'Ginny took too long to think. Try asking again.',
  'ask-busy': 'Ginny is answering lots of questions right now. Try again in a minute.',
  'ask-failed': 'Ginny couldn’t answer that just now. Try again in a moment.',
  'tiles-not-configured': 'The map isn’t set up yet.',
  'tiles-unavailable': 'The map can’t load right now.',
  'server-error': 'Something went wrong. Try again in a moment.',
};
const fail = (res, status, error, headers) => send(res, status, { error, message: MESSAGES[error] }, headers);

/* ---------- data files (re-read when they change on disk) ---------- */

function cachedJson(path, normalize) {
  let cache = { mtimeMs: -1, data: [] };
  return async () => {
    try {
      const s = await stat(path);
      if (s.mtimeMs !== cache.mtimeMs) cache = { mtimeMs: s.mtimeMs, data: normalize(JSON.parse(await readFile(path, 'utf8'))) };
    } catch {
      cache = { mtimeMs: -1, data: [] }; // missing or half-written: try again next time
    }
    return cache.data;
  };
}
const nasaFacts = cachedJson(FACTS_PATH, normalizeFacts);
const ginnyFacts = cachedJson(GINNY_PATH, factsFromGinny);
const loadFacts = async () => pickFacts(await nasaFacts(), await ginnyFacts());

/* ---------- tiles ---------- */

const tileCache = new Map(); // world -> { data, at }
const tileInflight = new Map();

class Upstream extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function ionEndpoint(world) {
  const cached = tileCache.get(world);
  if (cached && Date.now() - cached.at < TILE_CACHE_MS) return Promise.resolve(cached.data);
  if (tileInflight.has(world)) return tileInflight.get(world);
  const p = (async () => {
    let r;
    try {
      r = await fetch(`https://api.cesium.com/v1/assets/${ION_ASSETS[world]}/endpoint`, {
        headers: { authorization: `Bearer ${env('CESIUM_ION_TOKEN')}` },
        signal: AbortSignal.timeout(ION_TIMEOUT_MS),
      });
    } catch (e) {
      throw new Upstream(e?.name === 'TimeoutError' ? 504 : 502, 'tiles-unavailable');
    }
    if (!r.ok) {
      await r.body?.cancel().catch(() => {});
      console.warn(`tiles upstream status ${r.status}`);
      throw new Upstream(502, 'tiles-unavailable');
    }
    const picked = pickIonEndpoint(await r.json().catch(() => null));
    if (!picked) throw new Upstream(502, 'tiles-unavailable');
    const data = { ...picked, fetchedAt: new Date().toISOString() };
    tileCache.set(world, { data, at: Date.now() });
    return data;
  })().finally(() => tileInflight.delete(world));
  tileInflight.set(world, p);
  return p;
}

async function handleTiles(req, res, world) {
  if (req.method !== 'GET') return fail(res, 405, 'method-not-allowed', { allow: 'GET' });
  if (!Object.hasOwn(ION_ASSETS, world)) return fail(res, 404, 'not-found');
  if (!has('CESIUM_ION_TOKEN')) return fail(res, 503, 'tiles-not-configured');
  // the 3D Tiles ion plugin appends ?access_token=<placeholder>; it is ignored and never forwarded
  try {
    send(res, 200, await ionEndpoint(world));
  } catch (e) {
    if (e instanceof Upstream) return fail(res, e.status, e.code);
    throw e;
  }
}

/* ---------- Gemini access: Google sign-in (no key) through Vertex AI ----------
   The project's Google organisation disallows API keys, so the path is Vertex AI with Application
   Default Credentials: on Google Cloud Run the service's own identity (metadata server), on a laptop
   the `gcloud auth login --update-adc` sign-in. No key or token is ever logged or returned. */

const askConfigured = () => has('GOOGLE_CLOUD_PROJECT');
let googleToken = { value: '', expiresAt: 0 };

async function getGoogleToken() {
  if (googleToken.value && Date.now() < googleToken.expiresAt - 60_000) return googleToken.value;
  // on Google Cloud (Cloud Run): the metadata server hands out short-lived tokens
  if (process.env.K_SERVICE) try {
    const r = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(800),
    });
    if (r.ok) {
      const j = await r.json();
      googleToken = { value: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
      return googleToken.value;
    }
  } catch {
    /* not on Google Cloud */
  }
  // on a laptop: the user's ADC sign-in (refresh token → short-lived access token)
  const file = env('GOOGLE_APPLICATION_CREDENTIALS') || join(process.env.HOME || '', '.config', 'gcloud', 'application_default_credentials.json');
  const cred = JSON.parse(await readFile(file, 'utf8'));
  if (cred.type !== 'authorized_user') throw new Error('unsupported-credentials');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cred.client_id, client_secret: cred.client_secret, refresh_token: cred.refresh_token, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`token ${r.status}`);
  const j = await r.json();
  googleToken = { value: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
  return googleToken.value;
}

async function callGemini(model, body, signal) {
  const project = env('GOOGLE_CLOUD_PROJECT');
  const loc = /^[a-z0-9-]+$/.test(env('VERTEX_LOCATION')) ? env('VERTEX_LOCATION') : 'global';
  const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
  const token = await getGoogleToken();
  return fetch(`https://${host}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(loc)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-goog-user-project': project },
    body: JSON.stringify(body),
    signal,
  });
}

/* ---------- ask ---------- */

const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 });
const siteLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 }); // whole site: caps AI cost
let askInFlight = 0;
const ASK_MAX_IN_FLIGHT = 4;

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length']) > limit) return reject(new Upstream(413, 'too-large'));
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > limit) {
        done = true;
        reject(new Upstream(413, 'too-large'));
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!done) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', () => {
      if (!done) reject(new Upstream(400, 'invalid-question'));
    });
  });
}

async function handleAsk(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed', { allow: 'POST' });
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return fail(res, 415, 'unsupported-type');

  let raw;
  try {
    raw = await readBody(req, MAX_BODY);
  } catch (e) {
    return fail(res, e.status || 400, e.code || 'invalid-question', { connection: 'close' });
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(res, 400, 'invalid-question');
  }
  const v = validateAsk(body);
  if (!v.ok) return fail(res, 400, v.reason === 'personal-info' ? 'personal-info' : 'invalid-question');

  if (!askConfigured()) return fail(res, 503, 'ask-not-configured');

  const ip = clientIp(req.socket.remoteAddress, req.headers['x-forwarded-for'], TRUST_PROXY);
  const rl = limiter(ip);
  if (!rl.ok) return fail(res, 429, 'too-many-questions', { 'retry-after': String(rl.retryAfterSec) });
  if (askInFlight >= ASK_MAX_IN_FLIGHT || !siteLimiter('site').ok) return fail(res, 503, 'ask-busy');
  askInFlight++;
  res.on('close', () => { askInFlight--; });

  const facts = retrieve(await loadFacts(), v.question, v.world);
  const model = env('GEMINI_MODEL') || 'gemini-3.8-flash';
  const signal = AbortSignal.timeout(ASK_TIMEOUT_MS);

  let json;
  try {
    const r = await callGemini(model, buildGeminiRequest({ question: v.question, world: v.world, facts, model }), signal);
    if (!r.ok) {
      await r.body?.cancel().catch(() => {});
      console.warn(`ask upstream status ${r.status}`);
      const busy = r.status === 429 || r.status === 503;
      return fail(res, busy ? 503 : 502, busy ? 'ask-busy' : 'ask-failed');
    }
    json = await r.json();
  } catch (e) {
    if (e?.name === 'TimeoutError' || signal.aborted) return fail(res, 504, 'ask-timeout');
    return fail(res, 502, 'ask-failed');
  }

  const out = extractGeminiText(json);
  if (out.blocked) return send(res, 200, withSpeech(safeReply(facts)));
  const reply = checkReply(out.text, facts);
  if (!reply) return fail(res, 502, 'ask-failed');
  send(res, 200, withSpeech(reply));
}

/* ---------- Ginny's voice for live answers ----------
   Kokoro (open source, Apache-2.0) runs here on the server, in the voice chosen in src/content/ginny.json.
   Only text this server just answered can be spoken: each answer gets a one-time id, so the route
   can't be used as a general text-to-speech service. */

const SPEECH_TTL_MS = 30 * 60 * 1000;
const SPEECH_MAX = 20;
let speechBusy = false;
const speech = new Map(); // id -> { text, at }
let ttsPromise = null;

function loadTts() {
  ttsPromise ??= (async () => {
    const { KokoroTTS } = await import('kokoro-js');
    return KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' });
  })().catch((e) => {
    ttsPromise = null;
    throw e;
  });
  return ttsPromise;
}

async function ginnyVoiceId() {
  try {
    return JSON.parse(await readFile(GINNY_PATH, 'utf8')).voice?.voiceId || 'af_heart';
  } catch {
    return 'af_heart';
  }
}

function rememberSpeech(text) {
  const now = Date.now();
  for (const [k, v] of speech) if (now - v.at > SPEECH_TTL_MS || speech.size >= SPEECH_MAX) speech.delete(k);
  const id = randomUUID();
  speech.set(id, { text, at: now });
  return `/api/speech/${id}`;
}

const withSpeech = (reply) => (reply?.answer ? { ...reply, speechUrl: rememberSpeech(reply.answer) } : reply);

/** Kokoro gives 32-bit float WAV; send 16-bit PCM instead (a quarter of the size). */
function toPcm16Wav(float) {
  const view = new DataView(float.buffer, float.byteOffset, float.byteLength);
  const rate = view.getUint32(24, true);
  let off = 12;
  while (off < view.byteLength - 8 && view.getUint32(off, false) !== 0x64617461) off += 8 + view.getUint32(off + 4, true); // 'data'
  const n = view.getUint32(off + 4, true) / 4;
  const out = Buffer.alloc(44 + n * 2);
  out.write('RIFF', 0); out.writeUInt32LE(36 + n * 2, 4); out.write('WAVE', 8); out.write('fmt ', 12);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, view.getFloat32(off + 8 + i * 4, true)));
    out.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return out;
}

async function handleSpeech(req, res, id) {
  if (req.method !== 'GET') return fail(res, 405, 'method-not-allowed', { allow: 'GET' });
  const item = speech.get(id);
  if (!item) return fail(res, 404, 'not-found');
  speech.delete(id); // each link plays once
  if (speechBusy) return fail(res, 503, 'ask-busy'); // one voice at a time keeps the server responsive
  speechBusy = true;
  let wav;
  try {
    const tts = await loadTts();
    const audio = await tts.generate(item.text, { voice: await ginnyVoiceId() });
    wav = toPcm16Wav(Buffer.from(audio.toWav()));
  } catch {
    return fail(res, 503, 'server-error');
  } finally {
    speechBusy = false;
  }
  if (res.headersSent) return;
  res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wav.length, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' });
  res.end(wav);
}

/* ---------- the website itself (production): files from dist/, same origin as /api ---------- */

const DIST = join(ROOT, 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm',
  '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
// browsers may only load what the app needs: our own files, Cesium's tile host, Google Fonts
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' https://assets.ion.cesium.com blob: data:",
  "img-src 'self' data: blob: https://assets.ion.cesium.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

async function serveStatic(req, res, path) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'method-not-allowed', { allow: 'GET, HEAD' });
  let rel = decodeURIComponent(path).replace(/^\/+/, '');
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  let file = normalize(join(DIST, rel));
  if (!file.startsWith(DIST + sep)) return fail(res, 404, 'not-found');
  let body;
  try {
    body = await readFile(file);
  } catch {
    if (extname(rel)) return fail(res, 404, 'not-found');
    file = join(DIST, 'index.html'); // app routes fall back to the page
    body = await readFile(file);
  }
  const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
  const hashed = /\/assets\/.+-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(file);
  res.writeHead(200, {
    'content-type': type,
    'content-length': body.length,
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    ...(type.startsWith('text/html') ? { 'content-security-policy': CSP } : {}),
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

/* ---------- server ---------- */

const clean = (s) => String(s).replace(/[^\x20-\x7e]/g, '?').slice(0, 120);

function crossSite(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return true;
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

const server = http.createServer(async (req, res) => {
  const t0 = performance.now();
  let path = '/';
  try {
    path = new URL(req.url || '/', 'http://local').pathname;
  } catch {
    /* keep '/' */
  }
  res.on('finish', () => {
    console.log(`${req.method} ${clean(path)} ${res.statusCode} ${Math.round(performance.now() - t0)}ms`);
  });

  try {
    if (crossSite(req)) return fail(res, 403, 'cross-origin');
    if (path === '/api/health') {
      if (req.method !== 'GET') return fail(res, 405, 'method-not-allowed', { allow: 'GET' });
      return send(res, 200, { ok: true, ask: askConfigured(), tiles: has('CESIUM_ION_TOKEN') });
    }
    const tiles = /^\/api\/tiles\/([^/]+)\/?$/.exec(path);
    if (tiles) return await handleTiles(req, res, tiles[1]);
    if (path === '/api/ask') return await handleAsk(req, res);
    const sp = /^\/api\/speech\/([0-9a-f-]{36})$/.exec(path);
    if (sp) return await handleSpeech(req, res, sp[1]);
    if (path.startsWith('/api/')) return fail(res, 404, 'not-found');
    if (process.env.SERVE_STATIC === '1') return await serveStatic(req, res, path);
    return fail(res, 404, 'not-found');
  } catch (e) {
    console.error(`error ${clean(e?.name || 'Error')} on ${clean(path)}`);
    return fail(res, 500, 'server-error');
  }
});

server.requestTimeout = 20_000;
server.headersTimeout = 10_000;

process.on('unhandledRejection', (e) => console.error(`unhandled ${clean(e?.name || 'rejection')}`));

if (askConfigured()) loadTts().catch(() => {});

server.listen(PORT, HOST, () => {
  console.log(`API on http://${HOST}:${PORT} · ask ${askConfigured() ? 'on (Vertex AI)' : 'off'} · tiles ${has('CESIUM_ION_TOKEN') ? 'on' : 'off'}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
