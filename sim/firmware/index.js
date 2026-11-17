// Every firmware a board can run. The registry is the only place that knows
// which firmware exists; projects and the board panel refer to ids.
import { BODY } from './body.js';
import { CUSTOM } from './custom.js';
import { SKETCHES } from './sketches.js';

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   provenance:
 *     | { kind: 'mirrored', source: string, spec: string }
 *     | { kind: 'illustrative', note: string },
 *   drivers: string[],
 *   link: { body: string, screen: string } | null,
 *   usesSettings: boolean,
 *   image: { label: string, kind: 'release' | 'illustrative', manifest?: string, files?: { offset: number, name: string }[] },
 *   boot?(ctx: any): any[],
 *   tick?(ctx: any): void,
 * }} Firmware
 */

/** @type {Record<string, Firmware>} */
export const FIRMWARES = { body: BODY, custom: CUSTOM, ...Object.fromEntries(SKETCHES.map((s) => [s.id, s])) };

/** @param {string} id @returns {Firmware | undefined} */
export function firmwareById(id) {
  return Object.hasOwn(FIRMWARES, id) ? FIRMWARES[id] : undefined;
}

/**
 * The firmware a board currently has. A pure lookup: custom metadata only;
 * the interpreter machine belongs to the board runtime.
 * @param {import('../bench.js').BoardState} board
 * @returns {Firmware | undefined}
 */
export function firmwareFor(board) {
  return board.firmware === 'custom' ? CUSTOM : firmwareById(board.firmware);
}
