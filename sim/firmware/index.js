// Every firmware a board can run. The registry is the only place that knows
// which firmware exists; projects and the board panel refer to ids.
import { BODY } from './body.js';
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
export const FIRMWARES = { body: BODY, ...Object.fromEntries(SKETCHES.map((s) => [s.id, s])) };

/** @param {string} id @returns {Firmware | undefined} */
export function firmwareById(id) {
  return Object.hasOwn(FIRMWARES, id) ? FIRMWARES[id] : undefined;
}
