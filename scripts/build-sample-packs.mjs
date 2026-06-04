#!/usr/bin/env node
/**
 * build-sample-packs.mjs — generate Notenotes' built-in CC0 sample instruments.
 *
 * Source: Versilian Community Sample Library (VCSL) — CC0 / public domain.
 *   https://github.com/sgossner/VCSL   (no attribution required)
 *
 * What it does:
 *   1. Pulls the VCSL file tree (GitHub API), picks a small set of notes per
 *      instrument (one dynamic layer, ~every few semitones), so packs stay tiny.
 *   2. Downloads those WAVs and transcodes them to small MONO MP3 (.mp3) with
 *      leading/trailing silence trimmed, a length cap, and a gentle fade-out.
 *   3. Writes public/packs/<id>/<midi>.mp3 plus a manifest.json per instrument
 *      and a public/packs/index.json the app reads.
 *
 * Requirements: node >= 18, curl, ffmpeg (with the built-in `aac` encoder).
 * Usage:  node scripts/build-sample-packs.mjs            # all instruments
 *         node scripts/build-sample-packs.mjs glockenspiel marimba   # subset
 *
 * MP3 is used because decodeAudioData supports it on EVERY browser — including
 * open-source Chromium (Linux), which omits the AAC codec, and iOS Safari.
 * (Ogg/Opus fail in Safari; AAC fails in codec-free Chromium.) Output is CC0.
 */

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const OUT_ROOT = resolve(REPO_ROOT, 'public/packs');
const TMP = resolve(REPO_ROOT, '.sample-build-cache');
const RAW_BASE = 'https://raw.githubusercontent.com/sgossner/VCSL/master';
const TREE_API = 'https://api.github.com/repos/sgossner/VCSL/git/trees/master?recursive=1';

const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiToName = (m) => `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;

/** Parse a scientific note token (C4, A#2, A#-1) from a sample filename → MIDI (C4=60). */
function noteToMidi(token) {
  const m = /^([A-G])(#|b)?(-?\d+)$/.exec(token);
  if (!m) return null;
  let semitone = NOTE_INDEX[m[1]];
  if (m[2] === '#') semitone += 1;
  if (m[2] === 'b') semitone -= 1;
  const octave = parseInt(m[3], 10);
  return (octave + 1) * 12 + semitone;
}

/** Pull the first note-like token out of a basename. */
function midiFromFilename(basename) {
  const re = /(?:^|[_/])([A-G](?:#|b)?-?\d+)(?=[_.])/g;
  let match;
  while ((match = re.exec(basename))) {
    const midi = noteToMidi(match[1]);
    if (midi != null) return midi;
  }
  return null;
}

/**
 * Per-instrument recipe. `pick` filters the folder's files to ONE clean layer.
 * `spacing` thins zones to ~every N semitones. `cap`/`bitrate` tune size.
 * playbackMode: 'oneShot' (ring out on tap) or 'gated' (sustain while held).
 */
const INSTRUMENTS = [
  {
    id: 'grand-piano', name: 'Grand Piano', icon: '🎹', category: 'Keys',
    folder: 'Chordophones/Zithers/Grand Piano, Kawai',
    exclude: /Releases\//i, prefer: ['_v3_', '_v2_', '_v4_'],
    spacing: 4, cap: 4.2, bitrate: '96k', gain: 0.5, brightness: 0.85,
    playbackMode: 'gated', env: { attack: 0.001, decay: 0.4, sustain: 1.0, release: 0.35 },
  },
  {
    id: 'upright-piano', name: 'Upright Piano', icon: '🎹', category: 'Keys',
    folder: 'Chordophones/Zithers/Upright Piano, Yamaha',
    exclude: /Releases\//i, prefer: ['_vl2_', '_vl3_', '_vl1_'],
    spacing: 4, cap: 4.0, bitrate: '96k', gain: 0.52, brightness: 0.8,
    playbackMode: 'gated', env: { attack: 0.001, decay: 0.4, sustain: 1.0, release: 0.3 },
  },
  {
    id: 'marimba', name: 'Marimba', icon: '🎶', category: 'Mallets',
    folder: 'Idiophones/Struck Idiophones/Marimba',
    prefer: ['_med_', '_soft_', '_loud_'],
    spacing: 3, cap: 2.6, bitrate: '88k', gain: 0.62, brightness: 0.8,
    playbackMode: 'oneShot', env: { attack: 0.001, decay: 0.6, sustain: 0.7, release: 0.4 },
  },
  {
    id: 'vibraphone', name: 'Vibraphone', icon: '🎶', category: 'Mallets',
    folder: 'Idiophones/Struck Idiophones/Vibraphone', subfolder: 'Hard Mallets',
    prefer: ['_v2_', '_v3_'],
    spacing: 4, cap: 3.6, bitrate: '88k', gain: 0.6, brightness: 0.85,
    playbackMode: 'oneShot', env: { attack: 0.001, decay: 1.0, sustain: 0.8, release: 0.6 },
  },
  {
    id: 'glockenspiel', name: 'Glockenspiel', icon: '✨', category: 'Mallets',
    folder: 'Idiophones/Struck Idiophones/Glockenspiel',
    prefer: ['_medium_', '_soft_', '_loud_'],
    spacing: 3, cap: 2.6, bitrate: '88k', gain: 0.5, brightness: 0.95,
    playbackMode: 'oneShot', env: { attack: 0.001, decay: 0.8, sustain: 0.7, release: 0.5 },
  },
  {
    id: 'xylophone', name: 'Xylophone', icon: '🎵', category: 'Mallets',
    folder: 'Idiophones/Struck Idiophones/Xylophone', subfolder: 'Hard Mallets',
    prefer: ['_ff_', '_pp_'], exclude: /_close/i,
    spacing: 3, cap: 2.0, bitrate: '88k', gain: 0.5, brightness: 0.95,
    playbackMode: 'oneShot', env: { attack: 0.001, decay: 0.5, sustain: 0.4, release: 0.3 },
  },
  {
    id: 'kalimba', name: 'Kalimba', icon: '🎼', category: 'Plucked',
    folder: 'Idiophones/Plucked Idiophones/Kalimba, Kenya',
    prefer: ['_vl3_'], spacing: 0, cap: 2.6, bitrate: '88k', gain: 0.62, brightness: 0.85,
    playbackMode: 'oneShot', env: { attack: 0.001, decay: 0.6, sustain: 0.6, release: 0.5 },
  },
  {
    id: 'concert-harp', name: 'Concert Harp', icon: '🎵', category: 'Plucked',
    folder: 'Chordophones/Composite Chordophones/Concert Harp',
    octaveShift: 0, // VCSL harp is labelled at scientific pitch (verified by analysis); others are an octave low
    prefer: ['_mf', '_f'], spacing: 4, cap: 3.4, bitrate: '88k', gain: 0.6, brightness: 0.8,
    playbackMode: 'oneShot', env: { attack: 0.001, decay: 0.8, sustain: 0.8, release: 0.6 },
  },
  {
    id: 'strumstick', name: 'Strumstick', icon: '🪕', category: 'Plucked',
    folder: 'Chordophones/Composite Chordophones/Strumstick', subfolder: 'Finger',
    prefer: ['_vl2_', '_vl3_', '_vl1_'],
    spacing: 2, cap: 3.0, bitrate: '88k', gain: 0.6, brightness: 0.78,
    playbackMode: 'oneShot', env: { attack: 0.002, decay: 0.7, sustain: 0.7, release: 0.5 },
  },
  {
    id: 'tubular-bells', name: 'Tubular Bells', icon: '🔔', category: 'Bells',
    folder: 'Idiophones/Struck Idiophones/Tubular Bells 1',
    prefer: ['_ff_', '_f_', '_fff_', '_p_', '_pp_'],
    spacing: 0, cap: 4.5, bitrate: '96k', gain: 0.5, brightness: 0.9,
    playbackMode: 'oneShot', env: { attack: 0.002, decay: 1.5, sustain: 0.85, release: 0.8 },
  },
];

function sh(cmd) { return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString(); }
function encodePath(p) { return p.split('/').map(encodeURIComponent).join('/'); }

function loadTree() {
  mkdirSync(TMP, { recursive: true });
  const cache = resolve(TMP, 'vcsl-tree.json');
  if (!existsSync(cache)) {
    console.log('• fetching VCSL file tree …');
    sh(`curl -sL "${TREE_API}" -o "${cache}"`);
  }
  const tree = JSON.parse(readFileSync(cache, 'utf8')).tree || [];
  return tree.filter((x) => x.type === 'blob' && /\.(wav|flac)$/i.test(x.path));
}

/** Choose one file per note, ranked by the instrument's dynamic preference. */
function selectZones(inst, allFiles) {
  let files = allFiles.filter((x) => x.path.startsWith(inst.folder + '/'));
  if (inst.subfolder) files = files.filter((x) => x.path.includes(`/${inst.subfolder}/`));
  if (inst.exclude) files = files.filter((x) => !inst.exclude.test(x.path));

  const byNote = new Map();
  for (const f of files) {
    const base = f.path.split('/').pop();
    const midi = midiFromFilename(base);
    if (midi == null) continue;
    const rank = (() => {
      const i = (inst.prefer || []).findIndex((p) => base.includes(p));
      return i === -1 ? 999 : i;
    })();
    const rr = /rr1|_01|_1\b/.test(base) ? 0 : 1; // prefer first round-robin
    const cur = byNote.get(midi);
    if (!cur || rank < cur.rank || (rank === cur.rank && rr < cur.rr)) {
      byNote.set(midi, { path: f.path, rank, rr });
    }
  }
  let zones = [...byNote.entries()].map(([midi, v]) => ({ midi, path: v.path }))
    .sort((a, b) => a.midi - b.midi);

  // Thin to ~every `spacing` semitones (keep first & last). spacing 0 = keep all.
  if (inst.spacing > 0 && zones.length > 2) {
    const kept = [zones[0]];
    for (const z of zones.slice(1, -1)) {
      if (z.midi - kept[kept.length - 1].midi >= inst.spacing) kept.push(z);
    }
    kept.push(zones[zones.length - 1]);
    zones = kept;
  }
  return zones;
}

function buildInstrument(inst, allFiles) {
  const zones = selectZones(inst, allFiles);
  if (!zones.length) { console.warn(`  ! ${inst.id}: no zones matched — skipping`); return null; }
  const outDir = resolve(OUT_ROOT, inst.id);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // VCSL filename octave convention varies by contributor; shift parsed labels
  // to TRUE sounding MIDI (verified by pitch analysis). Default +12; harp = 0.
  const shift = inst.octaveShift ?? 12;
  const manifestZones = [];
  let total = 0;
  for (const z of zones) {
    const midi = z.midi + shift;
    const wav = resolve(TMP, `${inst.id}_${z.midi}.wav`);
    sh(`curl -sL "${RAW_BASE}/${encodePath(z.path)}" -o "${wav}"`);
    const out = resolve(outDir, `${midi}.mp3`);
    const fadeStart = Math.max(0.1, inst.cap - 0.25);
    const af = [
      'silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.01',
      'areverse',
      'silenceremove=start_periods=1:start_threshold=-58dB:start_silence=0.05',
      'areverse',
      `afade=t=out:st=${fadeStart}:d=0.25`,
    ].join(',');
    sh(`ffmpeg -y -loglevel error -i "${wav}" -ac 1 -af "${af}" -t ${inst.cap} -c:a libmp3lame -b:a ${inst.bitrate} "${out}"`);
    const bytes = statSync(out).size;
    total += bytes;
    manifestZones.push({ midi, file: `${midi}.mp3`, bytes });
  }

  const mids = manifestZones.map((z) => z.midi);
  const lo = Math.min(...mids), hi = Math.max(...mids);
  const manifest = {
    id: inst.id, name: inst.name, icon: inst.icon, category: inst.category,
    type: 'sample', source: 'VCSL (CC0)', playbackMode: inst.playbackMode,
    gain: inst.gain, brightness: inst.brightness, envelope: inst.env,
    range: { lo, hi, label: `${midiToName(lo)}–${midiToName(hi)}` },
    zones: manifestZones.map(({ midi, file }) => ({ midi, file })),
  };
  writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`  ✓ ${inst.id}: ${manifestZones.length} zones, ${(total / 1024).toFixed(0)} KB`);
  return { manifest, bytes: total };
}

function main() {
  const filter = process.argv.slice(2);
  const targets = filter.length ? INSTRUMENTS.filter((i) => filter.includes(i.id)) : INSTRUMENTS;
  mkdirSync(OUT_ROOT, { recursive: true });
  const allFiles = loadTree();
  console.log(`• building ${targets.length} instrument(s) from ${allFiles.length} VCSL files\n`);

  const index = [];
  let grand = 0;
  for (const inst of targets) {
    const res = buildInstrument(inst, allFiles);
    if (res) { index.push(res.manifest); grand += res.bytes; }
  }
  writeFileSync(resolve(OUT_ROOT, 'index.json'), JSON.stringify(
    index.map(({ id, name, icon, category, range }) => ({ id, name, icon, category, range: range && range.label, path: `${id}/manifest.json` })),
    null, 2,
  ));
  console.log(`\n• done — ${index.length} instruments, ${(grand / 1024 / 1024).toFixed(2)} MB total in public/packs/`);
}

main();
