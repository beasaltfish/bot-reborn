// What the simulator knows about its parts and its breadboard, as plain data:
// no three.js, no DOM, so the netlist, the power-on rules and the tests can all
// read it. The 3D scene turns the same numbers into meshes.
//
// Lengths are in breadboard pitch units (one unit = 2.54 mm) unless a field
// says mm. Point ids everywhere are "<instanceId>:<pinName>" ("mic:VDD",
// "esp:GPIO12") or "bb:<hole>" for a breadboard hole.

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
  for (let c = 1; c <= BREADBOARD.cols; c++) XY.set(`bb:${row}${c}`, { x: c - 1, y });
}
for (const [rail, y] of Object.entries(RAIL_Y)) {
  for (let n = 1; n <= RAIL_HOLES; n++) XY.set(`bb:${rail}${n}`, { x: railX(n), y });
}
for (const [id, { x, y }] of XY) AT.set(`${x},${y}`, id);

/**
 * Which strip a hole is on; holes on one strip are joined.
 * @param {string} holeId 'bb:a12' → 'col12-top', 'bb:g12' → 'col12-bottom', 'bb:tp7' → 'tp'
 */
export function holeStrip(holeId) {
  const m = /^bb:(?:([a-j])(\d+)|(tp|tn|bp|bn)\d+)$/.exec(holeId);
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
 * @returns {string[]}
 */
export function stripHoles(strip) {
  return [...(STRIPS.get(strip) ?? [])];
}

/**
 * Where a hole is, in pitch units from the board's first column and top rail.
 * @param {string} holeId
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
 * @returns {string | null}
 */
export function holeAt(x, y) {
  return AT.get(`${Math.round(x)},${Math.round(y)}`) ?? null;
}
