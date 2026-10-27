// One frame of the dog, as an SVG string (pet screen spec §7). Everything is
// flat colour and a couple of paths: the frames are rendered to 320×240 JPEGs
// by tools/pet/render.js and decoded by an ESP32, so gradients and filters
// would cost more than they are worth on a small screen filmed off-axis.
//
// The parameters are the whole vocabulary the animator can move:
//   breathe 0..1  chest rise and fall
//   blink   0..1  eyelids, 1 closed
//   tail    deg   wag, about the tail's base
//   sit     0..1  lying → sitting up
//   paw     0..1  raise the right front paw (shake)
//   turn    0..1  one full turn for the spin; 0.25 is edge-on, 0.5 is the back

export const W = 320;
export const H = 240;

const FUR = '#f3c877';
const FUR_MID = '#e5ac5b';
const FUR_DARK = '#c98f42';
const CREAM = '#fdf0d2';
const INK = '#3a2415';
const COLLAR = '#c65b48';
const TAG = '#f5c451';
const CUSHION = '#d98a6a';
const CUSHION_DARK = '#b96a4f';
export const BG = '#cfe6d8';
export const FLOOR = '#b9d8c5';

const lerp = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ t) => a + (b - a) * t;
const num = (/** @type {number} */ n) => Math.round(n * 10) / 10;
/** Scales need more than one decimal: 0.7375 and 0.7 are visibly different. */
const num4 = (/** @type {number} */ n) => Math.round(n * 10000) / 10000;

// The dog and cushion, measured over every frame of every animation, as half
// extents about the middle of the 320×240 scene (x 48..275, y 43..225), plus
// 2 px so a tail tip at full wag cannot touch the glass's edge. A round screen
// only shows the inscribed circle, so that circle has to hold this box.
const CONTENT_HALF_W = 118;
const CONTENT_HALF_H = 108;
const CONTENT_RADIUS = Math.hypot(CONTENT_HALF_W, CONTENT_HALF_H);

/**
 * Map the 320×240 scene into a w×h canvas: scale s, then shift by (dx, dy).
 * 320×240 must be the identity, so the author's panel is untouched.
 * @param {number} w @param {number} h @param {boolean} round
 * @returns {{ scale: number, dx: number, dy: number }}
 */
export function fitDog(w, h, round) {
  const scale = round
    // 2 px of margin: an anti-aliased ear must not reach the circle's edge.
    ? (Math.min(w, h) / 2 - 2) / CONTENT_RADIUS
    : Math.min(w / W, h / H);
  return { scale, dx: (w - W * scale) / 2, dy: (h - H * scale) / 2 };
}

/**
 * @param {{ breathe?: number, blink?: number, tail?: number, sit?: number,
 *           paw?: number, turn?: number }} [p]
 * @param {{ w: number, h: number, round: boolean }} [size]
 * @returns {string} an SVG document on that canvas; default 320×240
 */
export function drawDog(p = {}, size) {
  const canvas = size ?? { w: W, h: H, round: false };
  const { scale, dx, dy } = fitDog(canvas.w, canvas.h, canvas.round);
  const breathe = p.breathe ?? 0;
  const blink = p.blink ?? 0;
  const tail = p.tail ?? 0;
  const sit = p.sit ?? 0;
  const paw = p.paw ?? 0;
  const turn = p.turn ?? 0;

  // One full turn about the vertical axis, drawn as a horizontal squash with
  // the back of the dog swapped in for the front half of the way round.
  const wave = turn * Math.PI * 2;
  const back = Math.cos(wave) < 0;
  // Not all the way to edge-on: a sliver of a dog reads as a glitch. Half-way
  // squash plus a sideways lean reads as a turn, which is what it is.
  const squash = Math.max(0.52, Math.abs(Math.cos(wave)));
  const lean = Math.sin(wave) * 12;

  const bodyY = lerp(174, 156, sit) - 2 * breathe;
  const bodyRy = lerp(34, 50, sit) + 2 * breathe;
  const bodyRx = lerp(78, 64, sit);
  const headY = lerp(122, 92, sit) - 3 * breathe;
  const headR = lerp(44, 46, sit);
  const pawY = 202;
  const legH = lerp(18, 46, sit);
  const legY = pawY - legH;
  const tailBaseX = 160 + bodyRx - 6;
  const tailBaseY = bodyY - 16;

  /** A front leg, straight down, with a paw. */
  const leg = (/** @type {number} */ x) => `
    <rect x="${num(x - 9)}" y="${num(legY)}" width="18" height="${num(legH + 8)}" rx="9" fill="${FUR_MID}"/>
    <ellipse cx="${num(x)}" cy="${pawY}" rx="12" ry="8" fill="${CREAM}"/>`;

  const eyes = blink > 0.6
    ? `<path d="M ${num(160 - 22)} ${num(headY - 6)} q 6 6 12 0" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>
       <path d="M ${num(160 + 10)} ${num(headY - 6)} q 6 6 12 0" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>`
    : `<ellipse cx="${160 - 16}" cy="${num(headY - 6)}" rx="5.5" ry="${num(5.5 * (1 - blink * 0.85))}" fill="${INK}"/>
       <ellipse cx="${160 + 16}" cy="${num(headY - 6)}" rx="5.5" ry="${num(5.5 * (1 - blink * 0.85))}" fill="${INK}"/>
       <circle cx="${160 - 14}" cy="${num(headY - 8)}" r="1.8" fill="#fff"/>
       <circle cx="${160 + 18}" cy="${num(headY - 8)}" r="1.8" fill="#fff"/>`;

  const face = back ? `
    <ellipse cx="160" cy="${num(headY + 4)}" rx="${num(headR - 6)}" ry="${num(headR - 10)}" fill="${FUR_MID}" opacity="0.5"/>`
    : `
    <ellipse cx="160" cy="${num(headY + 15)}" rx="26" ry="18" fill="${CREAM}"/>
    <ellipse cx="160" cy="${num(headY + 6)}" rx="9" ry="7" fill="${INK}"/>
    <circle cx="157" cy="${num(headY + 4)}" r="2" fill="#6b5646" opacity="0.7"/>
    ${eyes}
    <path d="M 160 ${num(headY + 12)} v 5" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M 160 ${num(headY + 17)} q -7 6 -13 1" stroke="${INK}" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <path d="M 160 ${num(headY + 17)} q 7 6 13 1" stroke="${INK}" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    ${paw > 0.5 ? `<ellipse cx="160" cy="${num(headY + 27)}" rx="8" ry="${num(4 + 6 * (paw - 0.5))}" fill="#e8836f"/>` : ''}
    <ellipse cx="${160 - 34}" cy="${num(headY + 8)}" rx="9" ry="5" fill="#ef9b7f" opacity="0.45"/>
    <ellipse cx="${160 + 34}" cy="${num(headY + 8)}" rx="9" ry="5" fill="#ef9b7f" opacity="0.45"/>`;

  // The ears hang from the sides of the head; floppy, so they swing a little
  // with the breath instead of being glued on.
  const earY = headY - 14 - 2 * breathe;
  const ear = (/** @type {number} */ side) => `
    <path d="M ${num(160 + side * (headR - 8))} ${num(earY)}
             q ${side * 26} 6 ${side * 20} 40
             q ${side * -4} 16 ${side * -22} 8
             q ${side * -8} -24 ${side * -6} -44 z"
          fill="${FUR_MID}"/>
    <path d="M ${num(160 + side * (headR - 6))} ${num(earY + 8)}
             q ${side * 14} 6 ${side * 10} 28
             q ${side * -2} 10 ${side * -12} 6 z"
          fill="${FUR_DARK}" opacity="0.45"/>`;

  // The paw is drawn AFTER the head: a paw raised beside the face and hidden
  // behind it is the one thing this animation exists to show. It hangs off a
  // shoulder inside the body, so the arm is attached at every wiggle.
  const shoulderX = 122;
  const shoulderY = lerp(168, 156, sit);
  const pawX = 92;
  const pawY2 = lerp(shoulderY - 6, 96, paw);
  const wiggle = Math.sin(paw * Math.PI * 3) * 9;
  const raisedPaw = paw > 0.02 ? `
    <g transform="rotate(${num(wiggle)} ${shoulderX} ${num(shoulderY)})">
      <path d="M ${shoulderX} ${num(shoulderY)} Q ${num(shoulderX - 22)} ${num((shoulderY + pawY2) / 2)} ${pawX - 4} ${num(pawY2)}"
            stroke="${FUR_MID}" stroke-width="19" fill="none" stroke-linecap="round"/>
      <ellipse cx="${pawX - 6}" cy="${num(pawY2 - 4)}" rx="13" ry="10" fill="${CREAM}"
               transform="rotate(-28 ${pawX - 6} ${num(pawY2 - 4)})"/>
      <path d="M ${pawX - 14} ${num(pawY2 - 10)} q 5 5 10 0" stroke="${FUR_DARK}" stroke-width="2" fill="none" stroke-linecap="round"/>
    </g>` : '';

  // Everything that is the same at every size: the cushion and the dog. The
  // background and the floor are NOT in here — they stretch to the canvas,
  // and even on a round screen the floor reaches the glass's lower edge.
  const scene = `
  <ellipse cx="160" cy="196" rx="112" ry="30" fill="${CUSHION_DARK}"/>
  <ellipse cx="160" cy="192" rx="104" ry="26" fill="${CUSHION}"/>
  <ellipse cx="160" cy="190" rx="78" ry="16" fill="#e39c7c"/>
  <g transform="translate(${num(160 + lean)} 0) scale(${num(squash)} 1) translate(-160 0)">
    <path d="M ${num(tailBaseX)} ${num(tailBaseY)}
             C ${num(tailBaseX + 30)} ${num(tailBaseY - 4)}, ${num(tailBaseX + 38)} ${num(tailBaseY - 34)}, ${num(tailBaseX + 22)} ${num(tailBaseY - 46)}"
          stroke="${FUR_MID}" stroke-width="17" fill="none" stroke-linecap="round"
          transform="rotate(${num(tail)} ${num(tailBaseX)} ${num(tailBaseY)})"/>
    <ellipse cx="160" cy="${num(bodyY + bodyRy * 0.72)}" rx="${num(bodyRx * 0.94)}" ry="${num(bodyRy * 0.34)}" fill="${FUR_DARK}" opacity="0.18"/>
    <ellipse cx="160" cy="${num(bodyY)}" rx="${num(bodyRx)}" ry="${num(bodyRy)}" fill="${FUR}"/>
    ${back ? '' : `<ellipse cx="160" cy="${num(bodyY + 6)}" rx="${num(bodyRx * 0.55)}" ry="${num(bodyRy * 0.62)}" fill="${FUR_MID}" opacity="0.35"/>`}
    ${leg(160 - 34)}${leg(160 + 34)}
    <ellipse cx="160" cy="${num(headY + headR * 0.74)}" rx="${num(headR * 0.72)}" ry="9" fill="${COLLAR}"/>
    ${back ? '' : `<circle cx="160" cy="${num(headY + headR * 0.74 + 9)}" r="6" fill="${TAG}"/>`}
    <circle cx="160" cy="${num(headY)}" r="${num(headR)}" fill="${FUR}"/>
    ${ear(-1)}${ear(1)}
    ${face}
    ${raisedPaw}
  </g>`;

  // The author's 320×240 panel: byte-for-byte the picture that existed before
  // other sizes did, with no wrapper group to shift the numbers.
  if (scale === 1 && dx === 0 && dy === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" width="320" height="240">
  <rect width="320" height="240" fill="${BG}"/>
  <rect y="176" width="320" height="64" fill="${FLOOR}"/>${scene}
</svg>`;
  }

  const floorY = dy + 176 * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas.w} ${canvas.h}" width="${canvas.w}" height="${canvas.h}">
  <rect width="${canvas.w}" height="${canvas.h}" fill="${BG}"/>
  <rect y="${num(floorY)}" width="${canvas.w}" height="${num(canvas.h - floorY)}" fill="${FLOOR}"/>
  <g transform="translate(${num(dx)} ${num(dy)}) scale(${num4(scale)})">${scene}
  </g>
</svg>`;
}
