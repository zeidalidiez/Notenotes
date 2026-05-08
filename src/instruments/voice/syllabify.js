/**
 * syllabify — greedy bank-based syllable splitter.
 *
 * Why a custom splitter and not an npm package:
 * - Notenotes is vanilla JS, no framework, small bundle.
 * - English-syllable npm libraries split words generically; we need
 *   splits that match the loaded voice's bank, which is more specific.
 * - "Bank-aware" splitting means as voices grow their syllable lists,
 *   the splitter automatically recognizes more without code changes.
 *
 * Algorithm:
 * 1. Split input on whitespace runs (user-explicit syllable boundaries).
 * 2. For each non-whitespace word, walk left-to-right.
 *    At each position, try the longest prefix that matches the bank.
 *    If no prefix matches, take one character and mark it invalid.
 * 3. Invalid tokens flag a chunk that the loaded voice cannot sing.
 *    The user can refine by adding spaces.
 *
 * The output is an array of tokens. Each token has:
 *   - text: the substring
 *   - valid: true if the loaded voice has this syllable
 *   - isWhitespace: true if the token is just whitespace
 */

/**
 * Split text into a sequence of token objects against a syllable bank.
 *
 * @param {string} text - User input, ASCII-ish English. Pre-validated by the caller.
 * @param {Set<string>} bank - Set of syllable IDs the loaded voice supports.
 *   Use lowercase IDs; this function lowercases the input before matching.
 * @returns {Array<{ text: string, valid: boolean, isWhitespace: boolean }>}
 */
export function syllabify(text, bank) {
  if (!text || typeof text !== 'string') return [];
  if (!(bank instanceof Set) || bank.size === 0) {
    return [{ text, valid: false, isWhitespace: false }];
  }

  // Precompute longest syllable length in the bank so the inner loop bounds itself.
  let maxLen = 1;
  for (const id of bank) {
    if (id.length > maxLen) maxLen = id.length;
  }

  const tokens = [];
  // Split into runs: alternating whitespace/non-whitespace segments.
  const runs = text.match(/\s+|\S+/g) || [];

  for (const run of runs) {
    if (/^\s+$/.test(run)) {
      tokens.push({ text: run, valid: false, isWhitespace: true });
      continue;
    }
    const word = run.toLowerCase();
    let pos = 0;
    while (pos < word.length) {
      const remaining = word.length - pos;
      const tryLen = Math.min(maxLen, remaining);
      let matched = null;
      for (let len = tryLen; len >= 1; len--) {
        const candidate = word.slice(pos, pos + len);
        if (bank.has(candidate)) {
          matched = { text: candidate, valid: true, isWhitespace: false };
          pos += len;
          break;
        }
      }
      if (!matched) {
        tokens.push({ text: word[pos], valid: false, isWhitespace: false });
        pos += 1;
      } else {
        tokens.push(matched);
      }
    }
  }

  return tokens;
}

/**
 * Filter the syllabified tokens to just the playable syllables (in order).
 *
 * @param {Array<{text: string, valid: boolean, isWhitespace: boolean}>} tokens
 * @returns {Array<string>} Array of valid syllable IDs.
 */
export function extractPlayableSyllables(tokens) {
  if (!Array.isArray(tokens)) return [];
  const out = [];
  for (const t of tokens) {
    if (t.valid && !t.isWhitespace) out.push(t.text);
  }
  return out;
}

/**
 * Validate that input contains only ASCII letters, spaces, hyphens, apostrophes.
 * Anything else (non-Latin scripts, emoji, control chars) returns false.
 * The caller can use this to gate the input field at the keystroke level.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isValidPhraseInput(text) {
  if (typeof text !== 'string') return false;
  return /^[A-Za-z\s'\-]*$/.test(text);
}

/**
 * Strip any non-ASCII letter characters from input, preserving whitespace.
 * Use this on paste / programmatic insertion to silently sanitize.
 *
 * @param {string} text
 * @returns {string}
 */
export function sanitizePhraseInput(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/[^A-Za-z\s'\-]/g, '');
}
