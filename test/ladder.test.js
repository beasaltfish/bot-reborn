import test from 'node:test';
import assert from 'node:assert/strict';
import { Ladder, LADDER, WINDOW_MS } from '../web/ladder.js';
import { validate } from '../web/brain.js';

test('first time: bark back, nothing else', () => {
  assert.deepEqual(new Ladder(() => 0).next(), [{ kind: 'sound', name: 'bark' }]);
});

test('second within the window: bark and run; third and after: whimper and back off', () => {
  let t = 0;
  const l = new Ladder(() => t);
  l.next();
  t = 5000;
  const second = /** @type {any[]} */ (l.next());
  assert.deepEqual(second[0], { kind: 'sound', name: 'bark' });
  assert.equal(second[1].kind, 'move');
  t = 9000;
  const third = /** @type {any[]} */ (l.next());
  assert.deepEqual(third[0], { kind: 'sound', name: 'whimper' });
  t = 12000;
  assert.deepEqual(l.next(), third, 'it stays on the top rung');
});

test('a quiet window starts it over', () => {
  let t = 0;
  const l = new Ladder(() => t);
  l.next();
  t = WINDOW_MS + 1;
  assert.deepEqual(l.next(), LADDER[0]);
});

test('reset() starts it over', () => {
  const l = new Ladder(() => 0);
  l.next();
  l.reset();
  assert.deepEqual(l.next(), LADDER[0]);
});

test('next() hands out copies: editing one cannot change the table', () => {
  const l = new Ladder(() => 0);
  const a = /** @type {any[]} */ (l.next());
  a[0].name = 'growl';
  assert.equal(/** @type {any} */ (LADDER[0][0]).name, 'bark');
});

test('every move on the ladder passes the same validator as the LLM\'s', () => {
  // Spec §4: the reflex must not be a way round validate().
  for (const rung of LADDER) {
    for (const action of rung) {
      if (action.kind !== 'move') continue;
      const r = validate([{ id: 'x', name: 'move', args: { steps: action.steps }, rawArguments: '' }]);
      assert.deepEqual(r.actions, [action]);
      assert.deepEqual(r.reasons, []);
    }
  }
});
