// Space belongs to a focused control, not the temporary bench view.
/** @param {KeyboardEvent} event */
export function isViewPeekShortcut(event) {
  if (event.code !== 'Space' || event.defaultPrevented) return false;
  const target = /** @type {Element | null} */ (event.target);
  return !(target?.nodeType === 1 && target.closest('button, input, select, textarea, a[href], [contenteditable]:not([contenteditable="false"]), [role="button"]'));
}
