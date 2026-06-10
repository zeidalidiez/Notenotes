/**
 * SnippetShare - encode a MIDI/drum snippet into a URL-safe code and back.
 *
 * "Invite a friend": a snippet becomes a link. Opening the link merges the
 * snippet into the recipient's library (or starts them off with it). Only
 * note/hit data travels - audio snippets are not shareable this way because
 * their sample data does not belong in a URL.
 *
 * The encode/decode is pure and dependency-free (no btoa/Buffer), so it runs
 * the same in the browser and in tests. Decode is strict: anything malformed,
 * oversized, or out of range is dropped, and a code that yields no usable
 * notes or hits returns null.
 */

export const SNIPPET_SHARE_PARAM = 's';
export const SNIPPET_SHARE_VERSION = 1;
export const MAX_SHARE_EVENTS = 512;   // notes + hits cap, keeps URLs sane
export const MAX_SHARE_NAME = 60;

const PPQ = 480;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// --- portable base64url over UTF-8 (no btoa / Buffer dependency) ---

function utf8Bytes(str) {
  const out = [];
  const enc = encodeURIComponent(String(str));
  for (let i = 0; i < enc.length; i++) {
    if (enc[i] === '%') { out.push(parseInt(enc.substr(i + 1, 2), 16)); i += 2; }
    else out.push(enc.charCodeAt(i));
  }
  return out;
}

function bytesToUtf8(bytes) {
  let enc = '';
  for (const b of bytes) enc += '%' + (b & 0xff).toString(16).padStart(2, '0');
  return decodeURIComponent(enc);
}

function bytesToBase64Url(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    const n = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64[n & 63];
  }
  return out;
}

function base64UrlToBytes(str) {
  const lookup = {};
  for (let i = 0; i < B64.length; i++) lookup[B64[i]] = i;
  const bytes = [];
  for (let i = 0; i < str.length; i += 4) {
    const c0 = lookup[str[i]], c1 = lookup[str[i + 1]];
    if (c0 === undefined || c1 === undefined) break;
    bytes.push((c0 << 2) | (c1 >> 4));
    const c2 = lookup[str[i + 2]];
    if (c2 === undefined) break;
    bytes.push(((c1 & 15) << 4) | (c2 >> 2));
    const c3 = lookup[str[i + 3]];
    if (c3 === undefined) break;
    bytes.push(((c2 & 3) << 6) | c3);
  }
  return bytes;
}

// --- value coercion ---

const int = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function cleanName(name) {
  // A shared name is attacker-controlled, and several places in the app render
  // snippet names into innerHTML. Strip HTML/attribute-breaking characters and
  // control chars at the boundary so a crafted link can never carry markup,
  // independent of any one renderer remembering to escape. (Output escaping is
  // still applied at the render sites; this is defense-in-depth.)
  return (typeof name === 'string' ? name : '')
    .replace(/[<>"]/g, '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SHARE_NAME);
}

/**
 * Encode a snippet into a URL-safe share code, or null when it cannot be
 * shared (audio, or no note/hit content).
 */
export function encodeSnippetShare(snippet) {
  if (!snippet || (snippet.type !== 'midi' && snippet.type !== 'drum')) return null;
  const notes = Array.isArray(snippet.notes) ? snippet.notes : [];
  const hits = Array.isArray(snippet.hits) ? snippet.hits : [];
  if (!notes.length && !hits.length) return null;

  const N = notes.slice(0, MAX_SHARE_EVENTS).map(n => [
    clamp(int(n.pitch) ?? 60, 0, 127),
    Math.max(0, int(n.startTick) ?? 0),
    Math.max(1, int(n.durationTick) ?? PPQ),
    clamp(Math.round((Number(n.velocity) || 0.8) * 100), 1, 127),
  ]);
  const H = hits.slice(0, MAX_SHARE_EVENTS).map(h => [
    String(h.type || 'kick').slice(0, 16),
    Math.max(0, int(h.startTick) ?? 0),
    clamp(Math.round((Number(h.velocity) || 0.8) * 100), 1, 127),
  ]);

  const payload = {
    v: SNIPPET_SHARE_VERSION,
    t: snippet.type,
    nm: cleanName(snippet.name),
    d: Math.max(PPQ, int(snippet.durationTicks) ?? PPQ),
    b: clamp(int(snippet.bpm) ?? 120, 40, 240),
    N,
    H,
  };
  return bytesToBase64Url(utf8Bytes(JSON.stringify(payload)));
}

/**
 * Decode a share code into a sanitized snippet (no id / createdAt - the
 * importer assigns those). Returns null for anything malformed or empty.
 */
export function decodeSnippetShare(code) {
  if (typeof code !== 'string' || !code) return null;
  let payload;
  try {
    payload = JSON.parse(bytesToUtf8(base64UrlToBytes(code)));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  if (payload.v !== SNIPPET_SHARE_VERSION) return null;
  if (payload.t !== 'midi' && payload.t !== 'drum') return null;

  const rawN = Array.isArray(payload.N) ? payload.N.slice(0, MAX_SHARE_EVENTS) : [];
  const rawH = Array.isArray(payload.H) ? payload.H.slice(0, MAX_SHARE_EVENTS) : [];

  const notes = [];
  for (const e of rawN) {
    if (!Array.isArray(e)) continue;
    const pitch = int(e[0]); const startTick = int(e[1]); const durationTick = int(e[2]); const vel = int(e[3]);
    if (pitch === null || pitch < 0 || pitch > 127) continue;
    notes.push({
      pitch,
      startTick: Math.max(0, startTick ?? 0),
      durationTick: Math.max(1, durationTick ?? PPQ),
      velocity: clamp((vel ?? 80) / 100, 0.01, 1),
    });
  }
  const hits = [];
  for (const e of rawH) {
    if (!Array.isArray(e)) continue;
    const type = String(e[0] || '').slice(0, 16);
    const startTick = int(e[1]); const vel = int(e[2]);
    if (!type) continue;
    hits.push({ type, startTick: Math.max(0, startTick ?? 0), velocity: clamp((vel ?? 80) / 100, 0.01, 1) });
  }
  if (!notes.length && !hits.length) return null;

  const maxEnd = Math.max(
    0,
    ...notes.map(n => n.startTick + n.durationTick),
    ...hits.map(h => h.startTick + 1),
  );
  const durationTicks = Math.max(int(payload.d) ?? PPQ, Math.ceil((maxEnd + PPQ) / PPQ) * PPQ);

  return {
    type: payload.t,
    name: cleanName(payload.nm) || 'Shared snippet',
    notes,
    hits,
    durationTicks,
    bpm: clamp(int(payload.b) ?? 120, 40, 240),
  };
}

/** Build a shareable URL for a snippet, or null if it can't be shared. */
export function shareUrlForSnippet(snippet, baseUrl) {
  const code = encodeSnippetShare(snippet);
  if (!code) return null;
  const base = String(baseUrl || '').split('#')[0].split('?')[0];
  return `${base}?${SNIPPET_SHARE_PARAM}=${code}`;
}

/** Pull a shared snippet out of a location.search string, or null. */
export function sharedSnippetFromSearch(search) {
  if (typeof search !== 'string' || !search) return null;
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  const code = params.get(SNIPPET_SHARE_PARAM);
  return code ? decodeSnippetShare(code) : null;
}
