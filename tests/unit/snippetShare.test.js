import test from 'node:test';
import assert from 'node:assert/strict';

import {
  encodeSnippetShare,
  decodeSnippetShare,
  shareUrlForSnippet,
  sharedSnippetFromSearch,
  SNIPPET_SHARE_PARAM,
  MAX_SHARE_EVENTS,
  MAX_SHARE_LYRIC_CHARS,
  MAX_SHARE_TOTAL_LYRIC_CHARS,
  MAX_SHARE_CODE_CHARS,
} from '../../src/utils/SnippetShare.js';

function midiSnippet(overrides = {}) {
  return {
    id: 'abc',
    type: 'midi',
    name: 'My hook',
    notes: [
      { pitch: 60, startTick: 0, durationTick: 480, velocity: 0.8 },
      { pitch: 64, startTick: 480, durationTick: 240, velocity: 0.5 },
    ],
    hits: [],
    durationTicks: 1920,
    bpm: 128,
    ...overrides,
  };
}

test('round-trips a MIDI snippet through encode/decode', () => {
  const code = encodeSnippetShare(midiSnippet());
  assert.equal(typeof code, 'string');
  assert.ok(code.length > 0);

  const decoded = decodeSnippetShare(code);
  assert.equal(decoded.type, 'midi');
  assert.equal(decoded.name, 'My hook');
  assert.equal(decoded.bpm, 128);
  assert.equal(decoded.notes.length, 2);
  assert.deepEqual(decoded.notes[0], { pitch: 60, startTick: 0, durationTick: 480, velocity: 0.8 });
  assert.equal(decoded.notes[1].pitch, 64);
  // Importer assigns id/createdAt; decode must not.
  assert.equal(decoded.id, undefined);
  assert.equal(decoded.createdAt, undefined);
});

test('round-trips MIDI note lyrics through encode/decode', () => {
  const code = encodeSnippetShare(midiSnippet({
    notes: [
      { pitch: 60, startTick: 0, durationTick: 480, velocity: 0.8, lyric: '<b>take</b> "away"' },
      { pitch: 64, startTick: 480, durationTick: 240, velocity: 0.5 },
    ],
  }));

  const decoded = decodeSnippetShare(code);
  assert.equal(decoded.notes[0].lyric, 'btake/b away');
  assert.equal(Object.hasOwn(decoded.notes[1], 'lyric'), false);
});

test('bounds MIDI note lyrics in share payloads', () => {
  const longLyric = 'a'.repeat(MAX_SHARE_LYRIC_CHARS + 50);
  const decodedFromEncoder = decodeSnippetShare(encodeSnippetShare(midiSnippet({
    notes: [{ pitch: 60, startTick: 0, durationTick: 480, velocity: 0.8, lyric: longLyric }],
  })));

  assert.equal(decodedFromEncoder.notes[0].lyric.length, MAX_SHARE_LYRIC_CHARS);

  const decodedFromPayload = decodeSnippetShare(encodeForTest({
    v: 1,
    t: 'midi',
    nm: 'x',
    d: 480,
    b: 120,
    N: [[60, 0, 480, 80, longLyric]],
    H: [],
  }));

  assert.equal(decodedFromPayload.notes[0].lyric.length, MAX_SHARE_LYRIC_CHARS);
});

test('keeps lyric-heavy MIDI share codes within the URL budget', () => {
  const lyric = 'a'.repeat(MAX_SHARE_LYRIC_CHARS);
  const notes = Array.from({ length: MAX_SHARE_EVENTS }, (_, i) => ({
    pitch: 60 + (i % 12),
    startTick: i * 120,
    durationTick: 120,
    velocity: 0.8,
    lyric,
  }));

  const code = encodeSnippetShare({
    type: 'midi',
    name: 'max lyric payload',
    notes,
    hits: [],
    durationTicks: MAX_SHARE_EVENTS * 120,
    bpm: 120,
  });

  assert.ok(code.length <= MAX_SHARE_CODE_CHARS, `share code length ${code.length} exceeded URL budget`);

  const decoded = decodeSnippetShare(code);
  const sharedLyricChars = decoded.notes.reduce((sum, note) => sum + (note.lyric?.length || 0), 0);
  assert.ok(sharedLyricChars > 0);
  assert.ok(sharedLyricChars <= MAX_SHARE_TOTAL_LYRIC_CHARS);

  const decodedFromPayload = decodeSnippetShare(encodeForTest({
    v: 1,
    t: 'midi',
    nm: 'crafted lyric payload',
    d: MAX_SHARE_EVENTS * 120,
    b: 120,
    N: notes.map(note => [note.pitch, note.startTick, note.durationTick, 80, note.lyric]),
    H: [],
  }));
  const decodedPayloadLyricChars = decodedFromPayload.notes.reduce((sum, note) => sum + (note.lyric?.length || 0), 0);
  assert.ok(decodedPayloadLyricChars <= MAX_SHARE_TOTAL_LYRIC_CHARS);
});

test('strips HTML/control characters from the shared name (no markup in a link)', () => {
  const malicious = '<img src=x onerror=alert(1)>Hook"<script>';
  // Through the normal encoder...
  const a = decodeSnippetShare(encodeSnippetShare(midiSnippet({ name: malicious })));
  assert.ok(!/[<>"]/.test(a.name), `name still had markup chars: ${a.name}`);
  assert.equal(a.name, 'img src=x onerror=alert(1)Hookscript');
  // ...and through a hand-crafted payload that bypasses the encoder.
  const b = decodeSnippetShare(encodeForTest({
    v: 1, t: 'midi', nm: '<b>x</b>', d: 480, b: 120,
    N: [[60, 0, 480, 80]], H: [],
  }));
  assert.ok(!/[<>"]/.test(b.name));
});

test('round-trips a drum snippet by hit type', () => {
  const code = encodeSnippetShare({
    type: 'drum',
    name: 'Beat',
    notes: [],
    hits: [
      { type: 'kick', startTick: 0, velocity: 1 },
      { type: 'snare', startTick: 480, velocity: 0.7 },
    ],
    durationTicks: 960,
    bpm: 90,
  });
  const decoded = decodeSnippetShare(code);
  assert.equal(decoded.type, 'drum');
  assert.deepEqual(decoded.hits.map(h => h.type), ['kick', 'snare']);
  assert.equal(decoded.hits[0].velocity, 1);
});

test('refuses to share audio or empty snippets', () => {
  assert.equal(encodeSnippetShare({ type: 'audio', audioAssetId: 'x' }), null);
  assert.equal(encodeSnippetShare({ type: 'midi', notes: [], hits: [] }), null);
  assert.equal(encodeSnippetShare(null), null);
});

test('decode rejects malformed, wrong-version, and junk codes', () => {
  assert.equal(decodeSnippetShare('not-base64!!'), null);
  assert.equal(decodeSnippetShare(''), null);
  assert.equal(decodeSnippetShare(null), null);
  // Valid base64url of JSON, but not a v1 share payload.
  const bogus = encodeForTest({ v: 99, t: 'midi', N: [], H: [] });
  assert.equal(decodeSnippetShare(bogus), null);
});

test('encode clamps out-of-range values and normalizes the name', () => {
  const code = encodeSnippetShare({
    type: 'midi',
    name: '   spaced   name   ',
    notes: [
      { pitch: 200, startTick: -5, durationTick: 0, velocity: 9 }, // clamped, not dropped
      { pitch: 72, startTick: 10, durationTick: 100, velocity: 0.9 },
    ],
    hits: [],
    durationTicks: 480,
    bpm: 9999,
  });
  const decoded = decodeSnippetShare(code);
  assert.equal(decoded.notes.length, 2);
  assert.equal(decoded.notes[0].pitch, 127);          // 200 clamped to 127
  assert.equal(decoded.notes[0].startTick, 0);        // -5 clamped to 0
  assert.ok(decoded.notes[0].durationTick >= 1);      // 0 raised to >= 1
  assert.equal(decoded.bpm, 240);                     // bpm clamped to max
  assert.equal(decoded.name, 'spaced name');          // whitespace collapsed
});

test('decode drops structurally-invalid note entries', () => {
  // Hand-crafted payload (bypasses the clamping encoder) with a bad pitch.
  const code = encodeForTest({
    v: 1, t: 'midi', nm: 'x', d: 480, b: 120,
    N: [[999, 0, 480, 80], [64, 0, 240, 80]], // first pitch out of range -> dropped
    H: [],
  });
  const decoded = decodeSnippetShare(code);
  assert.equal(decoded.notes.length, 1);
  assert.equal(decoded.notes[0].pitch, 64);
});

test('caps the number of events to keep the URL bounded', () => {
  const notes = Array.from({ length: MAX_SHARE_EVENTS + 50 }, (_, i) => ({
    pitch: 60, startTick: i * 10, durationTick: 10, velocity: 0.8,
  }));
  const decoded = decodeSnippetShare(encodeSnippetShare({ type: 'midi', name: 'big', notes, hits: [], durationTicks: 1920, bpm: 120 }));
  assert.equal(decoded.notes.length, MAX_SHARE_EVENTS);
});

test('caps mixed note and hit shares to a combined event budget', () => {
  const notes = Array.from({ length: MAX_SHARE_EVENTS }, (_, i) => ({
    pitch: 60 + (i % 12),
    startTick: i * 10,
    durationTick: 10,
    velocity: 0.8,
    lyric: 'la',
  }));
  const hits = Array.from({ length: MAX_SHARE_EVENTS }, (_, i) => ({
    type: i % 2 ? 'snare' : 'kick',
    startTick: i * 10,
    velocity: 0.8,
  }));

  const code = encodeSnippetShare({ type: 'midi', name: 'dense mixed', notes, hits, durationTicks: 1920, bpm: 120 });
  assert.ok(code.length <= MAX_SHARE_CODE_CHARS, `share code length ${code.length} exceeded URL budget`);

  const decoded = decodeSnippetShare(code);
  assert.equal(decoded.notes.length + decoded.hits.length, MAX_SHARE_EVENTS);

  const decodedFromPayload = decodeSnippetShare(encodeForTest({
    v: 1,
    t: 'midi',
    nm: 'crafted dense mixed',
    d: 1920,
    b: 120,
    N: notes.map(note => [note.pitch, note.startTick, note.durationTick, 80, note.lyric]),
    H: hits.map(hit => [hit.type, hit.startTick, 80]),
  }));
  assert.equal(decodedFromPayload.notes.length + decodedFromPayload.hits.length, MAX_SHARE_EVENTS);
});

test('trims dense shares until the final encoded code fits the URL budget', () => {
  const hits = Array.from({ length: MAX_SHARE_EVENTS }, (_, i) => ({
    type: `sample-${String(i).padStart(9, '0')}`,
    startTick: i * 10,
    velocity: 0.8,
  }));

  const code = encodeSnippetShare({
    type: 'drum',
    name: 'dense hit payload',
    notes: [],
    hits,
    durationTicks: MAX_SHARE_EVENTS * 10,
    bpm: 120,
  });

  assert.equal(typeof code, 'string');
  assert.ok(code.length <= MAX_SHARE_CODE_CHARS, `share code length ${code.length} exceeded URL budget`);

  const decoded = decodeSnippetShare(code);
  assert.ok(decoded.hits.length > 0);
  assert.ok(decoded.hits.length < MAX_SHARE_EVENTS);
});

test('builds and parses a share URL', () => {
  const url = shareUrlForSnippet(midiSnippet(), 'https://example.com/Notenotes/?old=1#frag');
  assert.ok(url.startsWith('https://example.com/Notenotes/?'));
  assert.ok(url.includes(`${SNIPPET_SHARE_PARAM}=`));
  assert.ok(!url.includes('old=1'));   // existing query/hash stripped
  assert.ok(!url.includes('#frag'));

  const search = url.slice(url.indexOf('?'));
  const decoded = sharedSnippetFromSearch(search);
  assert.equal(decoded.type, 'midi');
  assert.equal(decoded.notes.length, 2);

  assert.equal(sharedSnippetFromSearch('?nothing=here'), null);
  assert.equal(sharedSnippetFromSearch(''), null);
});

// Local helper so the bogus-payload test does not depend on internals.
function encodeForTest(payloadObj) {
  // Mirror the module's transport (JSON -> utf8 -> base64url) just enough to
  // produce a structurally-valid-but-semantically-wrong code.
  const json = JSON.stringify(payloadObj);
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const bytes = [];
  const enc = encodeURIComponent(json);
  for (let i = 0; i < enc.length; i++) {
    if (enc[i] === '%') { bytes.push(parseInt(enc.substr(i + 1, 2), 16)); i += 2; }
    else bytes.push(enc.charCodeAt(i));
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64[n & 63];
  }
  return out;
}
