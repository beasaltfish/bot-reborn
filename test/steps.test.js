import test from 'node:test';
import assert from 'node:assert/strict';
import { GATING, fabRung, STEP_LABEL } from '../web/steps.js';

const none = { keys: false, car: false, steer: false };
const all = { keys: true, car: true, steer: true };

test('the three gating steps are the ones without which the car cannot move', () => {
  assert.deepEqual([...GATING], ['keys', 'car', 'steer']);
});

test('the button offers the first unfinished step, in order', () => {
  assert.equal(fabRung(none, false).step, 'keys');
  assert.equal(fabRung({ ...none, keys: true }, false).step, 'car');
  assert.equal(fabRung({ ...none, keys: true, car: true }, false).step, 'steer');
  assert.equal(fabRung(all, false).step, 'listen');
});

test('running outranks everything — the stop is always reachable', () => {
  // The car can be rolling with the setup half done: a previous session paired
  // it, or calibration itself moved it. Whatever is unfinished, the button a
  // person needs at that moment is the brake.
  for (const done of [none, { ...none, keys: true }, all]) {
    assert.equal(fabRung(done, true).step, 'stop');
    assert.equal(fabRung(done, true).tone, 'stop');
  }
});

test('red is the stop and nothing else wears it', () => {
  const tones = [
    fabRung(none, false), fabRung({ ...none, keys: true }, false),
    fabRung({ ...none, keys: true, car: true }, false), fabRung(all, false),
  ].map((r) => r.tone);
  assert.deepEqual(tones, ['wait', 'wait', 'wait', 'go']);
});


test('every gating step has a name, and it is the name the robot uses', () => {
  // ui.js labels the robot's three touch bands from this table, and settings
  // names its two doors from it. A step with no entry is a band a screen
  // reader announces as "button".
  for (const step of GATING) {
    assert.ok(STEP_LABEL[step], `no label for the "${step}" step`);
  }
  assert.equal(Object.keys(STEP_LABEL).length, GATING.length);
});
