import test from 'node:test';
import assert from 'node:assert/strict';
import { PROFILES } from '../../sim/devices/profiles.js';
import { evaluatePwm, pulseForAngle, angleForPulse, SERVO_PWM } from '../../sim/electrical/pwm.js';

const instance = { id: 'servo', point: 'esp:GPIO6', pin: 'GPIO6' };
test('50 Hz, 500-2400 us and an idle command by default', () => {
  const result = evaluatePwm(PROFILES[0], instance);
  assert.equal(result.state, 'idle');
  assert.equal(result.frequencyHz, SERVO_PWM.frequencyHz);
  assert.equal(result.pulseUs, null);
  assert.equal(result.duty, 0);
  assert.deepEqual(result.faults, []);
});
test('angles map to pulses and clamp to the safe range', () => {
  assert.equal(pulseForAngle(0), 500);
  assert.equal(pulseForAngle(90), 1450);
  assert.equal(pulseForAngle(180), 2400);
  assert.equal(pulseForAngle(200), 2400);
  assert.ok(Math.abs(angleForPulse(1000) - 47.368) < 0.01);
  const result = evaluatePwm(PROFILES[0], instance, { angle: 90 });
  assert.equal(result.state, 'moving');
  assert.equal(result.pulseUs, 1450);
  assert.ok(Math.abs(result.duty - 0.0725) < 0.0001);
});
test('a pin without PWM support and a wrong frequency are reported', () => {
  assert.ok(evaluatePwm(PROFILES[0], { ...instance, pin: 'GPIO99' }).faults.some(f => f.code === 'pwm-pin-unsupported'));
  assert.ok(evaluatePwm(PROFILES[0], instance, { angle: 30, frequencyHz: 60 }).faults.some(f => f.code === 'pwm-frequency-unsupported'));
});
test('a stalled command is a distinct state', () => {
  assert.equal(evaluatePwm(PROFILES[0], instance, { angle: 90, stalled: true }).state, 'stalled');
});
