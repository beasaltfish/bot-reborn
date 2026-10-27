// Where a part or a board dropped on the table settles. Pure numbers, kept
// apart from the 3D hand code (scene/interact.js) so the tests can reach it
// without three.js.

import { PARTS, BOARD_OUTLINE, JOIN, boardToTable } from './parts.js';
import { pinPoints } from './bench.js';

/** @typedef {import('./parts.js').PartDef} PartDef */
/** @typedef {import('./parts.js').Rot} Rot */
/** @typedef {import('./bench.js').Bench} Bench */

/** Millimetres to pitch units; PARTS gives sizes in mm. */
const MM = 1 / 2.54;

/** @typedef {{ x0: number, x1: number, z0: number, z1: number }} Box */

/**
 * Where a part dropped with its origin pin at (x, z) — table coordinates,
 * possibly between holes — settles: the nearest grid point, so every pin is
 * on one. Null when not one pin would be in a hole, or the part never goes in
 * a board: then it goes back to the table.
 *
 * A placement that puts two pins in one strip, or half the part off the edge,
 * is allowed: those are real mistakes, and powering on is where they show.
 * @param {Bench} b
 * @param {PartDef} def
 * @param {number} x @param {number} z @param {Rot} rot
 * @returns {{ x: number, z: number } | null}
 */
export function snapPart(b, def, x, z, rot) {
  if (!def.onBoard) return null;
  const at = { x: Math.round(x), z: Math.round(z) };
  // Ask the bench which holes the pins would be in, so the drop and the
  // netlist turn and count pins the same way.
  /** @type {import('./bench.js').Placed} */
  const trial = { id: 'trial', part: def.id, at, rot, seated: true, burnt: false };
  return pinPoints(b, trial).some((p) => p.hole !== null) ? at : null;
}

/**
 * Where a dropped board settles: joined to the nearest board edge within 2
 * pitches, else where it was dropped (rounded). Joins need the same rotation,
 * as the dovetails do on a real board.
 * @param {Bench} b
 * @param {string} id the board being dropped (never its own neighbour)
 * @param {number} x @param {number} z @param {Rot} rot
 * @returns {{ x: number, z: number }}
 */
export function snapBoard(b, id, x, z, rot) {
  /** @type {{ x: number, z: number, d: number }[]} */
  const joins = [];
  for (const bd of b.boards) {
    if (bd.id === id || bd.rot !== rot) continue;
    for (const [lx, ly] of [[0, JOIN.long], [0, -JOIN.long], [JOIN.short, 0], [-JOIN.short, 0]]) {
      const at = boardToTable(bd, lx, ly);
      const d = Math.hypot(at.x - x, at.z - z);
      if (Math.abs(at.x - x) <= 2 && Math.abs(at.z - z) <= 2) joins.push({ ...at, d });
    }
  }
  joins.sort((a, c) => a.d - c.d);
  if (joins.length) return { x: joins[0].x, z: joins[0].z };
  return { x: Math.round(x), z: Math.round(z) };
}

/**
 * A part's footprint, turned as it lies: its size on the table and where its
 * middle is from the origin pin. The board of a part starts at the origin pin,
 * which is its first pin, and runs right and down for its size before turning;
 * turning is about that pin, the same quarter turns pinPoints makes.
 * @param {PartDef} def @param {Rot} rot
 * @returns {{ w: number, d: number, dx: number, dz: number }}
 */
export function partFootprint(def, rot) {
  const w = def.size.w * MM;
  const d = def.size.d * MM;
  let dx = w / 2;
  let dz = d / 2;
  for (let i = 0; i < rot / 90; i++) [dx, dz] = [-dz, dx];
  const across = rot === 90 || rot === 270;
  return { w: across ? d : w, d: across ? w : d, dx, dz };
}

/** @param {import('./bench.js').Placed} p @returns {Box} */
function partBox(p) {
  const fp = partFootprint(PARTS[p.part], p.rot);
  const cx = p.at.x + fp.dx;
  const cz = p.at.z + fp.dz;
  return { x0: cx - fp.w / 2, x1: cx + fp.w / 2, z0: cz - fp.d / 2, z1: cz + fp.d / 2 };
}

/**
 * A board's outline on the table, wherever it is turned to: the outline's
 * corners carried through the same transform its holes go through.
 * @param {import('./parts.js').Board} bd @returns {Box}
 */
function boardBox(bd) {
  const a = boardToTable(bd, BOARD_OUTLINE.x0, BOARD_OUTLINE.y0);
  const c = boardToTable(bd, BOARD_OUTLINE.x1, BOARD_OUTLINE.y1);
  return { x0: Math.min(a.x, c.x), x1: Math.max(a.x, c.x), z0: Math.min(a.z, c.z), z1: Math.max(a.z, c.z) };
}

/** @param {Box} a @param {Box} b */
const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;

/**
 * A free spot on the table for a footprint centred on (x, z): the nearest one,
 * searched in rings of one pitch out to 40. Boards and parts lying loose are
 * in the way; parts seated on a board are not (the board is). Ids in `ignore`
 * are the things being carried, and do not block themselves.
 * @param {Bench} b
 * @param {{ w: number, d: number }} footprint
 * @param {number} x @param {number} z
 * @param {string[]} [ignore]
 * @returns {{ x: number, z: number }}
 */
export function freeSpot(b, footprint, x, z, ignore = []) {
  /** @type {Box[]} */
  const taken = b.boards.filter((bd) => !ignore.includes(bd.id)).map(boardBox);
  for (const p of b.placed) if (!p.seated && !ignore.includes(p.id)) taken.push(partBox(p));

  /** @param {number} cx @param {number} cz */
  const free = (cx, cz) => {
    const box = { x0: cx - footprint.w / 2, x1: cx + footprint.w / 2, z0: cz - footprint.d / 2, z1: cz + footprint.d / 2 };
    return !taken.some((t) => overlaps(t, box));
  };

  const home = { x: Math.round(x), z: Math.round(z) };
  if (free(home.x, home.z)) return home;

  for (let r = 1; r <= 40; r++) {
    /** @type {[number, number][]} */
    const ring = [];
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) === r) ring.push([dx, dz]);
      }
    }
    // Straight out before diagonally out: a spot a row down reads better than
    // one a row down and two across.
    ring.sort((a, c) => Math.hypot(a[0], a[1]) - Math.hypot(c[0], c[1]) || a[0] - c[0] || a[1] - c[1]);
    for (const [dx, dz] of ring) if (free(home.x + dx, home.z + dz)) return { x: home.x + dx, z: home.z + dz };
  }
  return home;
}

/** Where the parts bin puts new things down when nothing says where: in front of the opening bench. */
const BIN_DROP = { x: 0, z: 40 };

/**
 * Where a part or board taken from the bin with a click goes: the free spot
 * nearest the front of the bench, as its origin (multi-screen spec §5.1).
 * A board's origin stays on the hole grid, so its holes line up with the
 * other boards'; rounding can nudge it, so the rounded spot is checked again.
 * @param {Bench} b
 * @param {import('./parts.js').PartDef['id'] | 'breadboard'} kind
 * @returns {{ x: number, z: number }}
 */
export function spotForNew(b, kind) {
  if (kind === 'breadboard') {
    const w = BOARD_OUTLINE.x1 - BOARD_OUTLINE.x0;
    const d = BOARD_OUTLINE.y1 - BOARD_OUTLINE.y0;
    const mid = { x: (BOARD_OUTLINE.x0 + BOARD_OUTLINE.x1) / 2, z: (BOARD_OUTLINE.y0 + BOARD_OUTLINE.y1) / 2 };
    // One pitch of margin, so a rounded origin cannot touch a neighbour.
    const spot = freeSpot(b, { w: w + 2, d: d + 2 }, BIN_DROP.x, BIN_DROP.z);
    return { x: Math.round(spot.x - mid.x), z: Math.round(spot.z - mid.z) };
  }
  const fp = partFootprint(PARTS[kind], 0);
  const spot = freeSpot(b, fp, BIN_DROP.x, BIN_DROP.z);
  return { x: spot.x - fp.dx, z: spot.z - fp.dz };
}
