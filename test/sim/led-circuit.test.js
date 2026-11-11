import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLed } from '../../sim/electrical/led.js';

const base = { voltage: 5, resistance: 220, forwardVoltage: 2, maxCurrentMa: 20, maxPowerMw: 60, currentLimitMa: 500 };

test('series LED current and power follow the source and resistance', () => {
  const result = evaluateLed(base);
  assert.equal(result.state, 'on');
  assert.ok(Math.abs(result.currentMa - 13.636) < 0.001);
  assert.ok(Math.abs(result.resistorPowerMw - 40.909) < 0.001);
});

test('reverse polarity, an absent resistor and source current limit are distinguished', () => {
  assert.equal(evaluateLed({ ...base, reversed: true }).state, 'off');
  assert.equal(evaluateLed({ ...base, resistance: 0 }).state, 'overcurrent');
  assert.equal(evaluateLed({ ...base, currentLimitMa: 10 }).state, 'limited');
  assert.throws(() => evaluateLed({ ...base, resistance: -1 }), RangeError);
});
