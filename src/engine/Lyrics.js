/**
 * Lyrics - timed text attached to MIDI notes, plus legacy snippet-level block
 * helpers for older projects.
 *
 * Pure and DOM-free. New lyrics are stored on MIDI note objects as
 * `note.lyric`; timing comes from the note's `startTick` and `durationTick`.
 * `lyricTimelineForSnippet()` derives karaoke-readable blocks from lyric-
 * bearing notes first, and falls back to old `snippet.lyrics` blocks only when
 * a snippet has no note-attached lyrics. The legacy block helpers stay here so
 * old saved data can still be normalized/read without reviving the old editor
 * lane.
 *
 * Text is sanitized at this boundary (no angle brackets / quotes / control
 * chars) so a lyric can never carry markup into a renderer.
 */

const MAX_BLOCKS = 256;
const MAX_ID_LEN = 96;
const MAX_WORD_LEN = 48;
const MAX_PHRASE_LEN = 160;
let lyricIdCounter = 0;

export function cleanLyricText(value) {
  return (typeof value === 'string' ? value : '')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/[<>"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanNoteLyricText(value) {
  return cleanLyricText(value);
}

export function cleanLyricId(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  return text.replace(/[^\w:.-]/g, '').slice(0, MAX_ID_LEN);
}

function createLyricId() {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return `lyric_${random}`;
  lyricIdCounter += 1;
  return `lyric_${Date.now().toString(36)}_${lyricIdCounter.toString(36)}`;
}

const cleanWord = (value) => cleanLyricText(value).slice(0, MAX_WORD_LEN);
const cleanPhrase = (value) => cleanLyricText(value).slice(0, MAX_PHRASE_LEN);
const int = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);

function snippetDuration(snippet) {
  const duration = int(snippet?.durationTicks);
  return duration && duration > 0 ? duration : null;
}

function normalizeTiming(entry, snippet) {
  const cap = snippetDuration(snippet);
  let startTick = Math.max(0, int(entry?.startTick) ?? 0);
  let durationTick = Math.max(1, int(entry?.durationTick) ?? 1);

  if (cap) {
    startTick = Math.min(startTick, Math.max(0, cap - 1));
    durationTick = Math.min(durationTick, Math.max(1, cap - startTick));
  }

  return { startTick, durationTick };
}

/**
 * Sanitize/repair stored lyric blocks. Drops invalid entries, clamps timing to
 * the snippet when a duration is available, and sorts by time.
 */
export function normalizeLyricBlocks(value, snippet = {}) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value.slice(0, MAX_BLOCKS)) {
    const text = cleanPhrase(entry?.text);
    if (!text) continue;
    const { startTick, durationTick } = normalizeTiming(entry, snippet);
    const id = cleanLyricId(entry?.id);
    out.push(id ? { id, text, startTick, durationTick } : { text, startTick, durationTick });
  }
  return out.sort((a, b) => a.startTick - b.startTick);
}

/**
 * Normalize lyric blocks and ensure each one has a unique stable id.
 * Call this before storing blocks that the editor needs to reselect later.
 */
export function ensureLyricBlockIds(value, snippet = {}) {
  const used = new Set();
  return normalizeLyricBlocks(value, snippet).map(block => {
    let id = cleanLyricId(block.id);
    while (!id || used.has(id)) id = createLyricId();
    used.add(id);
    return { ...block, id };
  });
}

/** Backward-compatible name used by the original lyrics lane. */
export function normalizeLyrics(value, snippet = {}) {
  return normalizeLyricBlocks(value, snippet);
}

/** Build one explicit lyric timeline block. Returns null for empty text. */
export function createLyricBlock(input = {}, snippet = {}) {
  const id = cleanLyricId(input.id) || createLyricId();
  return normalizeLyricBlocks([{ ...input, id }], snippet)[0] || null;
}

/** Update one lyric block by index and return a normalized, sorted array. */
export function updateLyricBlock(lyrics, index, patch = {}, snippet = {}) {
  const list = ensureLyricBlockIds(lyrics, snippet);
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return list;

  const updated = createLyricBlock({ ...list[index], ...patch, id: list[index].id }, snippet);
  if (updated) list[index] = updated;
  else list.splice(index, 1);
  return normalizeLyricBlocks(list, snippet);
}

/** Remove one lyric block by index and return a normalized array. */
export function removeLyricBlock(lyrics, index, snippet = {}) {
  const list = normalizeLyricBlocks(lyrics, snippet);
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return list;
  list.splice(index, 1);
  return normalizeLyricBlocks(list, snippet);
}

export function setNoteLyric(note = {}, text = '') {
  const lyric = cleanNoteLyricText(text);
  const next = { ...note };
  if (lyric) next.lyric = lyric;
  else delete next.lyric;
  return next;
}

export function lyricBlocksFromNotes(snippet = {}) {
  if (snippet?.type !== 'midi' || !Array.isArray(snippet.notes)) return [];
  const cap = snippetDuration(snippet);
  const blocks = [];

  snippet.notes.forEach((note, noteIndex) => {
    const text = cleanNoteLyricText(note?.lyric);
    if (!text) return;
    const { startTick, durationTick } = normalizeTiming(note, snippet);
    if (cap && startTick >= cap) return;
    blocks.push({ text, startTick, durationTick, noteIndex });
  });

  return blocks.sort((a, b) => a.startTick - b.startTick || a.noteIndex - b.noteIndex);
}

export function lyricTimelineForSnippet(snippet = {}) {
  const noteLyrics = lyricBlocksFromNotes(snippet);
  if (noteLyrics.length) return noteLyrics;
  return normalizeLyricBlocks(snippet?.lyrics || [], snippet);
}

export function lyricBlockIndexById(lyrics, id, snippet = {}) {
  const targetId = cleanLyricId(id);
  if (!targetId) return -1;
  return normalizeLyricBlocks(lyrics, snippet).findIndex(block => block.id === targetId);
}

/** The note/hit onset ticks of a snippet, unique and sorted ascending. */
function snippetOnsets(snippet) {
  const events = (Array.isArray(snippet?.notes) && snippet.notes.length)
    ? snippet.notes
    : (Array.isArray(snippet?.hits) ? snippet.hits : []);
  const ticks = events
    .map(e => Math.max(0, int(e?.startTick) ?? 0))
    .filter(t => Number.isFinite(t));
  return [...new Set(ticks)].sort((a, b) => a - b);
}

/**
 * Turn a line of text into timed lyric words for a snippet.
 *
 * - words <= note onsets: each word lands on a successive onset and lasts until
 *   the next word's onset (the last word runs to the end of the snippet).
 * - otherwise: words are spaced evenly across the snippet duration.
 */
export function lyricsFromText(text, snippet) {
  const words = cleanLyricText(text).split(' ').map(cleanWord).filter(Boolean).slice(0, MAX_BLOCKS);
  if (!words.length) return [];

  const duration = Math.max(1, int(snippet?.durationTicks) ?? 1);
  const onsets = snippetOnsets(snippet);

  if (onsets.length >= words.length) {
    return words.map((word, i) => {
      const startTick = onsets[i];
      const nextStart = (i + 1 < words.length) ? onsets[i + 1] : duration;
      return createLyricBlock({ text: word, startTick, durationTick: Math.max(1, nextStart - startTick) }, snippet);
    });
  }

  // Even spacing: derive each word's length from the next word's start (and the
  // last word from the snippet end) so the lyrics span exactly [0, duration]
  // with no rounding drift past the boundary - same approach as the aligned path.
  const step = duration / words.length;
  const starts = words.map((_, i) => Math.round(i * step));
  return words.map((word, i) => {
    const startTick = starts[i];
    const nextStart = (i + 1 < words.length) ? starts[i + 1] : duration;
    return createLyricBlock({ text: word, startTick, durationTick: Math.max(1, nextStart - startTick) }, snippet);
  });
}

/** Index of the lyric word active at `tick`, or -1. */
export function activeLyricIndex(lyrics, tick) {
  const list = normalizeLyricBlocks(lyrics);
  const t = Number(tick);
  if (!Number.isFinite(t)) return -1;
  for (let i = 0; i < list.length; i++) {
    const { startTick, durationTick } = list[i];
    if (t >= startTick && t < startTick + durationTick) return i;
  }
  return -1;
}

/** Human-readable phrase summary for independent lyric timeline blocks. */
export function lyricPhrasesToText(lyrics) {
  return normalizeLyricBlocks(lyrics).map(l => l.text).join(' / ');
}

/** Plain-text join of the words, for round-tripping into the input field. */
export function lyricsToText(lyrics) {
  return normalizeLyricBlocks(lyrics).map(l => l.text).join(' ');
}
