// Which colour a wire gets, from what its ends carry. Pure, so the scene's
// hand-drawn wires and the recipes' wires are coloured by one rule.

/** @typedef {import('./bench.js').Bench} Bench */

/** Manual jumper colours; auto uses the existing role-based recommendation. */
export const WIRE_PALETTE = [
  { id: 'auto', color: null, labelKey: 'wire.auto' },
  { id: 'red', color: '#d23a2e', labelKey: 'wire.red' },
  { id: 'black', color: '#1d1d1f', labelKey: 'wire.black' },
  { id: 'yellow', color: '#f2c230', labelKey: 'wire.yellow' },
  { id: 'green', color: '#2e9e57', labelKey: 'wire.green' },
  { id: 'blue', color: '#2f6fd0', labelKey: 'wire.blue' },
  { id: 'orange', color: '#e9782b', labelKey: 'wire.orange' },
  { id: 'white', color: '#f2f0ea', labelKey: 'wire.white' },
  { id: 'purple', color: '#8b54c9', labelKey: 'wire.purple' },
];

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
export function recommendedWireColor(b, a, z) {
  const roles = [role(a), role(z)];
  if (roles.includes('power')) return RED;
  if (roles.includes('ground')) return BLACK;
  const signals = b.wires.filter((w) => w.color !== RED && w.color !== BLACK).length;
  return PALETTE[signals % PALETTE.length];
}

// Existing recipe and interaction callers keep their public API.
export { recommendedWireColor as wireColor };
