import test from 'node:test';
import assert from 'node:assert/strict';
import { BODIES, BODY_IDS, CAN_DO, bodyById, bodyProblem } from '../core/bodies.js';

test('the five bodies exist, with unique ids and a preview each', () => {
  assert.deepEqual(BODY_IDS, ['car', 'pet', 'tarot', 'dry-run', 'none']);
  for (const body of BODIES) {
    assert.equal(bodyProblem(body), null, body.id);
    assert.ok(body.label && body.labelZh, body.id);
    assert.ok(body.preview, body.id);
  }
  assert.equal(bodyById('pet')?.actions.includes('pose'), true);
  assert.equal(bodyById('nope'), undefined);
});

test('an action without its capability is refused', () => {
  assert.match(bodyProblem({ id: 'x', label: 'X', labelZh: 'X', needs: [], source: 'none', firmware: null, capabilities: ['speak'], actions: ['pose'], preview: 'pet' }) ?? '', /pose/);
});

test('a board body needs firmware and a phone body must not have one', () => {
  const base = { id: 'x', label: 'X', labelZh: 'X', needs: [], capabilities: ['speak'], actions: [], preview: 'face' };
  assert.match(bodyProblem({ ...base, source: 'board', firmware: null }) ?? '', /firmware/);
  assert.match(bodyProblem({ ...base, source: 'phone', firmware: 'body' }) ?? '', /firmware/);
  assert.equal(bodyProblem({ ...base, source: 'phone', firmware: null }), null);
});

// The table replaces CAN_DO, so it has to say exactly what CAN_DO said. A
// tarot reader draws and nothing else: it has no wheels and it does not pose,
// and what it says is the robot's audio, which is not a tool call.
test('the actions are the ones the bodies already carry out', () => {
  const actions = Object.fromEntries(BODIES.map((b) => [b.id, [...b.actions]]));
  assert.deepEqual(actions, {
    car: ['move', 'cruise', 'stop', 'sound'],
    pet: ['pose', 'sound'],
    tarot: ['draw'],
    'dry-run': ['move', 'cruise', 'stop', 'sound'],
    none: ['sound'],
  });
});

// The one view the rest of the app kept asking for: a body id to the actions
// it carries out. Derived, so it cannot drift from the table above.
test('CAN_DO is the table, keyed by body id', () => {
  assert.deepEqual(CAN_DO.tarot, ['draw']);
  assert.deepEqual(CAN_DO.car, ['move', 'cruise', 'stop', 'sound']);
  assert.deepEqual(Object.keys(CAN_DO).sort(), [...BODY_IDS].sort());
});

