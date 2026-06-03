/**
 * SamplePack — lazy loader for the built-in CC0 sample instruments.
 *
 * Built-in instruments ship as small AAC zones under public/packs/<id>/ with a
 * manifest.json (and a top-level public/packs/index.json listing them). Nothing
 * is loaded until a user actually selects an instrument; once fetched, zones are
 * cached in Cache Storage so the instrument works offline forever after.
 *
 * The core app bundles ZERO audio — this keeps size/offline behaviour unchanged
 * until the user opts into a sample instrument.
 */
import { AudioEngine } from '../engine/AudioEngine.js';

const PACKS_BASE = `${(import.meta.env && import.meta.env.BASE_URL) || '/'}packs`;
const CACHE_NAME = 'nn-sample-packs-v2';

let _indexPromise = null;
const _instrumentCache = new Map(); // id -> Promise<patch>

/** Fetch through Cache Storage so packs are available offline after first use. */
async function cachedFetch(url) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(url);
    if (hit) return hit;
    const res = await fetch(url);
    // Never cache an SPA-fallback HTML page (happens when a file is missing) —
    // otherwise a stale 200 page would masquerade as audio on later loads.
    const type = res.headers.get('content-type') || '';
    if (res && res.ok && !type.includes('text/html')) cache.put(url, res.clone());
    return res;
  } catch (_) {
    return fetch(url); // private mode / CacheStorage unavailable
  }
}

/** List of built-in sample instruments: [{ id, name, icon, category }]. */
export async function loadSampleIndex() {
  if (!_indexPromise) {
    _indexPromise = cachedFetch(`${PACKS_BASE}/index.json`)
      .then((r) => (r && r.ok ? r.json() : []))
      .catch(() => []);
  }
  return _indexPromise;
}

/**
 * Load + decode an instrument's zones and return a WebAudioSynth patch with a
 * multi-zone `sampleMap`. Cached per id; a failed load is evicted so it can retry.
 */
export async function loadSampleInstrument(id) {
  if (_instrumentCache.has(id)) return _instrumentCache.get(id);
  const promise = (async () => {
    const engine = AudioEngine.getInstance();
    if (!engine.ctx) engine.initSync();
    const ctx = engine.ctx;
    const base = `${PACKS_BASE}/${id}`;
    const manifest = await (await cachedFetch(`${base}/manifest.json`)).json();
    const zones = await Promise.all((manifest.zones || []).map(async (z) => {
      const res = await cachedFetch(`${base}/${z.file}`);
      const type = res.headers.get('content-type') || '';
      if (!res.ok || type.includes('text/html')) {
        throw new Error(`Missing sample audio ${id}/${z.file} — run "node scripts/build-sample-packs.mjs" or drop the public/packs/ folder in.`);
      }
      const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      return { rootMidi: z.midi, buffer };
    }));
    zones.sort((a, b) => a.rootMidi - b.rootMidi);
    if (!zones.length) throw new Error(`Sample pack "${id}" has no zones`);
    return manifestToPatch(manifest, zones);
  })();
  _instrumentCache.set(id, promise);
  promise.catch(() => _instrumentCache.delete(id));
  return promise;
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
