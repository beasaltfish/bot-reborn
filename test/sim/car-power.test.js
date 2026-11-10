import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench, addPart, addWire } from '../../sim/bench.js';
import { powerOn } from '../../sim/power.js';

const WIRED = { U3A: 'esp:GPIO4', U3B: 'esp:GPIO5', U5A: 'esp:GPIO6', U5B: 'esp:GPIO7' };

/**
 * A powered bench with a toy whose pads are in `pads` (undefined = unwired).
 * @param {Record<string, string | null | undefined>} pads
 * @param {string | null} [ground]
 * @param {[string, string][]} [extra] more wires, pairs of points
 */
function powered(pads, ground = 'esp:GND', extra = []) {
  let b = { ...addPart(emptyBench(), 'toy', { x: -100, z: 25 }).bench, usb: true };
  for (const [pin, to] of Object.entries(pads)) if (to) b = addWire(b, `toy:${pin}`, to, 'red');
  if (ground) b = addWire(b, 'toy:GND', ground, 'black');
  for (const [a, z] of extra) b = addWire(b, a, z, 'blue');
  return b;
}
/** @param {import('../../sim/bench.js').Bench} b */
const codes = (b) => powerOn(b).faults.map((f) => f.code);
/** @param {import('../../sim/bench.js').Bench} b */
const wheels = (b) => /** @type {any} */ (powerOn(b).parts.toy).wheels;

test('the correct wiring is quiet and coasting', () => {
  const out = powerOn(powered(WIRED));
  assert.ok(!out.faults.some((f) => f.code.startsWith('toy-')), JSON.stringify(out.faults));
  assert.deepEqual(out.burns, []);
  assert.deepEqual(out.parts.toy, { kind: 'toy', wheels: 'coast', steer: 'centred' });
  assert.equal(out.toys.toy.wiring.ground, 'ok');
});

test('a toy with no wires at all is not judged', () => {
  const out = powerOn(powered({}, null));
  // The bench's own audio parts are bare here too; only the toy's faults matter.
  assert.deepEqual(out.faults.filter((f) => f.code.startsWith('toy-')), []);
  assert.deepEqual(out.burns, []);
  assert.deepEqual(out.parts.toy, { kind: 'toy', wheels: 'dead', steer: 'dead' });
});

test('a toy with one wire on it is judged in full', () => {
  assert.ok(codes(powered({ U3A: 'esp:GPIO4' }, null)).includes('toy-ungrounded'));
  assert.ok(codes(powered({ U3A: 'esp:GPIO4' }, null)).includes('toy-drive-missing'));
});

test('a missing drive or steer line is named', () => {
  const c = codes(powered({ U3A: 'esp:GPIO4', U5A: 'esp:GPIO6', U5B: 'esp:GPIO7' }));
  assert.ok(c.includes('toy-drive-missing'));
  assert.ok(!c.includes('toy-steer-missing'));
  assert.ok(codes(powered({ ...WIRED, U5B: undefined })).includes('toy-steer-missing'));
});

test('swapped pairs are named and still drive', () => {
  const c = codes(powered({ U3A: 'esp:GPIO5', U3B: 'esp:GPIO4' }));
  assert.ok(c.includes('toy-drive-swapped'));
  assert.ok(codes(powered({ U5A: 'esp:GPIO7', U5B: 'esp:GPIO6' })).includes('toy-steer-swapped'));
  assert.equal(wheels(powered({ U3A: 'esp:GPIO5', U3B: 'esp:GPIO4' })), 'coast');
});

test('an input held at the rail is said plainly, and the toy drives at rest', () => {
  const b = powered({ ...WIRED, U3A: 'esp:3V3' });
  assert.ok(codes(b).includes('toy-input-held'));
  // U3A high, U3B low, with the firmware's pins all low at boot.
  assert.equal(wheels(b), 'forward');
});

test('two inputs of one pair on one GPIO is a short waiting to happen', () => {
  const b = powered({ ...WIRED, U3B: 'esp:GPIO4' });
  assert.ok(codes(b).includes('toy-pair-tied'));
  // Both are low at boot, so nothing burns yet: the first forward move does.
  assert.deepEqual(powerOn(b).burns, []);
});

test('two inputs held high burn the toy at boot', () => {
  const b = powered({ ...WIRED, U3A: 'esp:3V3', U3B: 'esp:3V3' });
  assert.deepEqual(powerOn(b).burns, ['toy']);
  assert.ok(codes(b).includes('toy-short'));
  assert.deepEqual(powerOn(b).parts.toy, { kind: 'toy', wheels: 'dead', steer: 'dead' });
});

test('no ground, or the wrong ground', () => {
  assert.ok(codes(powered(WIRED, null)).includes('toy-ungrounded'));
  assert.ok(codes(powered(WIRED, 'esp:3V3')).includes('toy-ground-raised'));
  assert.equal(wheels(powered(WIRED, 'esp:3V3')), 'dead');
});

test('a burnt toy stays dead whatever it is wired to', () => {
  const b = powered(WIRED);
  const burnt = { ...b, placed: b.placed.map((p) => (p.part === 'toy' ? { ...p, burnt: true } : p)) };
  assert.ok(codes(burnt).includes('toy-burnt'));
  assert.deepEqual(powerOn(burnt).parts.toy, { kind: 'toy', wheels: 'dead', steer: 'dead' });
});
