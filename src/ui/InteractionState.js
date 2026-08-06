/**
 * Keep visual visibility, keyboard interaction, and accessibility-tree state in
 * sync for animated panels. `inert` lets CSS transitions remain mounted without
 * leaving hidden descendants reachable by Tab or assistive technology.
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function setSubtreeInteractive(element, interactive) {
  if (!element) return;
  element.setAttribute('aria-hidden', interactive ? 'false' : 'true');
  if (interactive) element.removeAttribute('inert');
  else element.setAttribute('inert', '');
}

export function setTabActive(tab, active) {
  if (!tab) return;
  tab.setAttribute('aria-selected', active ? 'true' : 'false');
  tab.setAttribute('tabindex', active ? '0' : '-1');
}

export function focusableElements(container) {
  if (!container?.querySelectorAll) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.disabled || element.getAttribute?.('aria-disabled') === 'true') return false;
    if (element.getAttribute?.('tabindex') === '-1') return false;
    if (element.closest?.('[hidden], [inert], [aria-hidden="true"]')) return false;
    if (typeof getComputedStyle === 'function') {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  });
}
