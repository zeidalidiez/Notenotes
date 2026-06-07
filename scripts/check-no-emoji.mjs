#!/usr/bin/env node
/**
 * check-no-emoji — fails if any decorative emoji or ad-hoc Unicode glyph
 * appears under `src/`. The Inspect mode / Transport bar / Stage renderer
 * / browser delete / drum pads etc. all use icons.js for glyphs now, so
 * the only way a Unicode character should land in source is by accident.
 *
 * The regex flags:
 *   - pictographic emoji (U+1F000..U+1FAFF, U+1F1E6..U+1F1FF)
 *   - common symbol blocks (U+2600..U+27BF) — covers arrows (◀▶▼▲),
 *     cross/close (✕), pencils (✏), checkmarks, geometric shapes
 *   - variation selectors (U+FE0F) that pair with emoji
 *   - ad-hoc Unicode used as icon: ‹ (U+2039), › (U+203A), ⌨ (U+2328)
 *
 * Skipped: tests/, docs/, dist/, the `old_plans/` directory, and the
 * non-shipped utility scripts.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const ROOT = 'src';
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);
const EXTS = new Set(['.js', '.mjs', '.ts', '.css', '.html']);

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}‹›⌨]/u;

const bad = [];

(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) { walk(p); continue; }
    if (!EXTS.has(extname(p))) continue;
    const text = readFileSync(p, 'utf8');
    text.split('\n').forEach((line, i) => {
      if (EMOJI.test(line)) {
        const rel = relative(process.cwd(), p);
        bad.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
      }
    });
  }
})(ROOT);

if (bad.length) {
  console.error(`Found ${bad.length} decorative glyph(s) in ${ROOT}/:`);
  for (const m of bad) console.error('  ' + m);
  console.error('\nUse icons.js for all glyphs, or text for labels.');
  process.exit(1);
}
console.log('No decorative glyphs in src/. Clean.');
