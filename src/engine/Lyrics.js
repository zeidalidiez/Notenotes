/**
 * Lyrics - words attached to a snippet, each with a tick position and length,
 * so the Inspector can show when a word comes in and how long it lasts.
 *
 * Pure and DOM-free. Lyrics are stored on `snippet.lyrics` as
 * `[{ text, startTick, durationTick }]`. Typing a line distributes the words
 * across the snippet's note onsets (so words land on notes), falling back to
 * even spacing across the snippet when there are more words than notes.
 *
 * Text is sanitized at this boundary (no angle brackets / quotes / control
 * chars) so a lyric can never carry markup into a renderer.
 */

const MAX_WORDS = 256;
const MAX_WORD_LEN = 48;

export function cleanLyricText(value) {
  return (typeof value === 'string' ? value : '')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/[<>"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const cleanWord = (value) => cleanLyricText(value).slice(0, MAX_WORD_LEN);
const int = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);

/** Sanitize/repair a stored lyrics array. Drops invalid entries, sorts by time. */
export function normalizeLyrics(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value.slice(0, MAX_WORDS)) {
    const text = cleanWord(entry?.text);
    if (!text) continue;
    const startTick = Math.max(0, int(entry?.startTick) ?? 0);
    const durationTick = Math.max(1, int(entry?.durationTick) ?? 1);
    out.push({ text, startTick, durationTick });
  }
  return out.sort((a, b) => a.startTick - b.startTick);
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
  const words = cleanLyricText(text).split(' ').map(cleanWord).filter(Boolean).slice(0, MAX_WORDS);
  if (!words.length) return [];

  const duration = Math.max(1, int(snippet?.durationTicks) ?? 1);
  const onsets = snippetOnsets(snippet);

  if (onsets.length >= words.length) {
    return words.map((word, i) => {
      const startTick = onsets[i];
      const nextStart = (i + 1 < words.length) ? onsets[i + 1] : duration;
      return { text: word, startTick, durationTick: Math.max(1, nextStart - startTick) };
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
    return { text: word, startTick, durationTick: Math.max(1, nextStart - startTick) };
  });
}

/** Index of the lyric word active at `tick`, or -1. */
export function activeLyricIndex(lyrics, tick) {
  const list = normalizeLyrics(lyrics);
  const t = Number(tick);
  if (!Number.isFinite(t)) return -1;
  for (let i = 0; i < list.length; i++) {
    const { startTick, durationTick } = list[i];
    if (t >= startTick && t < startTick + durationTick) return i;
  }
  return -1;
}

/** Plain-text join of the words, for round-tripping into the input field. */
export function lyricsToText(lyrics) {
  return normalizeLyrics(lyrics).map(l => l.text).join(' ');
}
