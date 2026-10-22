import test from 'node:test';
import assert from 'node:assert/strict';

import { PARTS, holeStrip, holeXY, holeAt } from '../../sim/parts.js';
import { TARGET } from '../../sim/target.js';

// The simulator's rules (which holes are joined, what a wire reaches) all
// rest on these tables, so what they promise is pinned down here.

test('holes in one half-column share a strip, and the centre gap splits it', () => {
  assert.equal(holeStrip('bb:a12'), holeStrip('bb:e12'));
  assert.notEqual(holeStrip('bb:e12'), holeStrip('bb:f12'));
  assert.notEqual(holeStrip('bb:a12'), holeStrip('bb:a13'));
  assert.equal(holeStrip('bb:g12'), 'col12-bottom');
});

test('a rail is one strip along its whole length', () => {
  assert.equal(holeStrip('bb:tp1'), holeStrip('bb:tp50'));
  assert.equal(holeStrip('bb:tp7'), 'tp');
  assert.notEqual(holeStrip('bb:tp1'), holeStrip('bb:tn1'));
});

test('holeAt is the inverse of holeXY for every hole', () => {
  const c40 = holeXY('bb:c40');
  assert.equal(holeAt(c40.x, c40.y), 'bb:c40');
  for (const rail of ['tp', 'tn', 'bp', 'bn']) {
    for (const n of [1, 5, 6, 50]) {
      const id = `bb:${rail}${n}`;
      const { x, y } = holeXY(id);
      assert.equal(holeAt(x, y), id);
    }
  }
  assert.equal(holeAt(-5, -5), null);
  assert.throws(() => holeXY('bb:z1'));
});

test('the ESP32 has the pins the firmware uses, and its grounds are joined', () => {
  const names = PARTS.esp32.pins.map((p) => p.name);
  for (const n of ['GPIO12', 'GPIO13', 'GPIO14', 'GPIO15', '3V3', '5V', 'GND']) {
    assert.ok(names.includes(n), n);
  }
  assert.equal(new Set(names).size, names.length, 'point ids must be unique');
  assert.equal(PARTS.esp32.pins.length, 44);
  const gnd = PARTS.esp32.internal.find((g) => g.includes('GND'));
  assert.equal(gnd?.length, 4);
});

test('every TARGET endpoint names a real pin', () => {
  const byInstance = { esp: 'esp32', mic: 'inmp441', amp: 'max98357a', spk: 'speaker' };
  /** @param {string} point */
  const exists = (point) => {
    const [inst, pin] = point.split(':');
    const part = PARTS[/** @type {keyof typeof PARTS} */ (byInstance[/** @type {keyof typeof byInstance} */ (inst)])];
    return !!part && part.pins.some((p) => p.name === pin);
  };
  assert.ok(TARGET.length > 0);
  for (const link of TARGET) {
    assert.ok(exists(link.a), link.a);
    assert.ok(exists(link.b), link.b);
    assert.ok(link.why.length > 0);
  }
});
