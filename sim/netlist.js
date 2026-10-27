// Which points of the bench are electrically one: the bench state reduced to
// nets. Union-find over each board's strips, pins sitting in holes, the pins a
// part joins inside itself, and wires. Power-on rules and the hover highlight
// both read it; neither needs to know how the bench is laid out.
//
// Strips belong to a board instance ("bb2:col12-top"), and a part's holes come
// from pinPoints, so a part straddling two joined boards is joined to a strip
// on each — no special case (multi-screen spec §5.3).

import { PARTS, BREADBOARD, holeStrip } from './parts.js';
import { pinPoints } from './bench.js';

/** @typedef {{ netOf(point: string): string, same(a: string, b: string): boolean, members(point: string): string[] }} Nets */

/** Every hole of one board, grouped by its local strip; the board never changes. */
const STRIPS = (() => {
  /** @type {Map<string, string[]>} */
  const strips = new Map();
  /** @param {string} hole */
  const add = (hole) => {
    const s = holeStrip(hole);
    strips.set(s, [...(strips.get(s) ?? []), hole]);
  };
  for (const row of BREADBOARD.rows) for (let c = 1; c <= BREADBOARD.cols; c++) add(`${row}${c}`);
  for (const rail of BREADBOARD.rails) for (let n = 1; n <= 50; n++) add(`${rail}${n}`);
  return [...strips.values()];
})();

/**
 * @param {import('./bench.js').Bench} b
 * @returns {Nets}
 */
export function nets(b) {
  /** @type {Map<string, string>} */
  const parent = new Map();
  /** @param {string} p */
  const find = (p) => {
    let root = p;
    while (parent.has(root) && parent.get(root) !== root) root = /** @type {string} */ (parent.get(root));
    // Point every step at the root so the next lookup is one hop.
    for (let q = p; q !== root; ) {
      const next = /** @type {string} */ (parent.get(q));
      parent.set(q, root);
      q = next;
    }
    return root;
  };
  /**
   * @param {string} a
   * @param {string} c
   */
  const join = (a, c) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(c)) parent.set(c, c);
    const ra = find(a);
    const rc = find(c);
    if (ra !== rc) parent.set(rc, ra);
  };

  for (const bd of b.boards) {
    for (const holes of STRIPS) for (const h of holes) join(`${bd.id}:${holes[0]}`, `${bd.id}:${h}`);
  }
  for (const placed of b.placed) {
    // A burnt part is still plugged in and still conducts; it is only dead.
    for (const { pin, hole } of pinPoints(b, placed)) {
      if (hole) join(hole, pin);
      else if (!parent.has(pin)) parent.set(pin, pin);
    }
    for (const group of PARTS[placed.part].internal) {
      for (const name of group) join(`${placed.id}:${group[0]}`, `${placed.id}:${name}`);
    }
  }
  for (const w of b.wires) join(w.a, w.b);

  /** @param {string} p */
  const netOf = (p) => (parent.has(p) ? find(p) : p);
  return {
    netOf,
    same: (a, c) => netOf(a) === netOf(c),
    members(p) {
      if (!parent.has(p)) return [p];
      const root = find(p);
      return [...parent.keys()].filter((q) => find(q) === root).sort();
    },
  };
}
