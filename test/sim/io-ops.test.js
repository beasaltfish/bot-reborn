import test from 'node:test';
import assert from 'node:assert/strict';

import { createBenchIo } from '../../sim/bench-io.js';

test('a pin write turns a GPIO on and its safe value turns it off', async () => {
  const io = createBenchIo({ pins: { 5: 0 } });
  await io({ op: 'pin.write', args: { pin: 5, level: 1 }, safe: 0 });
  assert.equal(io.level(5), 1);
  await io.disconnect();
  assert.equal(io.level(5), 0);
});

test('a read answers from the evaluated pin', async () => {
  const io = createBenchIo({ pins: { 4: 1 } });
  assert.equal(await io.run({ op: 'pin.read', args: { pin: 4 } }), 1);
  assert.equal(await io.run({ op: 'pin.read', args: { pin: 9 } }), 0);
});

test('pwm puts a non-zero pulse width on the pin and a zero width off', async () => {
  const io = createBenchIo({ pins: { 5: 0 } });
  await io.run({ op: 'pwm', args: { pin: 5, us: 1450 }, safe: 0 });
  assert.equal(io.level(5), 1);
  assert.equal(io.duty(5), 1450);
  await io.run({ op: 'pwm', args: { pin: 5, us: 0 }, safe: 0 });
  assert.equal(io.level(5), 0);
});

test('disconnect restores every written pin, each to its own safe value', async () => {
  const io = createBenchIo({ pins: { 5: 0, 6: 1 } });
  await io.run({ op: 'pin.write', args: { pin: 5, level: 1 }, safe: 0 });
  await io.run({ op: 'pin.write', args: { pin: 6, level: 0 }, safe: 1 });
  await io.disconnect();
  assert.equal(io.level(5), 0);
  assert.equal(io.level(6), 1);
});

test('an unknown op is refused with unavailable, not a crash', async () => {
  const io = createBenchIo({ pins: {} });
  await assert.rejects(io.run({ op: 'servo', args: {} }), /unavailable/);
  await assert.rejects(io.run({ op: 'i2c.read', args: { pin: 1 } }), /unavailable/);
});

test('a bad pin or level is refused with bad-args', async () => {
  const io = createBenchIo({ pins: {} });
  await assert.rejects(io.run({ op: 'pin.write', args: { pin: 'five', level: 1 }, safe: 0 }), /bad-args/);
  await assert.rejects(io.run({ op: 'pin.write', args: { pin: 5, level: 2 }, safe: 0 }), /bad-args/);
  await assert.rejects(io.run({ op: 'pwm', args: { pin: 5, us: 'wide' }, safe: 0 }), /bad-args/);
});
