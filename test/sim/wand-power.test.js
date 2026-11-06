import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyBench, addPart, addWire } from '../../sim/bench.js';
import { PARTS } from '../../sim/parts.js';
import { TARGET, targetFor } from '../../sim/target.js';
import { powerOn } from '../../sim/power.js';
import { diagnose, nextHint } from '../../sim/diagnose.js';

/** @typedef {import('../../sim/bench.js').Bench} Bench */

/** What the wand is wired to, as the firmware will read it (wand spec §5). */
const WAND = [['VCC', 'esp:3V3'], ['GND', 'esp:GND'], ['SDA', 'esp:GPIO1'], ['SCL', 'esp:GPIO2']];

/**
 * The opening bench, powered, with a wand `id` added and wired by `links`
 * (pin name → point). The mic, amp and speaker stay unwired unless `rest`.
 * @param {[string, string][]} links
 * @param {{ id?: string, bench?: Bench, rest?: boolean }} [opts]
 */
function withWand(links, { id = 'imu', bench, rest = false } = {}) {
  let b = bench ?? { ...emptyBench(), usb: true };
  if (!b.placed.some((p) => p.id === id)) b = addPart(b, 'mpu6050', { x: 0, z: 30 }).bench;
  if (rest) for (const l of TARGET) b = addWire(b, l.a, l.b, 'red');
  for (const [pin, to] of links) b = addWire(b, `${id}:${pin}`, to, 'red');
  return b;
}

/** @param {Bench} b */
const imuCodes = (b) => powerOn(b).faults.map((f) => f.code).filter((c) => c.startsWith('imu'));
/** @param {Bench} b @param {string} [id] */
const awake = (b, id = 'imu') => /** @type {any} */ (powerOn(b).parts[id]);

test('a wand wired to the target is awake, with nothing wrong with it', () => {
  const b = withWand(/** @type {[string, string][]} */ (WAND));
  assert.deepEqual(awake(b), { kind: 'imu', awake: true });
  assert.deepEqual(imuCodes(b), []);
});

test('without USB the wand is asleep', () => {
  const b = { ...withWand(/** @type {[string, string][]} */ (WAND)), usb: false };
  assert.deepEqual(awake(b), { kind: 'imu', awake: false });
});

test('VCC on 5V burns the wand', () => {
  const b = withWand([['VCC', 'esp:5V'], ['GND', 'esp:GND'], ['SDA', 'esp:GPIO1'], ['SCL', 'esp:GPIO2']]);
  const o = powerOn(b);
  assert.deepEqual(o.burns, ['imu']);
  assert.ok(imuCodes(b).includes('imu-5v'));
  assert.equal(awake(b).awake, false);
});

test('a burnt wand stays dead however it is wired', () => {
  let b = withWand(/** @type {[string, string][]} */ (WAND));
  b = { ...b, placed: b.placed.map((p) => (p.id === 'imu' ? { ...p, burnt: true } : p)) };
  assert.ok(imuCodes(b).includes('imu-burnt'));
  assert.equal(awake(b).awake, false);
  assert.deepEqual(powerOn(b).burns, []);
});

test('a wand with no VCC is unpowered', () => {
  const b = withWand([['GND', 'esp:GND'], ['SDA', 'esp:GPIO1'], ['SCL', 'esp:GPIO2']]);
  assert.deepEqual(imuCodes(b), ['imu-unpowered']);
  assert.equal(awake(b).awake, false);
});

test('SDA and SCL on each other\'s GPIO are swapped', () => {
  const b = withWand([['VCC', 'esp:3V3'], ['GND', 'esp:GND'], ['SDA', 'esp:GPIO2'], ['SCL', 'esp:GPIO1']]);
  assert.deepEqual(imuCodes(b), ['imu-bus-swapped']);
  assert.equal(awake(b).awake, false);
});

test('SDA on the wrong GPIO is a bus fault', () => {
  const b = withWand([['VCC', 'esp:3V3'], ['GND', 'esp:GND'], ['SDA', 'esp:GPIO8'], ['SCL', 'esp:GPIO2']]);
  assert.deepEqual(imuCodes(b), ['imu-bus']);
  assert.equal(awake(b).awake, false);
});

test('SDA joined to SCL, or SCL held on a rail, is a short', () => {
  const joined = withWand(/** @type {[string, string][]} */ (WAND));
  const a = addWire(joined, 'imu:SDA', 'imu:SCL', 'red');
  assert.ok(imuCodes(a).includes('imu-bus-short'));
  const rail = withWand([['VCC', 'esp:3V3'], ['GND', 'esp:GND'], ['SDA', 'esp:GPIO1'], ['SCL', 'esp:GND']]);
  assert.ok(imuCodes(rail).includes('imu-bus-short'));
  assert.equal(awake(a).awake, false);
  assert.equal(awake(rail).awake, false);
});

test('two wands are judged one at a time', () => {
  let b = withWand(/** @type {[string, string][]} */ (WAND));
  b = withWand([['VCC', 'esp:3V3'], ['GND', 'esp:GND'], ['SDA', 'esp:GPIO2'], ['SCL', 'esp:GPIO1']], { id: 'imu2', bench: b });
  assert.equal(awake(b, 'imu').awake, true);
  assert.equal(awake(b, 'imu2').awake, false);
  assert.deepEqual(imuCodes(b), ['imu-bus-swapped']);
});

test('the opening bench is judged as before, with no wand in it', () => {
  const o = powerOn({ ...emptyBench(), usb: true });
  assert.equal(Object.values(o.parts).some((p) => p.kind === 'imu'), false);
});

test('targetFor lists the wand\'s four links only when a wand is on the bench', () => {
  assert.equal(targetFor(emptyBench()).some((l) => l.a.startsWith('imu') || l.b.startsWith('imu')), false);
  const links = targetFor(withWand([])).filter((l) => l.a.startsWith('imu:'));
  assert.deepEqual(links.map((l) => [l.a, l.b]), [
    ['imu:VCC', 'esp:3V3'], ['imu:GND', 'esp:GND'], ['imu:SDA', 'esp:GPIO1'], ['imu:SCL', 'esp:GPIO2'],
  ]);
  assert.ok(links.every((l) => l.why.length > 0));
  const espPins = new Set(PARTS.esp32.pins.map((p) => `esp:${p.name}`));
  assert.ok(links.every((l) => espPins.has(l.b)));
});

test('crossed SDA and SCL are called swapped and named by their silk', () => {
  const b = withWand([['VCC', 'esp:3V3'], ['GND', 'esp:GND'], ['SDA', 'esp:GPIO2'], ['SCL', 'esp:GPIO1']], { rest: true });
  const [first] = diagnose(b, powerOn(b));
  assert.equal(first.kind, 'swapped');
  for (const s of ['imu SDA', 'imu SCL', 'GPIO 1', 'GPIO 2']) assert.match(first.text, new RegExp(s));
});

test('SDA slipped onto the GPIO beside GPIO 1 is a neighbour-pin', () => {
  // GPIO 1 and 2 are side by side on the ESP32, so the hand that slips is the board's, not the wand's.
  const b = withWand([['VCC', 'esp:3V3'], ['GND', 'esp:GND'], ['SDA', 'esp:GPIO2']], { rest: true });
  const [first] = diagnose(b, powerOn(b));
  assert.equal(first.kind, 'neighbour-pin');
  assert.match(first.text, /imu SDA/);
  assert.match(first.text, /GPIO 2/);
  assert.match(first.text, /GPIO 1/);
});

test('every wand fault has its own words', () => {
  const cases = [
    withWand([['VCC', 'esp:5V'], ['GND', 'esp:GND'], ['SDA', 'esp:GPIO1'], ['SCL', 'esp:GPIO2']]),
    withWand([['GND', 'esp:GND'], ['SDA', 'esp:GPIO1'], ['SCL', 'esp:GPIO2']]),
    withWand([['VCC', 'esp:3V3'], ['GND', 'esp:GND'], ['SDA', 'esp:GPIO8'], ['SCL', 'esp:GPIO2']]),
    withWand([['VCC', 'esp:3V3'], ['GND', 'esp:GND'], ['SDA', 'esp:GPIO1'], ['SCL', 'esp:GND']]),
  ];
  for (const b of cases) {
    for (const h of diagnose(b, powerOn(b)).filter((x) => x.kind === 'fault')) {
      assert.doesNotMatch(h.text, /Something is wrong here/);
    }
  }
});

test('the hint on a bare wand starts with its VCC', () => {
  const b = withWand([], { rest: true });
  assert.match(nextHint(b)?.text ?? '', /^Connect imu VCC to 3V3\./);
});
