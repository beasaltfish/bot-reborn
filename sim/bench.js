// The bench as data: which boards stand where, which parts are on them or on
// the table, which wires join which points, whether USB is plugged in. Every
// function returns a new bench, so the scene can keep the old one for undo and
// compare by identity.
//
// Positions are table coordinates, in breadboard pitch units (multi-screen
// spec §5.3): `at` is where a part's origin pin sits, so the same numbers work
// whether the part is seated or on the table. A seated part's `at` is on the
// integer grid; which hole a pin is in is worked out from the boards under it,
// which is what lets a part straddle two joined boards.

import { PARTS, holeXY, boardToTable, tableToBoard, holeOnTable, boardGroups } from './parts.js';

/**
 * @typedef {import('./parts.js').PartDef['id']} PartId
 * @typedef {import('./parts.js').Rot} Rot
 * @typedef {import('./parts.js').Board} Board
 * @typedef {{
 *   id: string, part: PartId,
 *   at: { x: number, z: number },      // the origin pin's table position
 *   rot: Rot, seated: boolean, burnt: boolean,
 * }} Placed
 * @typedef {{ id: string, a: string, b: string, color: string }} Wire
 * @typedef {{ v: 2, boards: Board[], placed: Placed[], wires: Wire[], usb: boolean }} Bench
 */

/** @type {Rot[]} */
const ROTS = [0, 90, 180, 270];

/**
 * The opening bench: one board in the middle and the four starting parts in
 * front of it, where the old fixed slots put them (world and table coordinates
 * are the same numbers now, so the opening picture does not move).
 * @returns {Bench}
 */
export function emptyBench() {
  return {
    v: 2,
    boards: [{ id: 'bb1', x: -31, z: -9, rot: 0 }],
    placed: [
      { id: 'esp', part: 'esp32', at: { x: -10.5, z: 16 }, rot: 0, seated: false, burnt: false },
      { id: 'mic', part: 'inmp441', at: { x: 29, z: 17.5 }, rot: 0, seated: false, burnt: false },
      { id: 'amp', part: 'max98357a', at: { x: 18, z: 15.5 }, rot: 0, seated: false, burnt: false },
      { id: 'spk', part: 'speaker', at: { x: -34, z: 15.5 }, rot: 0, seated: false, burnt: false },
    ],
    wires: [],
    usb: false,
  };
}

/**
 * The smallest free stem: the first instance has no number (mic), then mic2,
 * mic3… so the opening bench keeps the names TARGET and the tests use.
 * @param {Bench} b @param {string} prefix
 */
function nextId(b, prefix) {
  const taken = new Set(b.placed.map((p) => p.id));
  if (!taken.has(prefix)) return prefix;
  for (let n = 2; ; n++) if (!taken.has(`${prefix}${n}`)) return `${prefix}${n}`;
}

/**
 * A new part on the table. It starts unseated: dropping one onto a board is a
 * separate move (`place`), and the parts bin puts it down first.
 * @param {Bench} b
 * @param {PartId} part
 * @param {{ x: number, z: number }} at
 * @returns {{ bench: Bench, id: string }}
 */
export function addPart(b, part, at) {
  // The ESP32 is the bench's one fixed piece, and load() insists on exactly
  // one: a second would be a bench that cannot be read back.
  if (PARTS[part].prefix === 'esp') throw new Error('the bench has one ESP32');
  const id = nextId(b, PARTS[part].prefix);
  const placed = { id, part, at: { x: at.x, z: at.z }, rot: /** @type {Rot} */ (0), seated: false, burnt: false };
  return { bench: { ...b, placed: [...b.placed, placed] }, id };
}

/**
 * A new breadboard on the table, id bb1, bb2… Boards are always numbered:
 * "bb" alone reads as the old single-board point ids.
 * @param {Bench} b
 * @param {{ x: number, z: number }} at
 * @param {Rot} [rot]
 * @returns {{ bench: Bench, id: string }}
 */
export function addBoard(b, at, rot = 0) {
  let n = 1;
  while (b.boards.some((bd) => bd.id === `bb${n}`)) n++;
  const id = `bb${n}`;
  const board = { id, x: Math.round(at.x), z: Math.round(at.z), rot };
  return { bench: { ...b, boards: [...b.boards, board] }, id };
}

/**
 * Each pin's point id and the breadboard hole it sits in; null for a part on
 * the table, a wire-only pin, or a pin that falls on no hole.
 * @param {Bench} b
 * @param {Placed} placed
 * @returns {{ pin: string, hole: string | null }[]}
 */
export function pinPoints(b, placed) {
  return PARTS[placed.part].pins.map((p) => {
    const pin = `${placed.id}:${p.name}`;
    if (!placed.seated || p.wireOnly) return { pin, hole: null };
    // Quarter turns clockwise on a y-down plane: (x, y) → (-y, x).
    let { x, y } = p;
    for (let i = 0; i < placed.rot / 90; i++) [x, y] = [-y, x];
    return { pin, hole: holeOnTable(b.boards, placed.at.x + x, placed.at.z + y) };
  });
}

/**
 * A part into the breadboard at a table position, or back to the table.
 * A seated part must be on the integer grid and have at least one pin in a
 * hole — a part in no hole is not seated, it is lying on the board.
 * @param {Bench} b
 * @param {string} id
 * @param {{ x: number, z: number }} at
 * @param {Rot} rot
 * @param {boolean} seated
 * @returns {Bench}
 */
export function place(b, id, at, rot, seated) {
  const target = b.placed.find((p) => p.id === id);
  if (!target) throw new Error(`no part ${id}`);
  if (seated) {
    if (!PARTS[target.part].onBoard) throw new Error(`${id} cannot go in the breadboard`);
    if (!Number.isInteger(at.x) || !Number.isInteger(at.z)) throw new Error(`${id} must sit on the hole grid`);
    const trial = { ...target, at, rot, seated: true };
    if (!pinPoints(b, trial).some((q) => q.hole !== null)) throw new Error(`${id} would sit in no hole`);
  }
  return {
    ...b,
    placed: b.placed.map((p) => (p === target ? { ...p, at: { x: at.x, z: at.z }, rot, seated } : p)),
  };
}

/**
 * Move a board. `alone: false` moves the whole group it is joined to, as one
 * rigid piece: every board keeps its place in the group and every part plugged
 * into any of them keeps its holes. `alone: true` takes just this board off;
 * a part with pins in this board and in a neighbour would tear, so that is
 * refused and the caller puts the board back.
 * @param {Bench} b
 * @param {string} id
 * @param {{ x: number, z: number }} at the board's new origin
 * @param {Rot} rot
 * @param {boolean} alone
 * @returns {Bench | { refused: 'spans' }}
 */
export function moveBoard(b, id, at, rot, alone) {
  const old = b.boards.find((bd) => bd.id === id);
  if (!old) throw new Error(`no board ${id}`);
  const group = boardGroups(b.boards).find((g) => g.includes(id)) ?? [id];
  const moving = alone ? [id] : group;
  /** @type {(n: number) => Rot} */
  const delta = (n) => /** @type {Rot} */ (((n % 360) + 360) % 360);
  const drot = delta(rot - old.rot);

  // A part whose pins are in this board and in another board it is not moving
  // with would be pulled apart.
  for (const p of b.placed) {
    if (!p.seated) continue;
    const on = new Set(pinPoints(b, p).flatMap((q) => (q.hole ? [q.hole.slice(0, q.hole.indexOf(':'))] : [])));
    if (!on.has(id)) continue;
    if ([...on].some((other) => other !== id && group.includes(other) && !moving.includes(other))) {
      return { refused: 'spans' };
    }
  }

  /** @type {Map<string, Board>} */
  const boards = new Map();
  for (const bd of b.boards) {
    if (!moving.includes(bd.id)) { boards.set(bd.id, bd); continue; }
    if (bd.id === id) { boards.set(bd.id, { ...bd, x: Math.round(at.x), z: Math.round(at.z), rot }); continue; }
    // Rigid move: the dragged board's origin is the pivot.
    let dx = bd.x - old.x;
    let dz = bd.z - old.z;
    for (let i = 0; i < drot / 90; i++) [dx, dz] = [-dz, dx];
    boards.set(bd.id, { ...bd, x: Math.round(at.x + dx), z: Math.round(at.z + dz), rot: delta(bd.rot + drot) });
  }

  // Parts plugged into a moving board ride with it: the same point on the same
  // board, moved, is a new table position.
  const placed = b.placed.map((p) => {
    if (!p.seated) return p;
    const on = pinPoints(b, p).find((q) => q.hole && moving.includes(q.hole.slice(0, q.hole.indexOf(':'))));
    if (!on || !on.hole) return p;
    const boardId = on.hole.slice(0, on.hole.indexOf(':'));
    const from = /** @type {Board} */ (b.boards.find((bd) => bd.id === boardId));
    const to = /** @type {Board} */ (boards.get(boardId));
    const local = tableToBoard(from, p.at.x, p.at.z);
    const next = boardToTable(to, local.x, local.y);
    return { ...p, at: next, rot: delta(p.rot + drot) };
  });

  return { ...b, boards: [...boards.values()], placed };
}

/**
 * The bin (multi-screen spec §5.4). A part takes its wires with it; a board
 * leaves the parts that were plugged into it on the table where they stood,
 * and takes the wires that ended in its holes. The ESP32 stays: it is the only
 * one, and the bench is built around it.
 * @param {Bench} b
 * @param {string} id
 * @returns {Bench | { refused: 'esp' }}
 */
export function trash(b, id) {
  const part = b.placed.find((p) => p.id === id);
  if (part) {
    if (part.part === 'esp32') return { refused: 'esp' };
    const pins = new Set(PARTS[part.part].pins.map((p) => `${id}:${p.name}`));
    return {
      ...b,
      placed: b.placed.filter((p) => p !== part),
      wires: b.wires.filter((w) => !pins.has(w.a) && !pins.has(w.b)),
    };
  }
  const board = b.boards.find((bd) => bd.id === id);
  if (!board) throw new Error(`no part or board ${id}`);
  const inHole = (/** @type {string} */ point) => point.startsWith(`${id}:`);
  return {
    ...b,
    boards: b.boards.filter((bd) => bd !== board),
    // Anything plugged into this board comes out and stays where it was.
    placed: b.placed.map((p) => (p.seated && pinPoints(b, p).some((q) => q.hole && inHole(q.hole))
      ? { ...p, seated: false }
      : p)),
    wires: b.wires.filter((w) => !inHole(w.a) && !inHole(w.b)),
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
 * Is this point one of a board's holes? ("bb2:a6", not "esp:GND".)
 * @param {Bench} b
 * @param {string} point
 */
export function isHole(b, point) {
  const i = point.indexOf(':');
  if (i < 0) return false;
  const boardId = point.slice(0, i);
  if (!b.boards.some((bd) => bd.id === boardId)) return false;
  try {
    holeXY(point.slice(i + 1));
    return true;
  } catch {
    return false;
  }
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

/** @param {unknown} v @returns {v is number} */
const isCoord = (v) => typeof v === 'number' && Number.isFinite(v);

/** @param {unknown} bd @returns {bd is Board} */
function isBoard(bd) {
  if (!isObject(bd)) return false;
  return typeof bd.id === 'string' && bd.id !== ''
    && Number.isInteger(bd.x) && Number.isInteger(bd.z)
    && ROTS.includes(bd.rot);
}

/** @param {unknown} p @returns {p is Placed} */
function isPlaced(p) {
  if (!isObject(p)) return false;
  if (typeof p.id !== 'string' || !p.id) return false;
  if (typeof p.part !== 'string' || !Object.hasOwn(PARTS, p.part)) return false;
  if (!ROTS.includes(p.rot)) return false;
  if (typeof p.seated !== 'boolean' || typeof p.burnt !== 'boolean') return false;
  if (!isObject(p.at) || !isCoord(p.at.x) || !isCoord(p.at.z)) return false;
  // A part on the table may sit anywhere; a seated one is on the hole grid.
  return !p.seated || (Number.isInteger(p.at.x) && Number.isInteger(p.at.z));
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
 * Read a saved bench. Only version 2 is understood: an old layout is a
 * different bench and is started over rather than migrated (spec §5.6).
 *
 * A bench that is not whole is not half-loaded: exactly one ESP32, unique ids,
 * every wire end on a real hole or a real pin, seated parts on the grid.
 * Anything else means the layout would draw or save wrong, which is worse than
 * starting fresh.
 * @param {string | null} text
 * @returns {Bench}
 */
export function load(text) {
  try {
    const raw = JSON.parse(text ?? '');
    if (!isObject(raw) || raw.v !== 2 || typeof raw.usb !== 'boolean') return emptyBench();
    if (!Array.isArray(raw.boards) || !raw.boards.every(isBoard)) return emptyBench();
    if (!Array.isArray(raw.placed) || !raw.placed.every(isPlaced)) return emptyBench();
    if (!Array.isArray(raw.wires) || !raw.wires.every(isWire)) return emptyBench();

    const boards = /** @type {Board[]} */ (raw.boards);
    const placed = /** @type {Placed[]} */ (raw.placed);
    const wires = /** @type {Wire[]} */ (raw.wires);
    if (new Set(boards.map((bd) => bd.id)).size !== boards.length) return emptyBench();
    if (new Set(placed.map((p) => p.id)).size !== placed.length) return emptyBench();
    if (new Set(wires.map((w) => w.id)).size !== wires.length) return emptyBench();
    // A part and a board sharing an id would make "bb1:a6" mean two things.
    if (placed.some((p) => boards.some((bd) => bd.id === p.id))) return emptyBench();
    if (placed.filter((p) => p.part === 'esp32').length !== 1) return emptyBench();

    const bench = /** @type {Bench} */ ({ v: 2, boards, placed, wires, usb: raw.usb });
    /** @param {string} point */
    const realPin = (point) => {
      const i = point.indexOf(':');
      if (i < 0) return false;
      const p = placed.find((q) => q.id === point.slice(0, i));
      return !!p && PARTS[p.part].pins.some((q) => q.name === point.slice(i + 1));
    };
    if (!wires.every((w) => (isHole(bench, w.a) || realPin(w.a)) && (isHole(bench, w.b) || realPin(w.b)))) {
      return emptyBench();
    }
    return bench;
  } catch {
    return emptyBench();
  }
}
