import { focusableElements } from './InteractionState.js';

/** Mount a transient dialog with focus containment and an Escape exit. */
export function mountModal(overlay, { initialFocus } = {}) {
  const previousFocus = document.activeElement;
  const app = document.getElementById('app');
  const wasInert = app?.hasAttribute('inert');
  document.body.appendChild(overlay);
  app?.setAttribute('inert', '');
  const close = () => {
    overlay.remove();
    if (!wasInert) app?.removeAttribute('inert');
    if (previousFocus?.isConnected) previousFocus.focus?.();
  };
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      const elements = focusableElements(overlay);
      const index = elements.indexOf(document.activeElement);
      if (event.shiftKey ? index <= 0 : index === elements.length - 1) {
        event.preventDefault();
        elements[event.shiftKey ? elements.length - 1 : 0]?.focus();
      }
    }
  });
  overlay.addEventListener('pointerdown', event => { if (event.target === overlay) close(); });
  (initialFocus ? overlay.querySelector(initialFocus) : focusableElements(overlay)[0])?.focus();
  return close;
}
