import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench, addPart, addWire } from '../../sim/bench.js';
import { motorLevels, toyWiring, toyAction } from '../../sim/car.js';

/**
 * A bench with a toy at (-80, 30) and the pads in `pads` wired; undefined = leave unwired.
 * @param {Record<string, string | null | undefined>} pads
 * @param {string | null} [ground]
 */
function bench(pads, ground = 'esp:GND') {
  let b = addPart(emptyBench(), 'toy', { x: -80, z: 30 }).bench;
  for (const [pin, to] of Object.entries(pads)) if (to) b = addWire(b, `toy:${pin}`, to, 'red');
  if (ground) b = addWire(b, 'toy:GND', ground, 'black');
  return b;
}

const WIRED = { U3A: 'esp:GPIO4', U3B: 'esp:GPIO5', U5A: 'esp:GPIO6', U5B: 'esp:GPIO7' };
const wiring = (/** @type {Record<string, string | null>} */ pads, /** @type {string | null} */ ground) =>
  toyWiring(bench(pads, ground), 'toy');

test('the correct wiring reads each pad off its own GPIO, on the shared ground', () => {
  const w = wiring(WIRED, 'esp:GND');
  assert.equal(w.linked, true);
  assert.equal(w.ground, 'ok');
  assert.deepEqual(w.inputs.U3A, { kind: 'gpio', pins: ['esp:GPIO4'] });
  assert.deepEqual(w.inputs.U5B, { kind: 'gpio', pins: ['esp:GPIO7'] });
});

test('a toy with nothing wired is not part of the circuit', () => {
  const w = wiring({}, null);
  assert.equal(w.linked, false);
  assert.equal(w.ground, 'floating');
});

test('one wire leaving the toy makes it part of the circuit', () => {
  assert.equal(wiring({ U3A: 'esp:GPIO4' }, null).linked, true);
});

test('a pad on a rail is a constant, and two GPIOs on one net are both listed', () => {
  assert.deepEqual(wiring({ U3A: 'esp:3V3' }, 'esp:GND').inputs.U3A, { kind: 'rail', level: 'high' });
  assert.deepEqual(wiring({ U3A: 'esp:GND' }, 'esp:GND').inputs.U3A, { kind: 'rail', level: 'low' });
  // A jumper between two GPIOs puts both on U3A's net.
  let b = bench({ U3A: 'esp:GPIO4' }, 'esp:GND');
  b = addWire(b, 'esp:GPIO4', 'esp:GPIO5', 'blue');
  assert.deepEqual(toyWiring(b, 'toy').inputs.U3A, { kind: 'gpio', pins: ['esp:GPIO4', 'esp:GPIO5'] });
});

test('ground floating or raised is told apart', () => {
  assert.equal(wiring(WIRED, null).ground, 'floating');
  assert.equal(wiring(WIRED, 'esp:3V3').ground, 'raised');
});

test('levels to motion: forward left, backward straight, stop', () => {
  const w = wiring(WIRED, 'esp:GND');
  assert.deepEqual(toyAction(w, motorLevels('forward', 'left')), { wheels: 'forward', steer: 'left', contended: [] });
  assert.deepEqual(toyAction(w, motorLevels('backward', 'straight')), { wheels: 'backward', steer: 'centred', contended: [] });
  assert.deepEqual(toyAction(w, motorLevels('forward', 'straight')), { wheels: 'forward', steer: 'centred', contended: [] });
});

test('both bits of one pair high is a short, not a direction', () => {
  const both = toyAction(wiring({ ...WIRED, U3A: 'esp:3V3', U3B: 'esp:3V3' }, 'esp:GND'), motorLevels('forward', 'left'));
  assert.equal(both.wheels, 'short');
  assert.equal(both.steer, 'left');
});

test('a pad with no GPIO on it reads low', () => {
  // U3B is unwired, so backward has nothing to pull it high.
  const w = wiring({ U3A: 'esp:GPIO4', U5A: 'esp:GPIO6', U5B: 'esp:GPIO7' }, 'esp:GND');
  assert.equal(toyAction(w, motorLevels('backward', 'straight')).wheels, 'coast');
  assert.equal(toyAction(w, motorLevels('forward', 'straight')).wheels, 'forward');
});

test('disagreeing GPIOs on one pad read low and say so', () => {
  let b = bench({ U3A: 'esp:GPIO4' }, 'esp:GND');
  b = addWire(b, 'esp:GPIO4', 'esp:GPIO5', 'blue');
  const a = toyAction(toyWiring(b, 'toy'), motorLevels('backward', 'straight'));
  assert.equal(a.wheels, 'coast');
  assert.deepEqual(a.contended, ['U3A']);
});

test('a raised ground or a floating one leaves the toy dead', () => {
  assert.deepEqual(toyAction(wiring(WIRED, 'esp:3V3'), motorLevels('forward', 'left')),
    { wheels: 'dead', steer: 'dead', contended: [] });
  assert.deepEqual(toyAction(wiring({}, null), motorLevels('forward', 'left')),
    { wheels: 'dead', steer: 'dead', contended: [] });
});
