// The bench as data: which parts are where, which wires join which points,
// whether USB is plugged in. Every function returns a new bench, so the scene
// can keep the old one for undo and compare by identity.
//
// A part with at:null sits on the table; where on the table is the 3D scene's
// business and is not stored. A part with an `at` is in the breadboard, `at`
// being where its origin pin is, in breadboard pitch units (see parts.js).

import { PARTS, holeAt, holeXY } from './parts.js';

/**
 * @typedef {{
 *   id: string, part: import('./parts.js').PartDef['id'],
 *   at: { x: number, y: number } | null, rot: 0 | 90 | 180 | 270,
 *   onBoard: boolean, burnt: boolean, discarded: boolean,
 * }} Placed
 * @typedef {{ id: string, a: string, b: string, color: string }} Wire
 * @typedef {{ v: 1, placed: Placed[], wires: Wire[], usb: boolean }} Bench
 */

/** @type {Placed['rot'][]} */
const ROTS = [0, 90, 180, 270];

/** The four instances a bench starts with; point ids and TARGET use these names. */
const START = /** @type {const} */ ([
  ['esp', 'esp32'], ['mic', 'inmp441'], ['amp', 'max98357a'], ['spk', 'speaker'],
]);

/** @returns {Bench} */
export function emptyBench() {
  return {
    v: 1,
    placed: START.map(([id, part]) => ({ id, part, at: null, rot: 0, onBoard: false, burnt: false, discarded: false })),
    wires: [],
    usb: false,
  };
}

/**
 * Move a part: into the breadboard at `at`, or back to the table with null.
 * @param {Bench} b
 * @param {string} id
 * @param {{ x: number, y: number } | null} at
 * @param {Placed['rot']} rot
 * @returns {Bench}
 */
export function place(b, id, at, rot) {
  const target = b.placed.find((p) => p.id === id);
  if (!target) throw new Error(`no part ${id}`);
  if (at && !PARTS[target.part].onBoard) throw new Error(`${id} cannot go in the breadboard`);
  return {
    ...b,
    placed: b.placed.map((p) => (p === target ? { ...p, at: at && { x: at.x, y: at.y }, rot, onBoard: at !== null } : p)),
  };
}

/**
 * @param {Bench} b
 * @param {string} a
 * @param {string} b2
 * @param {string} color
 * @returns {Bench}
 */
export function addWire(b, a, b2, color) {
  // Past the highest id in use, not the count, so a removed wire's id never comes back.
  const next = Math.max(0, ...b.wires.map((w) => Number(w.id.slice(1)) || 0)) + 1;
  return { ...b, wires: [...b.wires, { id: `w${next}`, a, b: b2, color }] };
}

/**
 * @param {Bench} b
 * @param {string} wireId
 * @returns {Bench}
 */
export function removeWire(b, wireId) {
  return { ...b, wires: b.wires.filter((w) => w.id !== wireId) };
}

/**
 * Throw a burnt part away and take a fresh one from the box. The fresh one
 * keeps the id, so the wires (which name points, not parts) now reach it.
 * @param {Bench} b
 * @param {string} id
 * @returns {Bench}
 */
export function swapBurnt(b, id) {
  const old = b.placed.find((p) => p.id === id && !p.discarded);
  if (!old) throw new Error(`no part ${id}`);
  const gone = b.placed.filter((p) => p.discarded && p.part === old.part).length;
  const discarded = { ...old, id: `${id}-burnt${gone + 1}`, at: null, onBoard: false, burnt: true, discarded: true };
  const fresh = { ...old, at: null, rot: /** @type {const} */ (0), onBoard: false, burnt: false, discarded: false };
  return { ...b, placed: b.placed.flatMap((p) => (p === old ? [fresh, discarded] : [p])) };
}

/**
 * Each pin's point id and the breadboard hole it sits in; null for a part on
 * the table, a wire-only pin, or a pin that falls off the board.
 * @param {Bench} b
 * @param {Placed} placed
 * @returns {{ pin: string, hole: string | null }[]}
 */
export function pinPoints(b, placed) {
  void b;
  return PARTS[placed.part].pins.map((p) => {
    const point = `${placed.id}:${p.name}`;
    if (!placed.at || p.wireOnly) return { pin: point, hole: null };
    // Quarter turns clockwise on a y-down plane: (x, y) → (-y, x).
    let { x, y } = p;
    for (let i = 0; i < placed.rot / 90; i++) [x, y] = [-y, x];
    return { pin: point, hole: holeAt(placed.at.x + x, placed.at.y + y) };
  });
}

/** @param {Bench} b */
export function serialize(b) {
  return JSON.stringify(b);
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, any>}
 */
const isObject = (v) => typeof v === 'object' && v !== null;

/**
 * @param {unknown} p
 * @returns {p is Placed}
 */
function isPlaced(p) {
  if (!isObject(p)) return false;
  const q = p;
  const def = typeof q.part === 'string' && Object.hasOwn(PARTS, q.part) ? PARTS[/** @type {keyof typeof PARTS} */ (q.part)] : null;
  if (typeof q.id !== 'string' || !q.id || !def) return false;
  if (!ROTS.includes(q.rot)) return false;
  if (typeof q.burnt !== 'boolean' || typeof q.discarded !== 'boolean') return false;
  if (q.at === null) return q.onBoard === false;
  return def.onBoard && q.onBoard === true && isObject(q.at) && Number.isFinite(q.at.x) && Number.isFinite(q.at.y);
}

/**
 * @param {unknown} w
 * @returns {w is Wire}
 */
function isWire(w) {
  if (!isObject(w)) return false;
  const q = w;
  return [q.id, q.a, q.b, q.color].every((s) => typeof s === 'string' && s !== '');
}

/**
 * Is this a bench the rest of the code can live with? Each of the four starting
 * instances must be there exactly once and live, a discarded part must carry a
 * burnt id (never a live one), and a wire may only end on a real hole or on a
 * pin of a live part; otherwise there could be no mic for good, or wires that
 * cannot be drawn or deleted but still join nets.
 * @param {Placed[]} placed
 * @param {Wire[]} wires
 */
function isWhole(placed, wires) {
  const live = placed.filter((p) => !p.discarded);
  for (const [id, part] of START) {
    if (live.filter((p) => p.id === id && p.part === part).length !== 1) return false;
  }
  if (live.length !== START.length) return false;
  if (!placed.filter((p) => p.discarded).every((p) => /^[^:]+-burnt\d+$/.test(p.id))) return false;
  /** @param {string} point */
  const real = (point) => {
    if (point.startsWith('bb:')) {
      try { holeXY(point); return true; } catch { return false; }
    }
    const [id, pin] = point.split(':');
    const p = live.find((q) => q.id === id);
    return !!p && PARTS[p.part].pins.some((q) => q.name === pin);
  };
  return wires.every((w) => real(w.a) && real(w.b));
}

/**
 * Read a saved bench. Anything that does not look exactly like one is an empty
 * bench: a half-understood layout would be worse than starting over.
 * @param {string | null} text
 * @returns {Bench}
 */
export function load(text) {
  try {
    const raw = JSON.parse(text ?? '');
    if (!isObject(raw) || raw.v !== 1 || typeof raw.usb !== 'boolean') return emptyBench();
    if (!Array.isArray(raw.placed) || !raw.placed.every(isPlaced)) return emptyBench();
    if (!Array.isArray(raw.wires) || !raw.wires.every(isWire)) return emptyBench();
    if (new Set(raw.placed.map((p) => p.id)).size !== raw.placed.length) return emptyBench();
    if (new Set(raw.wires.map((w) => w.id)).size !== raw.wires.length) return emptyBench();
    if (!isWhole(raw.placed, raw.wires)) return emptyBench();
    return { v: 1, placed: raw.placed, wires: raw.wires, usb: raw.usb };
  } catch {
    return emptyBench();
  }
}
