/**
 * Lyrics - timed text blocks attached to a snippet, each with a tick position
 * and length, so the Inspector and future Stage/karaoke views can show when
 * a phrase comes in and how long it lasts.
 *
 * Pure and DOM-free. Lyrics are stored on `snippet.lyrics` as
 * `[{ text, startTick, durationTick }]`. Each entry is an independent timeline
 * block; `lyricsFromText()` remains as a quick-import helper that distributes
 * words across note onsets or evenly across the snippet.
 *
 * Text is sanitized at this boundary (no angle brackets / quotes / control
 * chars) so a lyric can never carry markup into a renderer.
 */

const MAX_BLOCKS = 256;
const MAX_WORD_LEN = 48;
const MAX_PHRASE_LEN = 160;

export function cleanLyricText(value) {
  return (typeof value === 'string' ? value : '')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/[<>"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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
    out.push({ text, startTick, durationTick });
  }
  return out.sort((a, b) => a.startTick - b.startTick);
}

/** Backward-compatible name used by the original lyrics lane. */
export function normalizeLyrics(value, snippet = {}) {
  return normalizeLyricBlocks(value, snippet);
}

/** Build one explicit lyric timeline block. Returns null for empty text. */
export function createLyricBlock(input = {}, snippet = {}) {
  return normalizeLyricBlocks([input], snippet)[0] || null;
}

/** Update one lyric block by index and return a normalized, sorted array. */
export function updateLyricBlock(lyrics, index, patch = {}, snippet = {}) {
  const list = normalizeLyricBlocks(lyrics, snippet);
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return list;

  const updated = createLyricBlock({ ...list[index], ...patch }, snippet);
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
