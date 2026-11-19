// What to buy for the bench as it stands. Pure: it reads the bench and the
// purchase data, and never touches the DOM or the network. The list is built
// from what is actually placed — not from a recipe — so a bench the user wired
// themselves gets the same treatment.
import { NO_PURCHASE, purchaseFor } from './devices/purchase.js';
import { screenById } from '../core/screens.js';
import { SCREEN_CONTROLLERS } from './firmware/body-boot.js';

/**
 * @typedef {import('./devices/purchase.js').Purchase} Purchase
 * @typedef {{ key: string, quantity: number, purchase: Purchase, warning?: 'screen-unsupported-controller' | 'screen-unverified' }} Line
 */

// The order a build goes together in: the controller, then what hangs off it,
// then the wire, then the boards. Anything not named here sorts by id after
// these and before the breadboard.
const FIRST = ['esp32', 'inmp441', 'max98357a', 'speaker'];
const LAST = ['breadboard', 'jumper-wires', 'usb-cable'];

/** @param {string} id */
const isScreen = (id) => id.startsWith('screen-');

/** @param {string} id */
function rank(id) {
  const first = FIRST.indexOf(id);
  if (first !== -1) return first;
  if (isScreen(id)) return FIRST.length;
  const last = LAST.indexOf(id);
  if (last !== -1) return 1000 + last;
  return 100;
}

/**
 * @param {import('./bench.js').Bench} bench
 * @returns {{ lines: Line[], warnings: string[] }}
 */
export function shoppingList(bench) {
  /** @type {Map<string, { part: string, quantity: number }>} */
  const counts = new Map();
  for (const placed of bench.placed) {
    if (NO_PURCHASE.has(placed.part)) continue;
    // A resistor's value is the thing you buy: two 220s are one line, a 1k is another.
    const key = placed.part === 'resistor' ? `resistor|${String(placed.properties.ohms)}` : placed.part;
    const seen = counts.get(key);
    if (seen) seen.quantity += 1;
    else counts.set(key, { part: placed.part, quantity: 1 });
  }
  /** @type {Line[]} */
  const lines = [];
  for (const [key, entry] of counts) {
    if (isScreen(entry.part)) {
      const screen = screenById(entry.part.slice('screen-'.length));
      // Silently dropping a screen would leave a build that cannot light up.
      if (!screen?.buy) throw new Error(`screen ${entry.part} has no buy entry`);
      /** @type {Line['warning']} */
      const warning = !SCREEN_CONTROLLERS.has(screen.controller) ? 'screen-unsupported-controller'
        : screen.verified ? undefined : 'screen-unverified';
      lines.push({ key, quantity: entry.quantity, purchase: screen.buy, ...(warning ? { warning } : {}) });
      continue;
    }
    const purchase = purchaseFor(entry.part);
    if (!purchase) continue;
    lines.push({ key, quantity: entry.quantity, purchase });
  }
  // The board a part sits on is part of the build, and so is the wire.
  if (lines.length) {
    if (bench.boards.length) {
      const breadboard = purchaseFor('breadboard');
      if (breadboard) lines.push({ key: 'breadboard', quantity: bench.boards.length, purchase: breadboard });
    }
    const jumperWires = purchaseFor('jumper-wires');
    if (jumperWires) lines.push({ key: 'jumper-wires', quantity: 1, purchase: jumperWires });
    if (counts.has('esp32')) {
      const usbCable = purchaseFor('usb-cable');
      if (usbCable) lines.push({ key: 'usb-cable', quantity: 1, purchase: usbCable });
    }
  }
  lines.sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
  /** @type {string[]} */
  const warnings = [];
  for (const line of lines) if (line.warning && !warnings.includes(line.warning)) warnings.push(line.warning);
  return { lines, warnings };
}

/**
 * The printed total. Prices are ranges, so both ends are summed and the sheet
 * says so; a single number here would look more certain than the data is.
 * @param {Line[]} lines
 * @returns {{ low: number, high: number }}
 */
export function totalUsd(lines) {
  let low = 0;
  let high = 0;
  for (const line of lines) {
    low += line.purchase.priceUsd[0] * line.quantity;
    high += line.purchase.priceUsd[1] * line.quantity;
  }
  return { low: Math.round(low * 100) / 100, high: Math.round(high * 100) / 100 };
}
