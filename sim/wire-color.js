// Which colour a wire gets, from what its ends carry. Pure, so the scene's
// hand-drawn wires and the recipes' wires are coloured by one rule.

/** @typedef {import('./bench.js').Bench} Bench */

/** Wires that are not power or ground take these in turn, like a bundle of jumpers. */
const PALETTE = ['#f2c230', '#2e9e57', '#2f6fd0', '#e9782b', '#8b54c9', '#f2f0ea'];
const RED = '#d23a2e';
const BLACK = '#1d1d1f';

/**
 * What a point carries, by its name: the 3V3/5V pins and the + rails are
 * power, GND and the − rails are ground.
 * @param {string} point
 * @returns {'power' | 'ground' | null}
 */
export function role(point) {
  const rail = /^[^:]+:(tp|tn|bp|bn)\d+$/.exec(point);
  if (rail) return rail[1].endsWith('p') ? 'power' : 'ground';
  const pin = point.slice(point.indexOf(':') + 1).replace(/\.\d+$/, '');
  if (pin === '3V3' || pin === '5V' || pin === 'VDD' || pin === 'Vin') return 'power';
  if (pin === 'GND') return 'ground';
  return null;
}

/**
 * The colour a new wire gets: red to power, black to ground, as on the real
 * bench, otherwise the next in the bundle.
 * @param {Bench} b
 * @param {string} a
 * @param {string} z
 */
export function wireColor(b, a, z) {
  const roles = [role(a), role(z)];
  if (roles.includes('power')) return RED;
  if (roles.includes('ground')) return BLACK;
  const signals = b.wires.filter((w) => w.color !== RED && w.color !== BLACK).length;
  return PALETTE[signals % PALETTE.length];
}
