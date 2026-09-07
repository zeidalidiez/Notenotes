/**
 * SamplePack — lazy loader for the built-in CC0 sample instruments.
 *
 * Built-in instruments ship as small MP3 zones under public/packs/<id>/ with a
 * manifest.json (and a top-level public/packs/index.json listing them). Nothing
 * is loaded until a user actually selects an instrument; once fetched, zones are
 * cached in Cache Storage so the instrument works offline forever after.
 *
 * The PWA shell excludes those zones from its precache, keeping first load small;
 * users can cache one on first use or explicitly cache the whole library.
 */
import { AudioEngine } from '../engine/AudioEngine.js';
import { SAMPLE_PACK_INDEX } from '../engine/InstrumentRegistry.js';

const PACKS_BASE = `${(import.meta.env && import.meta.env.BASE_URL) || '/'}packs`;
const CACHE_NAME = 'nn-sample-packs-v2';

const _instrumentCache = new Map(); // id -> Promise<patch>
const _loadedInstruments = new Map(); // id -> resolved patch

/** Fetch through Cache Storage so packs are available offline after first use. */
async function cachedFetch(url) {
  // Cache lookups are best-effort: skip if CacheStorage is unavailable.
  let cache = null;
  try { cache = await caches.open(CACHE_NAME); } catch (_) { cache = null; }
  if (cache) {
    const hit = await cache.match(url);
    if (hit) return hit;
  }
  // Retry transient network failures (e.g. a connection momentarily refused while
  // many zone files load at once / during fast instrument switching). This self-
  // heals instead of failing the whole instrument on the first blip.
  let res = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 3 && !res; attempt++) {
    try {
      res = await fetch(url);
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 140 * (attempt + 1)));
    }
  }
  if (!res) throw lastErr || new Error(`Failed to fetch ${url}`);
  // Never cache an SPA-fallback HTML page (a missing file) as if it were audio.
  const type = res.headers.get('content-type') || '';
  if (cache && res.ok && !type.includes('text/html')) {
    try { await cache.put(url, res.clone()); } catch (_) {}
  }
  return res;
}

/** Fetch a manifest/zone through the same offline cache used by live playback. */
export function fetchSamplePackAsset(relativePath) {
  const path = String(relativePath || '').replace(/^\/+/, '');
  return cachedFetch(`${PACKS_BASE}/${path}`);
}

export async function isSampleInstrumentCached(id) {
  if (typeof caches === 'undefined') return false;
  try {
    const cache = await caches.open(CACHE_NAME);
    const base = `${PACKS_BASE}/${id}`;
    const manifestResponse = await cache.match(`${base}/manifest.json`);
    if (!manifestResponse) return false;
    const manifest = await manifestResponse.json();
    const checks = await Promise.all(
      (manifest.zones || []).map(zone => cache.match(`${base}/${zone.file}`))
    );
    return checks.length > 0 && checks.every(Boolean);
  } catch {
    return false;
  }
}

export async function cachedSampleInstrumentIds() {
  const states = await Promise.all(
    SAMPLE_PACK_INDEX.map(async instrument => [instrument.id, await isSampleInstrumentCached(instrument.id)])
  );
  return new Set(states.filter(([, cached]) => cached).map(([id]) => id));
}

/** Cache raw pack assets without decoding or requiring an AudioContext. */
export async function cacheSampleInstrument(id) {
  if (typeof caches === 'undefined') {
    throw new Error('Offline sample storage is unavailable in this browser context');
  }
  const base = `${PACKS_BASE}/${id}`;
  const manifestResponse = await cachedFetch(`${base}/manifest.json`);
  const type = manifestResponse.headers.get('content-type') || '';
  if (!manifestResponse.ok || type.includes('text/html')) throw new Error(`Missing sample pack: ${id}`);
  const manifest = await manifestResponse.json();
  await mapLimit(manifest.zones || [], 4, async zone => {
    const response = await cachedFetch(`${base}/${zone.file}`);
    const zoneType = response.headers.get('content-type') || '';
    if (!response.ok || zoneType.includes('text/html')) throw new Error(`Missing sample: ${id}/${zone.file}`);
  });
  if (!(await isSampleInstrumentCached(id))) {
    throw new Error('This browser could not save the sample pack for offline use');
  }
  return true;
}

export async function cacheAllSampleInstruments(onProgress = null) {
  let completed = 0;
  for (const instrument of SAMPLE_PACK_INDEX) {
    await cacheSampleInstrument(instrument.id);
    completed += 1;
    onProgress?.({ completed, total: SAMPLE_PACK_INDEX.length, instrument });
  }
  return completed;
}

// Run async tasks with a concurrency cap so loading a many-zone instrument (or
// switching fast) doesn't open a storm of simultaneous connections.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

/** List of built-in sample instruments: [{ id, name, icon, category }]. */
export async function loadSampleIndex() {
  return SAMPLE_PACK_INDEX;
}

/**
 * Load + decode an instrument's zones and return a WebAudioSynth patch with a
 * multi-zone `sampleMap`. Cached per id; a failed load is evicted so it can retry.
 */
export async function loadSampleInstrument(id) {
  if (_loadedInstruments.has(id)) return _loadedInstruments.get(id);
  if (_instrumentCache.has(id)) return _instrumentCache.get(id);
  const promise = (async () => {
    const engine = AudioEngine.getInstance();
    if (!engine.ctx) engine.initSync();
    const ctx = engine.ctx;
    const base = `${PACKS_BASE}/${id}`;
    const manifestRes = await cachedFetch(`${base}/manifest.json`);
    const manifestType = manifestRes.headers.get('content-type') || '';
    if (!manifestRes.ok || manifestType.includes('text/html')) {
      throw new Error(`Missing manifest for "${id}" — run "node scripts/build-sample-packs.mjs" or drop the public/packs/ folder in.`);
    }
    const manifest = await manifestRes.json();
    // Cap concurrency so a 19-zone instrument (and fast switching) doesn't fire a
    // burst of simultaneous requests that the dev server may refuse under load.
    const zones = await mapLimit(manifest.zones || [], 4, async (z) => {
      const res = await cachedFetch(`${base}/${z.file}`);
      const type = res.headers.get('content-type') || '';
      if (!res.ok || type.includes('text/html')) {
        throw new Error(`Missing sample audio ${id}/${z.file} — run "node scripts/build-sample-packs.mjs" or drop the public/packs/ folder in.`);
      }
      const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      return { rootMidi: z.midi, buffer };
    });
    zones.sort((a, b) => a.rootMidi - b.rootMidi);
    if (!zones.length) throw new Error(`Sample pack "${id}" has no zones`);
    const patch = manifestToPatch(manifest, zones);
    _loadedInstruments.set(id, patch);
    return patch;
  })();
  _instrumentCache.set(id, promise);
  promise.catch(() => _instrumentCache.delete(id));
  return promise;
}

export function loadedSampleInstrument(id) {
  return _loadedInstruments.get(id) || null;
}

function manifestToPatch(manifest, zones) {
  const brightness = manifest.brightness ?? 0.8;
  const mid = zones[Math.floor(zones.length / 2)];
  return {
    type: 'sample',
    name: manifest.name,
    family: 'sample',
    sampleMap: zones,                       // [{ rootMidi, buffer }]
    sampleBuffer: mid ? mid.buffer : null,  // fallback for any single-buffer path
    rootMidi: mid ? mid.rootMidi : 60,
    playbackMode: manifest.playbackMode || 'oneShot',
    gain: manifest.gain ?? 0.5,
    envelope: manifest.envelope || { attack: 0.001, decay: 0.4, sustain: 1, release: 0.3 },
    filter: { type: 'lowpass', frequency: 1200 + brightness * 12000, Q: 0.7 },
  };
}
