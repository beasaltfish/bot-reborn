// Where a part dropped on the breadboard ends up. Pure numbers, kept apart
// from the 3D hand code (scene/interact.js) so the tests can reach it without
// three.js.

import { pinPoints, emptyBench } from './bench.js';

/** @typedef {import('./parts.js').PartDef} PartDef */
/** @typedef {import('./bench.js').Placed} Placed */

/**
 * The origin a part dropped with its origin pin at (x, y) — breadboard pitch
 * units, possibly between holes — settles at: the nearest grid point, so every
 * pin is on one. Null when not one pin would be in a hole, or the part never
 * goes in the board: then it goes back to the table.
 *
 * A placement that puts two pins in one strip, or half the part off the edge,
 * is allowed: those are real mistakes, and powering on is where they show.
 * @param {PartDef} def
 * @param {number} x
 * @param {number} y
 * @param {Placed['rot']} rot
 * @returns {{ x: number, y: number } | null}
 */
export function snapPart(def, x, y, rot) {
  if (!def.onBoard) return null;
  const at = { x: Math.round(x), y: Math.round(y) };
  // Ask the bench which holes the pins would be in, so the drop and the
  // netlist turn and count pins the same way.
  /** @type {Placed} */
  const trial = { id: 'trial', part: def.id, at, rot, onBoard: true, burnt: false, discarded: false };
  return pinPoints(emptyBench(), trial).some((p) => p.hole !== null) ? at : null;
}
