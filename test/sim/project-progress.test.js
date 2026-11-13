import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench, addWire, trash } from '../../sim/bench.js';
import { projectById } from '../../sim/projects.js';
import { connectionProgress } from '../../sim/project-progress.js';

const project = /** @type {import('../../sim/projects.js').Project} */ (projectById('audio'));
assert.ok(project);

/** @param {ReturnType<typeof emptyBench>} bench @param {string} a */
function entry(bench, a) {
  const found = connectionProgress(bench, project).find(link => link.a === a);
  assert.ok(found, a);
  return found;
}

test('connection progress uses nets rather than literal endpoints', () => {
  let b = emptyBench();
  assert.equal(entry(b, 'mic:VDD').status, 'missing');
  assert.equal(entry(b, 'mic:VDD').present, true);
  b = addWire(b, 'mic:VDD', 'bb1:a1', 'red');
  b = addWire(b, 'esp:3V3', 'bb1:e1', 'red');
  const result = entry(b, 'mic:VDD');
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.faultCodes, []);
  assert.equal(result.b, 'esp:3V3');
  assert.ok(result.id && result.whyKey);
});

test('crossed bridged-speaker terminals count as complete only when both are connected', () => {
  let b = emptyBench();
  b = addWire(b, 'spk:+', 'amp:-', 'red');
  assert.equal(entry(b, 'spk:+').status, 'missing');
  b = addWire(b, 'spk:-', 'amp:+', 'black');
  assert.equal(entry(b, 'spk:+').status, 'complete');
  assert.equal(entry(b, 'spk:-').status, 'complete');
});

test('a fault touching a completed connection marks it fault, not missing', () => {
  let b = { ...emptyBench(), usb: true };
  b = addWire(b, 'mic:VDD', 'esp:3V3', 'red');
  b = addWire(b, 'esp:GND', 'esp:3V3', 'red');
  const result = entry(b, 'mic:VDD');
  assert.equal(result.status, 'fault');
  assert.ok(result.faultCodes.includes('short-rails'));
});

test('removed project parts do not make a connection complete', () => {
  let b = addWire(emptyBench(), 'mic:VDD', 'esp:3V3', 'red');
  const removed = trash(b, 'mic');
  assert.ok(!('refused' in removed));
  b = removed;
  assert.equal(entry(b, 'mic:VDD').status, 'missing');
  assert.equal(entry(b, 'mic:VDD').present, false);
});
