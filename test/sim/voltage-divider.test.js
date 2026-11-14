import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateVoltageDivider } from '../../sim/electrical/voltage-divider.js';

const fixture = () => ({
  sourceVoltage: { min: 4.9, max: 5.1 }, sourceResistanceOhm: { min: 0, max: 100 },
  upperOhm: { min: 2090, max: 2310 }, lowerOhm: { min: 3135, max: 3465 },
  inputLeakageUa: { min: -10, max: 10 },
  inputLimits: { minVoltage: 0, maxVoltage: 3.6, highMinVoltage: 2.3 },
});

test('bounded divider calculates worst-case output from declared ranges only', () => {
  const result = evaluateVoltageDivider(fixture());
  assert.equal(result.status, 'within-declared-bounds');
  assert.ok(result.voltageMin > 2.5 && result.voltageMin < 3);
  assert.ok(result.voltageMax > 3 && result.voltageMax < 3.6);
  assert.ok(result.voltageMin < result.voltageMax);
});

test('reports out-of-bounds voltage or indeterminate high without claiming damage', () => {
  const high = fixture(); high.sourceVoltage = { min: 4.75, max: 5.25 }; high.upperOhm = { min: 950, max: 1050 }; high.lowerOhm = { min: 1900, max: 2100 };
  assert.equal(evaluateVoltageDivider(high).status, 'outside-declared-bounds');
  const uncertain = fixture(); uncertain.upperOhm = { min: 10000, max: 10000 }; uncertain.lowerOhm = { min: 10000, max: 10000 }; uncertain.inputLimits.highMinVoltage = 3;
  assert.equal(evaluateVoltageDivider(uncertain).status, 'indeterminate-high');
  const below = fixture(); below.sourceVoltage = { min: 0, max: 0 };
  assert.equal(evaluateVoltageDivider(below).status, 'outside-declared-bounds');
});

test('rejects missing, inverted, non-finite and physically invalid declared ranges', () => {
  const inverted = fixture(); inverted.upperOhm = { min: 200, max: 100 };
  const zero = fixture(); zero.lowerOhm = { min: 0, max: 100 };
  const bad = fixture(); bad.inputLeakageUa.min = NaN;
  for (const value of [inverted, zero, bad, null]) assert.equal(evaluateVoltageDivider(value).status, 'unsupported');
});

test('extreme leakage cases are bounded by evaluating all resistor corners', () => {
  const parameters = fixture(); parameters.sourceVoltage = { min: 1, max: 1 }; parameters.sourceResistanceOhm = { min: 0, max: 0 };
  parameters.upperOhm = { min: 10000, max: 20000 }; parameters.lowerOhm = { min: 10000, max: 20000 };
  parameters.inputLeakageUa = { min: -100, max: 100 };
  const result = evaluateVoltageDivider(parameters);
  /** @type {number[]} */ const values = [];
  for (const upper of [10000, 20000]) for (const lower of [10000, 20000]) for (const leakage of [-100, 100]) values.push((1 / upper + leakage / 1e6) / (1 / upper + 1 / lower));
  assert.ok(Math.abs((result.voltageMin ?? Infinity) - Math.min(...values)) < 1e-12);
  assert.ok(Math.abs((result.voltageMax ?? Infinity) - Math.max(...values)) < 1e-12);
});
