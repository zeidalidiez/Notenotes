import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cleanLyricText,
  normalizeLyrics,
  lyricsFromText,
  activeLyricIndex,
  lyricsToText,
} from '../../src/engine/Lyrics.js';

const snippet = {
  durationTicks: 1920,
  notes: [
    { pitch: 60, startTick: 0, durationTick: 460 },
    { pitch: 64, startTick: 480, durationTick: 460 },
    { pitch: 67, startTick: 960, durationTick: 460 },
    { pitch: 72, startTick: 1440, durationTick: 460 },
  ],
};

test('lyricsFromText lands words on successive note onsets', () => {
  const ly = lyricsFromText('twinkle little star now', snippet);
  assert.deepEqual(ly.map(l => l.text), ['twinkle', 'little', 'star', 'now']);
  assert.deepEqual(ly.map(l => l.startTick), [0, 480, 960, 1440]);
  // Each word lasts until the next onset; the last runs to the snippet end.
  assert.deepEqual(ly.map(l => l.durationTick), [480, 480, 480, 480]);
});

test('lyricsFromText spaces words evenly when there are more words than notes', () => {
  const ly = lyricsFromText('a b c d e f g h', { durationTicks: 1600, notes: [{ startTick: 0 }] });
  assert.equal(ly.length, 8);
  assert.equal(ly[0].startTick, 0);
  assert.equal(ly[0].durationTick, 200);
  assert.equal(ly[7].startTick, 1400);
  // The last word ends exactly at the snippet boundary (no rounding overshoot).
  assert.equal(ly[7].startTick + ly[7].durationTick, 1600);
});

test('even-spacing anchors the last word to the snippet end despite rounding', () => {
  // 3 words over 1000 ticks: step ~333.33; the last word must run to 1000.
  const ly = lyricsFromText('one two three', { durationTicks: 1000, notes: [{ startTick: 0 }] });
  assert.equal(ly.length, 3);
  assert.equal(ly[2].startTick + ly[2].durationTick, 1000);
});

test('activeLyricIndex finds the word sounding at a tick', () => {
  const ly = lyricsFromText('twinkle little star now', snippet);
  assert.equal(activeLyricIndex(ly, 0), 0);
  assert.equal(activeLyricIndex(ly, 500), 1);
  assert.equal(activeLyricIndex(ly, 1000), 2);
  assert.equal(activeLyricIndex(ly, 1900), 3);
  assert.equal(activeLyricIndex(ly, 99999), -1);
  assert.equal(activeLyricIndex([], 0), -1);
});

test('normalizeLyrics sanitizes text, clamps timing, sorts, and drops junk', () => {
  const ly = normalizeLyrics([
    { text: 'world', startTick: 960, durationTick: 100 },
    { text: '<img onerror=alert(1)>hi"', startTick: -5, durationTick: 0 },
    { text: '   ', startTick: 0, durationTick: 100 },      // empty after clean -> dropped
    { text: 'x', startTick: 'bad', durationTick: 'bad' },   // bad timing -> defaults
  ]);
  // The '   ' entry is dropped; the rest survive, sorted by startTick.
  assert.equal(ly.length, 3);
  assert.deepEqual(ly.map(l => l.startTick), [0, 0, 960]);
  // No angle brackets / quotes can survive, so a lyric can't carry markup.
  for (const l of ly) assert.ok(!/[<>"]/.test(l.text), `markup leaked: ${l.text}`);
  assert.equal(ly[2].text, 'world');
  assert.ok(ly.every(l => l.durationTick >= 1));  // 0 raised to >= 1
});

test('cleanLyricText keeps a full line intact (no length cap) but strips markup chars', () => {
  const line = 'the quick brown fox jumps over the lazy dog and then some more words here';
  assert.equal(cleanLyricText(line), line);             // not truncated to a word length
  assert.equal(cleanLyricText('a   b\t c'), 'a b c');    // whitespace/tabs collapsed
  // Strips the < > " characters (so no markup can form) but keeps other text.
  assert.equal(cleanLyricText('<b>x</b>'), 'bx/b');
  assert.ok(!/[<>"]/.test(cleanLyricText('<script>"hi"</script>')));
});

test('lyricsToText round-trips back to a typeable line', () => {
  const ly = lyricsFromText('hey there friend', snippet);
  assert.equal(lyricsToText(ly), 'hey there friend');
});
