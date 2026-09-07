/** Keep low-latency pointer actions accessible to native keyboard/AT clicks. */
export function onActivate(element, handler) {
  if (!element) return;
  element.addEventListener('pointerdown', handler);
  element.addEventListener('click', event => {
    if (event.detail === 0) handler(event);
  });
}

export function isNativeControl(target) {
  return Boolean(target?.closest?.('button, a[href], input, select, textarea, summary, [role="button"], [role="tab"], [role="slider"]'));
}

export function isDialogTarget(target) {
  return Boolean(target?.closest?.('[role="dialog"], [aria-modal="true"]'));
}
