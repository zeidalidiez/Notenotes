/**
 * icons — Single source of truth for functional icons across the app.
 *
 * Icons are sourced from Lucide (https://lucide.dev), ISC-licensed. They
 * are inline SVG strings rather than a runtime dependency so the PWA
 * stays offline-first and the bundle doesn't grow. The convention:
 * 24x24 viewBox, fill="none", stroke="currentColor", stroke-width 2,
 * stroke-linecap/linejoin "round".
 *
 * Sizing is the consumer's choice via the `size` option (defaults to 18,
 * matching the existing TransportBar transport glyphs). The SVG itself
 * is `aria-hidden`; the button or wrapping element must carry the
 * accessible name (`aria-label` or text content).
 *
 * Verification: the path data below was copied from the Lucide source at
 * the time of writing. Re-verify against lucide.dev when bumping — the
 * convention (stroke=2, currentColor, round joins) is the contract; the
 * specific bytes are not.
 */

// Sourced from Lucide (https://lucide.dev), ISC License.
const ICONS = {
  play:    '<polygon points="6 3 20 12 6 21 6 3"/>',
  pause:   '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  stop:    '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  record:  '<circle cx="12" cy="12" r="6"/>',
  x:       '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  share:   '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/>',
  settings:'<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  mic:     '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
  keyboard:'<rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/>',
  database:'<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  chevronDown:  '<path d="m6 9 6 6 6-6"/>',
  chevronUp:    '<path d="m18 15-6-6-6 6"/>',
  chevronLeft:  '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  list:        '<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>',
  layoutGrid:  '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  // Lucide has no metronome; a small custom mark stands in.
  metronome: '<path d="M12 3 6 21h12L12 3z"/><line x1="12" y1="9" x2="16" y2="5"/>',
};

/**
 * Escape a value for safe interpolation into an HTML attribute. The
 * substitution set is the minimum that prevents attribute-context
 * injection from a future caller that derives the value from external
 * data (e.g. a snippet id or a configurable label).
 */
function escAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

/**
 * Render a Lucide icon as an inline SVG string.
 *
 * @param {string} name - one of the keys in ICONS.
 * @param {object} [options]
 * @param {number} [options.size=18] - width/height in CSS pixels.
 * @param {string} [options.className] - extra class for the <svg> element.
 * @param {string} [options.id] - id for the <svg> element.
 * @returns {string} inline SVG markup, or "" if `name` is unknown
 *   (with a `console.warn` so the typo surfaces during development).
 */
export function icon(name, { size = 18, className = '', id = '' } = {}) {
  const body = ICONS[name];
  if (!body) {
    // Surface the failure to the developer instead of returning a silent
    // empty string. The empty-string fallback still keeps the caller
    // from crashing; the warning makes typos / future renames visible.
    if (typeof console !== 'undefined') {
      console.warn(`[icons] Unknown icon name: ${String(name)}`);
    }
    return '';
  }
  const idAttr = id ? ` id="${escAttr(id)}"` : '';
  const cls = className ? ` class="${escAttr(className)}"` : '';
  return `<svg${idAttr} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"${cls}`
       + ` stroke="currentColor" stroke-width="2" stroke-linecap="round"`
       + ` stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
