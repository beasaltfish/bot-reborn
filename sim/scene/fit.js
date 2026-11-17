// How a frame drawn for one panel size sits on glass of another: fitted, never
// stretched. Pure so the mismatch can be tested without a canvas.
// docs/superpowers/specs/2026-11-16-firmware-layer-design.md §8.1.

/**
 * @param {number} w glass width in pixels
 * @param {number} h glass height in pixels
 * @param {number} sw frame width
 * @param {number} sh frame height
 * @returns {{ x: number, y: number, w: number, h: number, exact: boolean }}
 */
export function fitRect(w, h, sw, sh) {
  if (!sw || !sh) return { x: 0, y: 0, w, h, exact: false };
  // Same shape: fill the glass; rounding is not a mismatch worth a border.
  if (Math.abs(sw * h - sh * w) <= Math.max(w, h) / 2) return { x: 0, y: 0, w, h, exact: true };
  const scale = Math.min(w / sw, h / sh);
  const dw = Math.round(sw * scale);
  const dh = Math.round(sh * scale);
  return { x: Math.round((w - dw) / 2), y: Math.round((h - dh) / 2), w: dw, h: dh, exact: false };
}
