import test from 'node:test';
import assert from 'node:assert/strict';
import { GATING, fabRung, checklist } from '../web/steps.js';

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

test('the list and the button never disagree about what is next', () => {
  // Spec §6: one state, two renderings. Two sources would drift, and the drift
  // would read as the product asking for one thing and rewarding another.
  for (const done of [none, { ...none, keys: true }, { ...none, keys: true, car: true }, all]) {
    const current = checklist(done).find((r) => r.state === 'current');
    const rung = fabRung(done, false);
    assert.equal(current?.step ?? 'listen', rung.step, `disagreed at ${JSON.stringify(done)}`);
  }
});

test('the list marks what is behind you, what is now, and what is not yet', () => {
  assert.deepEqual(
    checklist({ keys: true, car: false, steer: false }).map((r) => [r.step, r.state]),
    [['keys', 'done'], ['car', 'current'], ['steer', 'todo']],
  );
});

test('everything done leaves no current row', () => {
  assert.equal(checklist(all).find((r) => r.state === 'current'), undefined);
  assert.deepEqual(checklist(all).map((r) => r.state), ['done', 'done', 'done']);
});

test('a later step finished out of order is still shown as done', () => {
  // Pairing happens in setup.html too, and calibration could in principle be
  // done from the bench. The list reports what is true, not what it expected.
  const rows = checklist({ keys: false, car: false, steer: true });
  assert.deepEqual(rows.map((r) => r.state), ['current', 'todo', 'done']);
});
