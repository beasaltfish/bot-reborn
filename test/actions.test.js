import test from 'node:test';
import assert from 'node:assert/strict';
import { actionProblem, expand } from '../core/actions.js';

/** @type {{ poses: string[], clips: string[], has: (verb: string) => boolean }} */
const OPTS = { poses: ['sit', 'shake', 'spin', 'stand', 'lie'], clips: ['hello', 'bye'], has: () => true };

/**
 * Identity with a type, so the literals below are checked as actions.
 * @type {(action: import('../core/actions.js').Action) => import('../core/actions.js').Action}
 */
const action = (a) => a;

/** The `move` action as a body will write it: one drive per element of `steps`. */
const MOVE = action({
  name: 'move',
  args: {
    type: 'object',
    required: ['steps'],
    properties: {
      steps: {
        type: 'array',
        maxItems: 5,
        items: {
          type: 'object',
          required: ['drive', 'steer', 'duration_ms'],
          properties: {
            drive: { enum: ['forward', 'backward'] },
            steer: { enum: ['left', 'right', 'straight'] },
            duration_ms: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
  },
  run: [{
    verb: 'drive',
    each: 'steps',
    args: { drive: '$each.drive', steer: '$each.steer', ms: '$each.duration_ms' },
  }],
});

test('an action may only use verbs the body has', () => {
  assert.match(actionProblem(action({ name: 'fly', run: [{ verb: 'fly' }] }), OPTS) ?? '', /unknown verb/);
  assert.match(
    actionProblem(action({ name: 'card', run: [{ verb: 'draw' }] }), { ...OPTS, has: (verb) => verb !== 'draw' }) ?? '',
    /does not have/,
  );
});

test('a $arg that is not a declared parameter is refused', () => {
  const say = action({
    name: 'say',
    args: { type: 'object', properties: {} },
    run: [{ verb: 'voice', args: { clip: '$sound' } }],
  });
  assert.match(actionProblem(say, OPTS) ?? '', /sound/);
});

test('a pose or a clip outside the known sets is refused', () => {
  const nod = action({ name: 'nod', run: [{ verb: 'pose', args: { pose: 'nod' } }] });
  assert.match(actionProblem(nod, OPTS) ?? '', /pose nod is not one of/);

  const roar = action({ name: 'roar', run: [{ verb: 'voice', args: { clip: 'roar' } }] });
  assert.match(actionProblem(roar, OPTS) ?? '', /clip roar is not one of/);

  // The same sentence must stay quiet for a value the body does have.
  assert.equal(actionProblem(action({ name: 'sit', run: [{ verb: 'pose', args: { pose: 'sit' } }] }), OPTS), null);
});

test('expand substitutes a top-level argument', () => {
  const sit = action({
    name: 'sit',
    args: { type: 'object', required: ['pose'], properties: { pose: { type: 'string' } } },
    run: [{ verb: 'pose', args: { pose: '$pose' } }],
  });
  assert.deepEqual(expand(sit, { pose: 'sit' }), {
    steps: [{ verb: 'pose', args: { pose: 'sit' } }],
    dropped: [],
    hadDrive: false,
  });
});

test('expand walks an array argument with $each', () => {
  const r = expand(MOVE, { steps: [
    { drive: 'forward', steer: 'straight', duration_ms: 600 },
    { drive: 'backward', steer: 'left', duration_ms: 'hold' },
  ] });
  assert.deepEqual(r.steps, [
    { verb: 'drive', args: { drive: 'forward', steer: 'straight', ms: 600 } },
    { verb: 'drive', args: { drive: 'backward', steer: 'left', ms: 'hold' } },
  ]);
  assert.deepEqual(r.dropped, []);
  assert.equal(r.hadDrive, true);
});

test('an element dropped for bad args does not stop the rest', () => {
  const r = expand(MOVE, { steps: [
    // 60000 is legal: a numeric ms has no upper bound, it is sliced later.
    { drive: 'forward', steer: 'straight', duration_ms: 60000 },
    { drive: 'sideways', steer: 'left', duration_ms: 600 },
    { drive: 'forward', steer: 'straight', duration_ms: 0 },
  ] });
  assert.equal(r.steps.length, 1);
  assert.deepEqual(r.steps[0], { verb: 'drive', args: { drive: 'forward', steer: 'straight', ms: 60000 } });
  assert.equal(r.dropped.length, 2);
  assert.match(r.dropped.join('\n'), /duration_ms/, 'the reason keeps the field the author wrote');
});

test('a missing verb stops the whole action', () => {
  const mixed = action({
    name: 'mixed',
    run: [
      { verb: 'pose', args: { pose: 'sit' } },
      { verb: 'fly' },
      { verb: 'halt' },
    ],
  });
  const r = expand(mixed, {});
  assert.deepEqual(r.steps, []);
  assert.equal(r.dropped.length, mixed.run.length);
  assert.match(r.dropped.join('\n'), /fly/);
  assert.equal(r.hadDrive, false);
});

test('a schema word outside the subset is refused by name', () => {
  const strict = action({
    name: 'strict',
    args: /** @type {any} */ ({
      type: 'object',
      properties: { pose: { type: 'string', pattern: '^a' } },
    }),
    run: [{ verb: 'pose', args: { pose: 'sit' } }],
  });
  assert.match(actionProblem(strict, OPTS) ?? '', /pattern/);

  const extra = action({
    name: 'loose',
    args: /** @type {any} */ ({ type: 'object', additionalProperties: false, properties: {} }),
    run: [{ verb: 'halt' }],
  });
  assert.match(actionProblem(extra, OPTS) ?? '', /additionalProperties/);
});

test('an action with nothing to run, or an each that is not an array, is refused', () => {
  assert.match(actionProblem(action({ name: 'empty', run: [] }), OPTS) ?? '', /no steps/);

  const wrong = action({
    name: 'wrong',
    args: { type: 'object', properties: { pose: { type: 'string' } } },
    run: [{ verb: 'pose', each: 'pose', args: { pose: '$each.pose' } }],
  });
  assert.match(actionProblem(wrong, OPTS) ?? '', /not an array/);

  const undeclared = action({ name: 'lost', args: { type: 'object', properties: {} }, run: [{ verb: 'pose', each: 'steps' }] });
  assert.match(actionProblem(undeclared, OPTS) ?? '', /steps/);
});
