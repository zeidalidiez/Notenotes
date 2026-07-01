import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cleanLyricText,
  cleanNoteLyricText,
  normalizeLyrics,
  normalizeLyricBlocks,
  ensureLyricBlockIds,
  createLyricBlock,
  updateLyricBlock,
  removeLyricBlock,
  lyricBlockIndexById,
  lyricsFromText,
  activeLyricIndex,
  lyricsToText,
  lyricPhrasesToText,
  setNoteLyric,
  lyricBlocksFromNotes,
  lyricTimelineForSnippet,
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

const withoutIds = (blocks) => blocks.map(({ id, ...block }) => block);

test('note lyric text sanitizes without splitting or truncating phrases', () => {
  const line = 'take me away right now and keep going';
  assert.equal(cleanNoteLyricText(line), line);
  assert.equal(cleanNoteLyricText(' take   me\taway '), 'take me away');
  assert.equal(cleanNoteLyricText('<b>take</b> "away"'), 'btake/b away');
  assert.equal(cleanNoteLyricText('   '), '');
});

test('setNoteLyric writes sanitized text and removes empty lyric fields', () => {
  const base = { pitch: 60, startTick: 120, durationTick: 240, velocity: 0.7 };

  assert.deepEqual(setNoteLyric(base, '<b>take</b> "away"'), {
    ...base,
    lyric: 'btake/b away',
  });
  assert.deepEqual(setNoteLyric({ ...base, lyric: 'old text' }, '   '), base);
});

test('lyricBlocksFromNotes derives karaoke timing from MIDI note geometry', () => {
  const blocks = lyricBlocksFromNotes({
    type: 'midi',
    durationTicks: 960,
    notes: [
      { pitch: 64, startTick: 480, durationTick: 240, lyric: 'second' },
      { pitch: 60, startTick: 0, durationTick: 240, lyric: 'first phrase' },
      { pitch: 67, startTick: 720, durationTick: 500, lyric: '<i>last</i>' },
      { pitch: 72, startTick: 240, durationTick: 120 },
    ],
  });

  assert.deepEqual(blocks, [
    { text: 'first phrase', startTick: 0, durationTick: 240, noteIndex: 1 },
    { text: 'second', startTick: 480, durationTick: 240, noteIndex: 0 },
    { text: 'ilast/i', startTick: 720, durationTick: 240, noteIndex: 2 },
  ]);
});

test('lyric timeline ignores drums and prefers note lyrics over legacy snippet blocks', () => {
  assert.deepEqual(lyricBlocksFromNotes({
    type: 'drum',
    notes: [{ pitch: 60, startTick: 0, durationTick: 120, lyric: 'ignored' }],
  }), []);

  const legacy = [{ text: 'legacy', startTick: 0, durationTick: 120 }];
  assert.deepEqual(lyricTimelineForSnippet({
    type: 'midi',
    durationTicks: 960,
    notes: [{ pitch: 60, startTick: 240, durationTick: 120, lyric: 'note lyric' }],
    lyrics: legacy,
  }), [
    { text: 'note lyric', startTick: 240, durationTick: 120, noteIndex: 0 },
  ]);

  assert.deepEqual(lyricTimelineForSnippet({
    type: 'midi',
    durationTicks: 960,
    notes: [{ pitch: 60, startTick: 240, durationTick: 120 }],
    lyrics: legacy,
  }), legacy);
});

test('lyricsFromText lands words on successive note onsets', () => {
  const ly = lyricsFromText('twinkle little star now', snippet);
  assert.deepEqual(ly.map(l => l.text), ['twinkle', 'little', 'star', 'now']);
  assert.deepEqual(ly.map(l => l.startTick), [0, 480, 960, 1440]);
  // Each word lasts until the next onset; the last runs to the snippet end.
  assert.deepEqual(ly.map(l => l.durationTick), [480, 480, 480, 480]);
});

test('normalizeLyricBlocks preserves phrase text and clamps timing to snippet bounds', () => {
  const ly = normalizeLyricBlocks([
    { text: 'take me away', startTick: 120, durationTick: 240 },
    { text: '<b>hold</b>"', startTick: 1200, durationTick: 480 },
    { text: '   ', startTick: 0, durationTick: 100 },
  ], { durationTicks: 960 });

  assert.deepEqual(ly, [
    { text: 'take me away', startTick: 120, durationTick: 240 },
    { text: 'bhold/b', startTick: 959, durationTick: 1 },
  ]);
});

test('create/update/remove lyric blocks edit explicit timeline ranges', () => {
  const durationSnippet = { durationTicks: 960 };
  const first = createLyricBlock({ text: 'take me away', startTick: 480, durationTick: 960 }, durationSnippet);
  assert.match(first.id, /^lyric_/);
  assert.deepEqual(withoutIds([first])[0], { text: 'take me away', startTick: 480, durationTick: 480 });

  const updated = updateLyricBlock([first], 0, { text: 'bring me home', startTick: 240, durationTick: 240 }, durationSnippet);
  assert.equal(updated[0].id, first.id);
  assert.deepEqual(withoutIds(updated), [
    { text: 'bring me home', startTick: 240, durationTick: 240 },
  ]);

  assert.deepEqual(removeLyricBlock(updated, 0, durationSnippet), []);
});

test('lyric block ids remain unique and survive sorting/clamping', () => {
  const blocks = ensureLyricBlockIds([
    { id: 'dupe', text: 'late', startTick: 900, durationTick: 300 },
    { id: 'dupe', text: 'early', startTick: 0, durationTick: 120 },
    { text: 'middle', startTick: 480, durationTick: 120 },
  ], { durationTicks: 1200 });

  assert.equal(new Set(blocks.map(block => block.id)).size, 3);
  assert.equal(blocks[0].id, 'dupe');

  const selectedId = blocks[2].id;
  const clamped = ensureLyricBlockIds(blocks, { durationTicks: 960 });
  const selectedIdx = lyricBlockIndexById(clamped, selectedId, { durationTicks: 960 });
  assert.equal(clamped[selectedIdx].text, 'late');
  assert.equal(clamped[selectedIdx].startTick, 900);
  assert.equal(clamped[selectedIdx].durationTick, 60);
});

test('duplicate lyric blocks do not steal selection after update', () => {
  const blocks = ensureLyricBlockIds([
    { text: 'same', startTick: 0, durationTick: 120 },
    { text: 'other', startTick: 240, durationTick: 120 },
  ], { durationTicks: 960 });
  const selectedId = blocks[1].id;

  const updated = updateLyricBlock(blocks, 1, {
    text: 'same',
    startTick: 0,
    durationTick: 120,
  }, { durationTicks: 960 });

  const selectedIdx = lyricBlockIndexById(updated, selectedId, { durationTicks: 960 });
  assert.equal(selectedIdx, 1);
  assert.equal(updated[selectedIdx].id, selectedId);
  assert.deepEqual(withoutIds(updated), [
    { text: 'same', startTick: 0, durationTick: 120 },
    { text: 'same', startTick: 0, durationTick: 120 },
  ]);
});

test('lyricPhrasesToText summarizes independent lyric blocks without splitting phrases', () => {
  const ly = normalizeLyricBlocks([
    { text: 'take me away', startTick: 480, durationTick: 240 },
    { text: 'right now', startTick: 720, durationTick: 240 },
  ], { durationTicks: 960 });

  assert.equal(lyricPhrasesToText(ly), 'take me away / right now');
  assert.equal(activeLyricIndex(ly, 500), 0);
  assert.equal(activeLyricIndex(ly, 800), 1);
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
