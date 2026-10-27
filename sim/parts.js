// What the simulator knows about its parts and its breadboard, as plain data:
// no three.js, no DOM, so the netlist, the power-on rules and the tests can all
// read it. The 3D scene turns the same numbers into meshes.
//
// Lengths are in breadboard pitch units (one unit = 2.54 mm) unless a field
// says mm. Point ids everywhere are "<instanceId>:<pinName>" ("mic:VDD",
// "esp:GPIO12") or "<boardId>:<hole>" for a breadboard hole ("bb2:a6").
//
// A breadboard is an instance with a place on the table (multi-screen spec
// §5.3): its holes are named locally ("a6", "tp7") and the table maps a point
// to a board and a hole. Two boards can be joined edge to edge, and a part can
// straddle the seam, so a pin's hole is looked up in table space, not stored.

/**
 * x,y in pitch units, part-local, the part's origin being its first pin.
 * `wireOnly` pins (a screw terminal) never go into a breadboard hole.
 * @typedef {{ name: string, x: number, y: number, wireOnly?: boolean }} Pin
 */

/**
 * `internal` lists pins the part joins inside itself. `onBoard` false means the
 * part may not be pushed into the breadboard (the speaker); it is wired only.
 * @typedef {{
 *   id: 'esp32' | 'inmp441' | 'max98357a' | 'speaker',
 *   label: string,
 *   size: { w: number, d: number, h: number },
 *   pins: Pin[], internal: string[][],
 *   onBoard: boolean,
 * }} PartDef
 */

/**
 * Pin names as printed on the board (docs/media/esp32-s3-board.jpg), top row
 * then bottom row. A name that appears more than once (GND, 3V3) is one point
 * id for the first and ".2", ".3"... for the rest, so every pin can be wired
 * to on its own; `internal` below says they are the same net.
 */
const ESP_TOP = 'GND 5V 14 13 12 11 10 9 46 3 8 18 17 16 15 7 6 5 4 RST 3V3 3V3'.split(' ');
const ESP_BOTTOM = 'GND GND 19 20 21 47 48 45 0 35 36 37 38 39 40 41 42 2 1 RX TX GND'.split(' ');

/**
 * @param {string[]} row
 * @param {number} y
 * @param {Map<string, number>} seen
 * @returns {Pin[]}
 */
function espRow(row, y, seen) {
  return row.map((label, x) => {
    const base = /^\d+$/.test(label) ? `GPIO${label}` : label;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { name: n === 1 ? base : `${base}.${n}`, x, y };
  });
}

const espSeen = new Map();
// The two rows of a DevKitC are 10 pitches (25.4 mm) apart.
const ESP_PINS = [...espRow(ESP_TOP, 0, espSeen), ...espRow(ESP_BOTTOM, 10, espSeen)];

/** @param {string} base */
const sameNet = (base) => ESP_PINS.map((p) => p.name).filter((n) => n === base || n.startsWith(`${base}.`));

/** @type {Record<PartDef['id'], PartDef>} */
export const PARTS = {
  esp32: {
    id: 'esp32',
    label: 'ESP32-S3',
    size: { w: 70, d: 28, h: 12 },
    pins: ESP_PINS,
    internal: [sameNet('GND'), sameNet('3V3')],
    onBoard: true,
  },
  // The module has three pins on each long side. The two rows are 3 pitches
  // apart so that it straddles the centre gap like a chip: set one row closer
  // and every pin would share a strip with the pin across from it.
  inmp441: {
    id: 'inmp441',
    label: 'INMP441 mic',
    size: { w: 14, d: 14, h: 3 },
    pins: [
      { name: 'L/R', x: 0, y: 0 }, { name: 'WS', x: 1, y: 0 }, { name: 'SCK', x: 2, y: 0 },
      { name: 'SD', x: 0, y: 3 }, { name: 'VDD', x: 1, y: 3 }, { name: 'GND', x: 2, y: 3 },
    ],
    internal: [],
    onBoard: true,
  },
  max98357a: {
    id: 'max98357a',
    label: 'MAX98357A amp',
    size: { w: 19, d: 24, h: 8 },
    pins: [
      { name: 'LRC', x: 0, y: 0 }, { name: 'BCLK', x: 1, y: 0 }, { name: 'DIN', x: 2, y: 0 },
      { name: 'GAIN', x: 3, y: 0 }, { name: 'SD', x: 4, y: 0 }, { name: 'GND', x: 5, y: 0 },
      { name: 'Vin', x: 6, y: 0 },
      // The screw terminal is on the far side of the board, for the speaker.
      { name: '+', x: 2, y: 6, wireOnly: true }, { name: '-', x: 4, y: 6, wireOnly: true },
    ],
    internal: [],
    onBoard: true,
  },
  speaker: {
    id: 'speaker',
    label: 'Speaker',
    size: { w: 40, d: 40, h: 15 },
    pins: [{ name: '+', x: 0, y: 0, wireOnly: true }, { name: '-', x: 2, y: 0, wireOnly: true }],
    internal: [],
    onBoard: false,
  },
};

export const BREADBOARD = /** @type {const} */ ({ cols: 63, rows: 'abcdefghij', rails: ['tp', 'tn', 'bp', 'bn'] });

/** Rail holes per rail. */
const RAIL_HOLES = 50;

// Row positions, top to bottom: two rails, the a–e half, the centre gap (e to
// f is 3 pitches, 7.62 mm, the width a DIP straddles), the f–j half, two rails.
const RAIL_Y = { tp: 0, tn: 1, bp: 16, bn: 17 };
const ROW_Y = { a: 3, b: 4, c: 5, d: 6, e: 7, f: 10, g: 11, h: 12, i: 13, j: 14 };

/** A rail runs in groups of five holes with a one-pitch gap between them, starting two in. */
const railX = (/** @type {number} */ n) => 2 + (n - 1) + Math.floor((n - 1) / 5);

/** @type {Map<string, { x: number, y: number }>} */
const XY = new Map();
/** @type {Map<string, string>} */
const AT = new Map();
for (const [row, y] of Object.entries(ROW_Y)) {
  for (let c = 1; c <= BREADBOARD.cols; c++) XY.set(`${row}${c}`, { x: c - 1, y });
}
for (const [rail, y] of Object.entries(RAIL_Y)) {
  for (let n = 1; n <= RAIL_HOLES; n++) XY.set(`${rail}${n}`, { x: railX(n), y });
}
for (const [id, { x, y }] of XY) AT.set(`${x},${y}`, id);

/** The board's outline in local pitch coordinates (holes run 0–62 by 0–17). */
export const BOARD_OUTLINE = { x0: -1.6, x1: 63.6, y0: -1.8, y1: 18.8 };

/**
 * How far apart two boards' origins are when they are joined: long edges side
 * by side, or end to end. Both are whole pitches, so both boards' holes are on
 * one grid — and `long` is 21 so that a DevKitC's two rows (10 pitches apart)
 * land a row on each board.
 */
export const JOIN = { long: 21, short: 66 };

/**
 * Which strip a hole is on, in the board's own names; holes on one strip are
 * joined.
 * @param {string} holeId 'a12' → 'col12-top', 'g12' → 'col12-bottom', 'tp7' → 'tp'
 */
export function holeStrip(holeId) {
  const m = /^(?:([a-j])(\d+)|(tp|tn|bp|bn)\d+)$/.exec(holeId);
  if (!m || !XY.has(holeId)) throw new Error(`not a breadboard hole: ${holeId}`);
  if (m[3]) return m[3];
  return `col${m[2]}-${m[1] <= 'e' ? 'top' : 'bottom'}`;
}

/** @type {Map<string, string[]>} */
const STRIPS = new Map();
for (const id of XY.keys()) {
  const s = holeStrip(id);
  STRIPS.set(s, [...(STRIPS.get(s) ?? []), id]);
}

/**
 * Every hole on a strip, in board order: where else a wire can go to reach a
 * pin seated on it.
 * @param {string} strip as holeStrip names it
 * @returns {string[]} local hole names
 */
export function stripHoles(strip) {
  return [...(STRIPS.get(strip) ?? [])];
}

/**
 * Where a hole is, in pitch units from the board's first column and top rail.
 * @param {string} holeId local hole name
 */
export function holeXY(holeId) {
  const xy = XY.get(holeId);
  if (!xy) throw new Error(`not a breadboard hole: ${holeId}`);
  return { ...xy };
}

/**
 * The hole at a point, or null off the board or between holes. The point is
 * rounded to the nearest pitch, so a part dragged a little off still lands.
 * @param {number} x
 * @param {number} y
 * @returns {string | null} local hole name
 */
export function holeAt(x, y) {
  return AT.get(`${Math.round(x)},${Math.round(y)}`) ?? null;
}

/**
 * @typedef {0 | 90 | 180 | 270} Rot
 * @typedef {{ id: string, x: number, z: number, rot: Rot }} Board
 *   x, z: integers, where the board's local (0, 0) sits on the table.
 */

/**
 * A point on a board to a point on the table: turn it clockwise (seen from
 * above), then shift it to where the board stands.
 * @param {Board} bd
 * @param {number} x local
 * @param {number} y local
 */
export function boardToTable(bd, x, y) {
  let lx = x;
  let ly = y;
  // Quarter turns clockwise on a y-down plane: (x, y) → (-y, x).
  for (let i = 0; i < bd.rot / 90; i++) [lx, ly] = [-ly, lx];
  return { x: bd.x + lx, z: bd.z + ly };
}

/**
 * The inverse of boardToTable: which point of which board a table point is.
 * @param {Board} bd
 * @param {number} x table
 * @param {number} z table
 */
export function tableToBoard(bd, x, z) {
  let lx = x - bd.x;
  let ly = z - bd.z;
  // The inverse of a clockwise quarter turn is a counter-clockwise one: (x, y) → (y, -x).
  for (let i = 0; i < bd.rot / 90; i++) [lx, ly] = [ly, -lx];
  return { x: lx, y: ly };
}

/**
 * The hole under a table point, on whichever board has one there, as a point
 * id ("bb2:a6"); null between holes, off every board, or in the seam.
 * @param {Board[]} boards
 * @param {number} x
 * @param {number} z
 * @returns {string | null}
 */
export function holeOnTable(boards, x, z) {
  for (const bd of boards) {
    const local = tableToBoard(bd, x, z);
    const hole = holeAt(local.x, local.y);
    if (hole) return `${bd.id}:${hole}`;
  }
  return null;
}

/**
 * Boards joined edge to edge, as groups of ids; every board is in exactly one
 * group. Two boards are joined when they have the same rotation and one's
 * origin sits at a join offset in the other's local frame.
 * @param {Board[]} boards
 * @returns {string[][]}
 */
export function boardGroups(boards) {
  /** @type {Map<string, string>} */
  const parent = new Map();
  /** @param {string} id */
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== root) root = /** @type {string} */ (parent.get(root));
    for (let q = id; q !== root; ) {
      const next = /** @type {string} */ (parent.get(q));
      parent.set(q, root);
      q = next;
    }
    return root;
  };
  /** @param {string} a @param {string} b */
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  for (const bd of boards) parent.set(bd.id, bd.id);

  /** @param {Board} a @param {Board} b */
  const joined = (a, b) => {
    if (a.rot !== b.rot) return false;
    const { x, y } = tableToBoard(a, b.x, b.z);
    return (x === 0 && Math.abs(y) === JOIN.long) || (y === 0 && Math.abs(x) === JOIN.short);
  };
  for (let i = 0; i < boards.length; i++) {
    for (let j = i + 1; j < boards.length; j++) {
      if (joined(boards[i], boards[j])) union(boards[i].id, boards[j].id);
    }
  }

  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const bd of boards) {
    const root = find(bd.id);
    groups.set(root, [...(groups.get(root) ?? []), bd.id]);
  }
  return [...groups.values()];
}
