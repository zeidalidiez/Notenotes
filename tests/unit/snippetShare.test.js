import test from 'node:test';
import assert from 'node:assert/strict';

import {
  encodeSnippetShare,
  decodeSnippetShare,
  shareUrlForSnippet,
  sharedSnippetFromSearch,
  SNIPPET_SHARE_PARAM,
  MAX_SHARE_EVENTS,
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
