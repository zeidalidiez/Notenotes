/**
 * Escape untrusted display text before interpolating it into an HTML template.
 * Prefer textContent when building DOM nodes directly; these helpers are for
 * the template-string renderers used throughout the app.
 */
export function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

export function escapeAttr(value = '') {
  return escapeHtml(value);
}
