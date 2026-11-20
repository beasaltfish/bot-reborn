import test from 'node:test';
import assert from 'node:assert/strict';
import { BODIES, BODY_IDS, CAN_DO, bodyById, bodyProblem, labelOf } from '../core/bodies.js';

test('the five bodies exist, with unique ids and a preview each', () => {
  assert.deepEqual(BODY_IDS, ['none', 'pet', 'tarot', 'dry-run', 'toy']);
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

test('a board way needs firmware and a phone way must not have one', () => {
  const base = { id: 'x', label: 'X', labelZh: 'X', capabilities: ['speak'], actions: [], preview: 'face' };
  assert.match(bodyProblem({ ...base, ways: [{ source: 'board', needs: [] }], firmware: null }) ?? '', /firmware/);
  assert.match(bodyProblem({ ...base, ways: [{ source: 'phone', needs: [] }], firmware: 'body' }) ?? '', /firmware/);
  assert.equal(bodyProblem({ ...base, ways: [{ source: 'phone', needs: [] }], firmware: null }), null);
  // A body reachable both ways is flashed for one of them and not the other.
  assert.equal(bodyProblem({ ...base, ways: [{ source: 'board', needs: [] }, { source: 'phone', needs: [] }], firmware: 'body.bin' }), null);
});

test('a body may be reached more than one way, and each way says what it needs', () => {
  const toy = bodyById('toy');
  assert.deepEqual(toy?.ways.map((w) => w.source), ['board']);
  assert.ok(toy?.ways[0].needs.includes('toy'), 'the toy is the thing being driven');
  assert.ok(toy?.ways[0].needs.includes('mic'), 'a board needs ears to hear the order');
  assert.deepEqual(bodyById('pet')?.ways.map((w) => w.source), ['board']);
  // Every board body hears and speaks, so every board list has a mic and an amp.
  for (const b of BODIES) {
    for (const w of b.ways.filter((x) => x.source === 'board')) {
      assert.ok(w.needs.includes('mic') && w.needs.includes('amp'), b.id);
    }
  }

  // Two bodies on the same board, two different bills of materials.
  const voice = bodyById('none');
  assert.deepEqual(voice?.ways.map((w) => w.source), ['board']);
  assert.ok(voice?.ways[0].needs.includes('mic'), 'a board voice-only body needs a microphone');
});

// The phone page still works, but it is not offered as a way to get a body
// until the ESP32 path is settled: one body, one way, one thing to explain.
test('no body offers the phone while the ESP32 path is being settled', () => {
  for (const b of BODIES) {
    assert.ok(!b.ways.some((w) => w.source === 'phone'), b.id);
  }
  // A dry run still has no hardware at all; everything else is a board build.
  assert.deepEqual(bodyById('dry-run')?.ways.map((w) => w.source), ['none']);
});

test('a way nobody can follow is refused', () => {
  const base = { id: 'x', label: 'X', labelZh: 'X', firmware: null, capabilities: ['speak'], actions: [], preview: 'pet' };
  assert.match(bodyProblem({ ...base, ways: [] }) ?? '', /way/);
  assert.match(bodyProblem({ ...base, ways: [{ source: 'telepathy', needs: [] }] }) ?? '', /telepathy/);
  assert.match(bodyProblem({ ...base, ways: [{ source: 'phone', needs: ['unobtainium'] }] }) ?? '', /unobtainium/);
});

test('what a body senses with is in the list of things it needs', () => {
  const tarot = bodyById('tarot');
  assert.ok(tarot?.capabilities.includes('sense'));
  const needs = tarot?.ways.flatMap((w) => w.needs) ?? [];
  assert.ok(needs.includes('wand'), 'a tarot reader senses with the MPU-6050 wand');
});

test('the driving body is a toy with wheels, not a category called car', () => {
  const toy = bodyById('toy');
  assert.equal(toy?.label, 'Toy on wheels');
  assert.equal(toy?.labelZh, '会动的玩具');
  // The parts a buyer shops for, not a chip number: the model lives in docs/hardware.md.
  assert.deepEqual(toy?.ways[0].needs, ['toy', 'board', 'mic', 'amp']);
});

test('a voice-only body does not borrow the phone\'s face', () => {
  const voice = bodyById('none');
  assert.deepEqual(voice?.capabilities, ['hear', 'speak']);
  assert.equal(voice?.label, 'Voice only');
});

test('the label is the reader\'s language', () => {
  assert.equal(labelOf(bodyById('pet') ?? BODIES[0], 'en'), 'Pet on a screen');
  assert.equal(labelOf(bodyById('pet') ?? BODIES[0], 'zh'), '屏幕宠物');
});

// The table replaces CAN_DO, so it has to say exactly what CAN_DO said. A
// tarot reader draws and nothing else: it has no wheels and it does not pose,
// and what it says is the robot's audio, which is not a tool call.
test('the actions are the ones the bodies already carry out', () => {
  const actions = Object.fromEntries(BODIES.map((b) => [b.id, [...b.actions]]));
  assert.deepEqual(actions, {
    toy: ['move', 'cruise', 'stop', 'sound'],
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
  assert.deepEqual(CAN_DO.toy, ['move', 'cruise', 'stop', 'sound']);
  assert.deepEqual(Object.keys(CAN_DO).sort(), [...BODY_IDS].sort());
});

