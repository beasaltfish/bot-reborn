import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { motorLevels } from '../../sim/car.js';

const CASES = JSON.parse(readFileSync(new URL('../../firmware/test/motor-cases.json', import.meta.url), 'utf8'));

test('every motor case gives the firmware\'s four levels', () => {
  for (const c of CASES) {
    assert.deepEqual(
      motorLevels(c.drive, c.steer, { driveSwapped: c.driveSwapped, steerSwapped: c.steerSwapped }),
      c.pins,
      JSON.stringify(c),
    );
  }
});

test('a pair is never both high, on any case', () => {
  for (const c of CASES) {
    const [a, b, s, t] = motorLevels(c.drive, c.steer, { driveSwapped: c.driveSwapped, steerSwapped: c.steerSwapped });
    assert.ok(!(a && b), JSON.stringify(c));
    assert.ok(!(s && t), JSON.stringify(c));
  }
});

test('an unknown drive or steer throws a RangeError', () => {
  assert.throws(() => motorLevels('sideways', 'left'), RangeError);
  assert.throws(() => motorLevels('forward', 'up'), RangeError);
});
