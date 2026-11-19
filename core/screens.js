// The screens the pet can live on, as data (multi-screen spec §3). One table,
// read by the simulator, the render script and the firmware's host test, so a
// new panel is a row here and nothing else. Which values a panel needs is the
// plan's judgement; only `verified: true` means someone saw it on real glass.

import table from './screens.json' with { type: 'json' };

/**
 * @typedef {'VCC'|'GND'|'CS'|'RST'|'DC'|'MOSI'|'SCK'|'BL'|'MISO'|'SD_CS'|'NC'} PinRole
 * @typedef {{ silk: string, role: PinRole }} ScreenPin
 * @typedef {{
 *   keywords: { en: string, zh: string }, mustMatch: { en: string, zh: string }[],
 *   priceUsd: [number, number], alternatives: { en: string, zh: string }[],
 * }} ScreenBuy
 * @typedef {{
 *   id: string, label: string,
 *   controller: 'ili9341' | 'st7789' | 'st7735' | 'gc9a01',
 *   w: number, h: number,                // landscape, as shown
 *   invert: boolean, bgr: boolean,
 *   swapXY: boolean, mirrorX: boolean, mirrorY: boolean,
 *   gapX: number, gapY: number,          // panel RAM offset
 *   spiMode: 0 | 3, pclkHz: number,
 *   vcc: '5v' | '3v3',                   // '5v': has its own regulator, 5V is fine; '3v3': 5V burns it
 *   round: boolean, verified: boolean,
 *   blDefault: 'on' | 'off',             // is the backlight on when its pin is left floating?
 *   pcb: { w: number, d: number },       // the board, mm
 *   glass: { w: number, d: number },     // the lit area, mm (a disc when round)
 *   pins: ScreenPin[],                   // header order, as printed on the module
 *   buy?: ScreenBuy,                     // what to ask for when buying one
 *   verifiedNote?: string,               // docs/hardware/ record, required once verified
 * }} Screen
 */

/** @type {Screen[]} */
export const SCREENS = /** @type {any} */ (table).screens;

/**
 * The controllers the body firmware actually drives. It is a set because the
 * firmware's boot only checks an identity response for these two, and the
 * shopping list and the admin picker must not offer a panel that stays dark.
 */
export const FIRMWARE_CONTROLLERS = new Set(['ili9341', 'st7789']);

/** @param {string} id @returns {Screen | undefined} */
export function screenById(id) {
  return SCREENS.find((s) => s.id === id);
}

/** The directory name a size's frames live in, and what a hello reports. */
/** @param {{ w: number, h: number }} s @returns {string} */
export function sizeKey(s) {
  return `${s.w}x${s.h}`;
}

/** A hello that says nothing about its screen is the author's 320×240 panel. */
export const DEFAULT_SIZE = '320x240';

/**
 * One entry per resolution, in table order, so `npm run pet:render` and the
 * loader agree on what exists. A size is drawn for the roundest panel that has
 * it: a square panel is happy with the circle's smaller dog, the circle is not
 * happy with the square's corners.
 * @returns {{ w: number, h: number, round: boolean }[]}
 */
export function frameSizes() {
  /** @type {Map<string, { w: number, h: number, round: boolean }>} */ const byKey = new Map();
  for (const s of SCREENS) {
    const key = sizeKey(s);
    const seen = byKey.get(key);
    if (seen) seen.round ||= s.round;
    else byKey.set(key, { w: s.w, h: s.h, round: s.round });
  }
  return [...byKey.values()];
}

/**
 * A screen may claim `verified: true` only while the repo holds the record of
 * the glass it was lit on. The rule lives here, next to the data, so the
 * simulator, the admin page and the tests all ask the same question.
 * @param {{ id: string, verified: boolean, verifiedNote?: string }} screen
 * @param {(path: string) => boolean} exists
 * @returns {string | null}  why it is not acceptable, or null
 */
export function verifiedProblem(screen, exists) {
  if (!screen.verified) return null;
  if (!screen.verifiedNote) return `verified screen ${screen.id} has no verifiedNote`;
  if (!screen.verifiedNote.startsWith('docs/hardware/')) return `${screen.id}: verifiedNote must live in docs/hardware/`;
  if (!exists(screen.verifiedNote)) return `${screen.id}: missing ${screen.verifiedNote}`;
  return null;
}
