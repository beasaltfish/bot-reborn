import test from 'node:test';
import assert from 'node:assert/strict';
import { actionProblem, expand, expectationOf } from '../core/actions.js';
import { VERB_NAMES } from '../core/verbs.js';

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
  assert.deepEqual(r.dropped, [
    {
      where: 'steps[1]',
      value: { drive: 'sideways', steer: 'left', duration_ms: 600 },
      expect: 'drive must be one of forward/backward, steer one of left/right/straight, duration_ms an integer >= 1',
    },
    {
      where: 'steps[2]',
      value: { drive: 'forward', steer: 'straight', duration_ms: 0 },
      expect: 'drive must be one of forward/backward, steer one of left/right/straight, duration_ms an integer >= 1',
    },
  ]);
});

test('a step whose own args do not fit is one drop about the arguments', () => {
  const shout = action({
    name: 'shout',
    args: { type: 'object', properties: { clip: { type: 'string' } } },
    run: [{ verb: 'voice', args: { clip: '$clip' } }],
  });
  const r = expand(shout, { clip: 5 });
  assert.deepEqual(r.steps, []);
  assert.deepEqual(r.dropped, [{ where: 'args', value: { clip: 5 }, expect: 'clip must be a string' }]);
});

test('an each argument that is not an array is one drop about the argument', () => {
  const r = expand(MOVE, { steps: 'forward' });
  assert.deepEqual(r.steps, []);
  assert.deepEqual(r.dropped, [{ where: 'args', value: 'forward', expect: 'an array for steps' }]);
  assert.equal(r.hadDrive, false);
});

test('an argument longer than maxItems is truncated, not refused', () => {
  const six = Array.from({ length: 6 }, (_, i) => ({ drive: 'forward', steer: 'straight', duration_ms: 300 + i }));
  const r = expand(MOVE, { steps: six });
  assert.equal(r.steps.length, 5, 'maxItems: 5 keeps the first five');
  assert.deepEqual(r.dropped, []);
  assert.deepEqual(r.steps[4].args, { drive: 'forward', steer: 'straight', ms: 304 });
});

test('expand copies, so the caller\'s arguments are never changed', () => {
  const element = Object.freeze({ drive: 'forward', steer: 'left', duration_ms: 600 });
  const args = Object.freeze({ steps: Object.freeze([element]) });
  const r = expand(MOVE, args);
  assert.deepEqual(r.steps, [{ verb: 'drive', args: { drive: 'forward', steer: 'left', ms: 600 } }]);
  assert.deepEqual(args.steps[0], { drive: 'forward', steer: 'left', duration_ms: 600 }, 'the element is untouched');
  assert.notEqual(r.steps[0].args, element, 'the step gets its own object');

  // A literal step's args are copied too, so freezing the action is safe.
  const literal = action({
    name: 'go',
    run: [{ verb: 'drive', args: Object.freeze({ drive: 'forward', steer: 'left', ms: 'hold' }) }],
  });
  const out = expand(literal, {});
  assert.deepEqual(out.steps, [{ verb: 'drive', args: { drive: 'forward', steer: 'left', ms: 'hold' } }]);
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
  assert.deepEqual(r.dropped[1], {
    where: 'steps[1]',
    value: { verb: 'fly' },
    expect: `unknown verb "fly"; one of the verbs: ${VERB_NAMES.join(', ')}`,
  }, 'the guilty line names the verb that is unknown');

  // `pose` is a legal verb: the innocent lines must not be told it is unknown,
  // and must say which line stopped them.
  for (const i of [0, 2]) {
    assert.equal(r.dropped[i].expect, 'not run — step 2 uses an unknown verb');
    assert.deepEqual(r.dropped[i].value, mixed.run[i], 'the innocent line keeps its own value');
  }
  assert.equal(r.hadDrive, false);
});

test('the expectation is a phrase in the author\'s own field names', () => {
  // `steps` items say `duration_ms`; the verb says `ms`. The element a person
  // wrote is described in the words they used.
  assert.equal(
    expectationOf(MOVE.args?.properties?.steps?.items),
    'drive must be one of forward/backward, steer one of left/right/straight, duration_ms an integer >= 1',
  );
  // The verb's own schema, where `hold` is the second shape of the same field.
  assert.equal(
    expectationOf({ anyOf: [{ type: 'integer', minimum: 1 }, { const: 'hold' }] }),
    'must be an integer >= 1 or the word "hold"',
  );
});

test('a hand-edited schema that is not a schema is refused, not thrown', () => {
  const nullProperty = action({
    name: 'broken',
    args: /** @type {any} */ ({ type: 'object', properties: { a: null } }),
    run: [{ verb: 'halt' }],
  });
  assert.match(actionProblem(nullProperty, OPTS) ?? '', /arguments\.properties\.a.*not a schema/);

  const nullBranch = action({
    name: 'branchless',
    args: /** @type {any} */ ({ type: 'object', properties: { a: { anyOf: [null] } } }),
    run: [{ verb: 'halt' }],
  });
  assert.match(actionProblem(nullBranch, OPTS) ?? '', /arguments\.properties\.a\.anyOf\[0\]/);
});

test('a $each field the walked argument does not have is refused', () => {
  const typo = action({
    name: 'move',
    args: MOVE.args,
    run: [{
      verb: 'drive',
      each: 'steps',
      args: { drive: '$each.drive', steer: '$each.steer', ms: '$each.durration_ms' },
    }],
  });
  assert.match(actionProblem(typo, OPTS) ?? '', /durration_ms/);
});

test('a $each field declared by an anyOf item branch is accepted', () => {
  const creep = action({
    name: 'creep',
    args: {
      type: 'object',
      required: ['steps'],
      properties: {
        steps: {
          type: 'array',
          items: {
            anyOf: [{
              type: 'object',
              required: ['delay_ms'],
              properties: { delay_ms: { type: 'integer', minimum: 1 } },
            }],
          },
        },
      },
    },
    run: [{ verb: 'drive', each: 'steps', args: { drive: 'forward', steer: 'straight', ms: '$each.delay_ms' } }],
  });
  assert.equal(actionProblem(creep, OPTS), null, 'delay_ms is declared by the anyOf branch');
  assert.deepEqual(expand(creep, { steps: [{ delay_ms: 500 }] }).steps, [
    { verb: 'drive', args: { drive: 'forward', steer: 'straight', ms: 500 } },
  ], 'and it fills the verb it was written for');

  // An item schema with no readable record of fields cannot prove a typo, so
  // the check is skipped rather than guessing.
  const open = action({
    name: 'open',
    args: { type: 'object', properties: { steps: { type: 'array' } } },
    run: [{ verb: 'drive', each: 'steps', args: { drive: 'forward', steer: 'straight', ms: '$each.anything' } }],
  });
  assert.equal(actionProblem(open, OPTS), null);
});

test('a literal step is held to the verb schema before any call', () => {
  const sideways = action({
    name: 'drift',
    run: [{ verb: 'drive', args: { drive: 'sideways', steer: 'left', ms: 600 } }],
  });
  assert.match(actionProblem(sideways, OPTS) ?? '', /drive must be one of forward\/backward/);

  // The two shapes of `ms`: an integer from 1 up, or the word hold.
  const zero = action({ name: 'nudge', run: [{ verb: 'drive', args: { drive: 'forward', steer: 'left', ms: 0 } }] });
  assert.match(actionProblem(zero, OPTS) ?? '', /an integer >= 1 or the word "hold"/);

  const hold = action({ name: 'cruise', run: [{ verb: 'drive', args: { drive: 'forward', steer: 'left', ms: 'hold' } }] });
  assert.equal(actionProblem(hold, OPTS), null, 'a legal literal step is still quiet');
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
