// SSD1306 0.96-inch 128x64 I2C display: a bounded monochrome frame model and
// session-only draw actions. Bus connectivity comes from the shared I2C check.
import { evaluateI2c } from '../electrical/i2c.js';
import { nets } from '../netlist.js';
import { DEVICES } from './catalog.js';

export const SSD1306_WIDTH = 128;
export const SSD1306_HEIGHT = 64;

/** A blank 1-bit frame, 128 bytes per row of 8 pixels. */
export function emptyFrame() {
  return new Uint8Array(SSD1306_WIDTH * SSD1306_HEIGHT / 8);
}

/** @param {Uint8Array} frame @param {number} x @param {number} y @param {boolean} [on] */
export function setPixel(frame, x, y, on = true) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= SSD1306_WIDTH || y >= SSD1306_HEIGHT) return frame;
  const index = y * 16 + (x >> 3), bit = 1 << (x & 7);
  frame[index] = on ? frame[index] | bit : frame[index] & ~bit;
  return frame;
}

/** @param {Uint8Array} frame @param {number} x @param {number} y */
export function pixel(frame, x, y) {
  if (x < 0 || y < 0 || x >= SSD1306_WIDTH || y >= SSD1306_HEIGHT) return false;
  return Boolean(frame[y * 16 + (x >> 3)] & (1 << (x & 7)));
}

// A 3x5 uppercase font: enough for readings without shipping a full typeface.
/** @type {Record<string, string[]>} */
const FONT = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111'],
  '.': ['000', '000', '000', '000', '010'], '%': ['101', '001', '010', '100', '101'],
  'T': ['111', '010', '010', '010', '010'], 'H': ['101', '101', '111', '101', '101'],
  'P': ['111', '101', '111', '100', '100'], 'C': ['111', '100', '100', '100', '111'],
  'A': ['111', '101', '111', '101', '101'], 'M': ['101', '111', '111', '101', '101'],
  ' ': ['000', '000', '000', '000', '000'],
};

/** Draw one deterministic text line into a frame. Unknown glyphs are blank.
 * @param {string[]} lines @returns {{lines:string[],frame:Uint8Array}} */
export function textFrame(lines) {
  const frame = emptyFrame();
  const rows = lines.map(line => String(line).toUpperCase()).slice(0, 8);
  rows.forEach((line, row) => {
    let x = 0;
    for (const char of line) {
      const glyph = FONT[char] ?? FONT[' '];
      glyph.forEach((bits, gy) => bits.split('').forEach((bit, gx) => { if (bit === '1') setPixel(frame, x + gx, row * 8 + gy); }));
      x += 4;
      if (x >= SSD1306_WIDTH) break;
    }
  });
  return { lines: rows, frame };
}

/** Format the three BME280 readings into a bounded display view model. @param {any} readings */
export function formatReadings(readings) {
  const temperature = Number(readings?.temperatureC), humidity = Number(readings?.humidityPct), pressure = Number(readings?.pressureHpa);
  const safe = (/** @type {number} */ value, /** @type {number} */ fallback) => Number.isFinite(value) ? value : fallback;
  return textFrame([
    `T ${safe(temperature, 0).toFixed(1)} C`,
    `H ${safe(humidity, 0).toFixed(0)} %`,
    `P ${safe(pressure, 0).toFixed(0)} HPA`,
  ]);
}

/** @param {unknown} value @returns {number|null} */
export function displayAddress(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value);
  if (!/^(?:0x[\da-f]+|\d+)$/i.test(text)) return null;
  const address = Number(text);
  return address === 0x3c || address === 0x3d ? address : null;
}

/** Map the shared I2C status onto the display's four-state view. @param {string} state */
export function displayState(state) {
  if (state === 'ready' || state === 'address-conflict' || state === 'off') return state;
  return 'bus-fault';
}

/**
 * Evaluate every SSD1306 on the bench.
 * @param {import('../bench.js').Bench} bench
 * @param {import('../devices/profiles.js').Profile} profile
 * @param {{ controllerPowered?: boolean, electrical?: any }} electrical
 * @param {any} [stimuli]
 * @param {Record<string, any>} [devices]
 */
export function evaluateSsd1306(bench, profile, { controllerPowered = false, electrical = null } = {}, stimuli = {}, devices = DEVICES) {
  const instances = bench.placed.filter(part => !part.burnt && part.part === 'ssd1306').map(part => ({
    id: part.id, sda: 'SDA', scl: 'SCL', address: displayAddress(part.properties.address) ?? -1,
  }));
  /** @type {Record<string, {state:string,address:number|null,lines:string[],frame:Uint8Array}>} */ const parts = {};
  if (!instances.length) return { parts, faults: [] };
  const network = nets(bench);
  const board = bench.placed.find(part => part.part === 'esp32' && !part.burnt);
  /** @type {Record<string, {status:string}>} */
  const supply = {};
  for (const instance of instances) {
    const vcc = `${instance.id}:VCC`, gnd = `${instance.id}:GND`;
    let status = 'unpowered';
    if (board && (network.same(vcc, gnd) || network.same(vcc, `${board.id}:GND`))) status = 'reversed';
    else if (board && network.same(vcc, `${board.id}:5V`)) status = 'overvoltage';
    else if (board && network.same(vcc, `${board.id}:3V3`) && network.same(gnd, `${board.id}:GND`)) status = 'ok';
    supply[instance.id] = { status };
  }
  const i2c = evaluateI2c(bench, profile, /** @type {any} */ (instances), { controllerPowered, devices: supply });
  for (const instance of instances) {
    const state = displayState(i2c.states[instance.id] ?? 'off');
    const command = stimuli?.displays?.[instance.id];
    const drawn = state === 'ready' && command
      ? (Array.isArray(command.lines) ? textFrame(command.lines.map(String)) : command.frame instanceof Uint8Array && command.frame.length === emptyFrame().length ? { lines: command.lines ?? [], frame: command.frame } : textFrame([]))
      : textFrame([]);
    parts[instance.id] = {
      state,
      address: instance.address === -1 ? null : instance.address,
      lines: drawn.lines,
      frame: drawn.frame,
    };
  }
  return { parts, faults: i2c.faults };
}
