import test from 'node:test';
import assert from 'node:assert/strict';
import { Reflex, fillState, criteriaOf, TIMEOUT_MS } from '../core/reflex.js';
import { REFLEX_PRESETS } from '../core/reflex-presets.js';
import { DEFAULT_STATE, normalizeReflex } from '../core/config.js';
import { validate } from '../core/brain.js';

/** @type {import('../core/config.js').ReflexCall[]} */
const LEFT = [{ name: 'move', args: { steps: [{ drive: 'forward', steer: 'left', duration_ms: 600 }] } }];
/** @type {import('../core/config.js').ReflexQuestion} */
const QUESTION = {
  name: 'action',
  instructions: 'Is it a move?',
  options: [
    { choice: 'left', description: 'Turn left.', actions: LEFT },
    { choice: 'pass', description: 'Anything else.', actions: [] },
    { choice: 'shrug', description: 'Configured with nothing.', actions: [] },
  ],
};
/** @type {import('../core/config.js').ReflexLayer} */
const CFG = { baseURL: 'http://studio:8888/v1', apiKey: 'sk-unsloth-x', model: 'jev-latest',
  threshold: 0.8, state: DEFAULT_STATE, question: QUESTION };

test('the timeout is the spec\'s', () => {
  assert.equal(TIMEOUT_MS, 1500);
});

test('fillState: both lines, or the robot\'s line dropped when it has said nothing', () => {
  assert.equal(fillState(DEFAULT_STATE, 'turn left', 'Okay!'), 'Robot said: "Okay!"\nPerson said: "turn left"');
  assert.equal(fillState(DEFAULT_STATE, 'turn left', ''), 'Person said: "turn left"');
  assert.equal(fillState('Robot said: 「{robot}」\nPerson said: 「{person}」', '忘忘', ''), 'Person said: 「忘忘」');
});

test('fillState: braces in what was said are left alone', () => {
  // Review focus 4: one pass over the template, so a transcript containing
  // "{robot}" is not substituted a second time.
  assert.equal(fillState(DEFAULT_STATE, 'say {robot}', 'I said {person}'),
    'Robot said: "I said {person}"\nPerson said: "say {robot}"');
});

test('criteriaOf: the options in order, as the decision API wants them', () => {
  assert.deepEqual(criteriaOf(QUESTION), { left: 'Turn left.', pass: 'Anything else.', shrug: 'Configured with nothing.' });
});

/** @param {any} body @param {number} [status] */
function answering(body, status = 200) {
  /** @type {any[]} */ const seen = [];
  const fetch = /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
    seen.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(body), { status });
  });
  return { seen, fetch };
}

/** @param {string} choice @param {number} p */
const answer = (choice, p) => ({ answers: { action: { type: 'choice', choice, confidence: p,
  probabilities: { left: 0, pass: 0, shrug: 0, [choice]: p } } } });

test('judge: the request carries the configured question, verbatim', async () => {
  const { seen, fetch } = answering(answer('left', 0.97));
  await new Reflex(CFG, { fetch }).judge('turn left', 'Okay!');
  assert.equal(seen[0].url, 'http://studio:8888/v1/systemone');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer sk-unsloth-x');
  assert.deepEqual(seen[0].body, {
    model: 'jev-latest',
    state: 'Robot said: "Okay!"\nPerson said: "turn left"',
    questions: { action: { type: 'choice', instructions: 'Is it a move?', criteria: criteriaOf(QUESTION) } },
  });
});

test('judge: a confident choice with actions fires, and hands back its calls', async () => {
  const { fetch } = answering(answer('left', 0.97));
  const v = await new Reflex(CFG, { fetch }).judge('turn left', '');
  assert.equal(v.verdict, 'fired');
  assert.equal(v.detail, 'left 0.97');
  assert.deepEqual(v.calls, [{ name: 'move', args: LEFT[0].args, rawArguments: JSON.stringify(LEFT[0].args) }]);
  assert.equal(validate(/** @type {any} */ (v.calls)).reasons.length, 0, 'the calls are validate()\'s input');
});

test('judge: exactly at the threshold fires, just below passes', async () => {
  assert.equal((await new Reflex(CFG, { fetch: answering(answer('left', 0.8)).fetch }).judge('l', '')).verdict, 'fired');
  assert.equal((await new Reflex(CFG, { fetch: answering(answer('left', 0.79)).fetch }).judge('l', '')).verdict, 'passed');
});

test('judge: pass, a choice with no actions, and a choice not configured all pass', async () => {
  for (const choice of ['pass', 'shrug', 'jump']) {
    const v = await new Reflex(CFG, { fetch: answering(answer(choice, 0.99)).fetch }).judge('x', '');
    assert.equal(v.verdict, 'passed', choice);
    assert.equal(v.detail, `${choice} 0.99`);
    assert.equal(v.calls, undefined);
  }
});

test('judge: with no probabilities, confidence is the number', async () => {
  // Review focus 3.
  const { fetch } = answering({ answers: { action: { type: 'choice', choice: 'left', confidence: 0.9 } } });
  assert.equal((await new Reflex(CFG, { fetch }).judge('l', '')).verdict, 'fired');
});

test('judge: the calls are copies, so a dispatch cannot edit the config', async () => {
  const { fetch } = answering(answer('left', 0.97));
  const v = await new Reflex(CFG, { fetch }).judge('l', '');
  /** @type {any} */ (v.calls)[0].args.steps[0].duration_ms = 1;
  assert.equal(/** @type {any} */ (QUESTION.options[0].actions[0].args).steps[0].duration_ms, 600);
});

test('judge: HTTP errors, bad shapes, throws and no question all fail quietly', async () => {
  for (const fetch of [
    answering({ error: 'no' }, 401).fetch,
    answering({ answers: {} }).fetch,
    answering({ answers: { action: { choice: 'left' } } }).fetch,
    async () => { throw new Error('offline'); },
  ]) {
    const v = await new Reflex(CFG, { fetch: /** @type {any} */ (fetch) }).judge('l', '');
    assert.equal(v.verdict, 'failed');
  }
  const off = await new Reflex({ ...CFG, question: null }, { fetch: answering(answer('left', 1)).fetch }).judge('l', '');
  assert.equal(off.verdict, 'failed');
});

test('judge: a slow answer times out as failed', async () => {
  const fetch = (/** @type {string} */ _u, /** @type {any} */ init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
  const v = await new Reflex(CFG, { fetch: /** @type {any} */ (fetch), timeoutMs: 10 }).judge('l', '');
  assert.equal(v.verdict, 'failed');
  assert.match(v.detail, /timeout/i);
});

test('judge: the caller cancelling aborts the request too', async () => {
  /** @type {any} */ let got = null;
  const fetch = (/** @type {string} */ _u, /** @type {any} */ init) => new Promise((_, reject) => {
    got = init.signal;
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
  const ctrl = new AbortController();
  const pending = new Reflex(CFG, { fetch: /** @type {any} */ (fetch) }).judge('l', '', ctrl.signal);
  ctrl.abort();
  const v = await pending;
  assert.equal(v.verdict, 'failed');
  assert.equal(got.aborted, true);
});

test('judge never rejects, even where AbortSignal.any does not exist', async () => {
  // Found in review: an older WebView without AbortSignal.any (Chrome < 116)
  // threw before the try, judge() rejected, and every short transcript failed
  // its whole turn instead of falling through to the LLM.
  const any = AbortSignal.any;
  // @ts-ignore — simulating an older engine
  AbortSignal.any = undefined;
  try {
    const v = await new Reflex(CFG, { fetch: answering(answer('left', 0.9)).fetch }).judge('l', '', new AbortController().signal);
    assert.equal(v.verdict, 'failed');
  } finally {
    AbortSignal.any = any;
  }
});

// --- Presets (spec §2.5) ---------------------------------------------------

test('presets: two of them, each already in the shape loadConfig keeps', () => {
  assert.deepEqual(REFLEX_PRESETS.map((p) => p.id), ['bark', 'commands']);
  for (const p of REFLEX_PRESETS) {
    const n = normalizeReflex({ threshold: p.threshold, state: p.state, question: p.question });
    assert.deepEqual(n.question, p.question, p.id);
    assert.equal(n.state, p.state, p.id);
    assert.equal(n.threshold, p.threshold, p.id);
  }
});

test('presets: every configured action passes validate() untouched', () => {
  for (const p of REFLEX_PRESETS) {
    for (const o of p.question.options) {
      const calls = o.actions.map((a) => ({ ...a, rawArguments: JSON.stringify(a.args) }));
      const { actions, reasons } = validate(/** @type {any} */ (calls));
      assert.deepEqual(reasons, [], `${p.id}/${o.choice}`);
      assert.equal(actions.length, o.actions.length, `${p.id}/${o.choice}`);
    }
  }
});

test('bark preset: the instructions keep the rule that protects real replies', () => {
  // Measured 2026-09-28: 0 false fires with these lines. Editing them
  // re-opens that (reflex spec, review focus 1).
  const bark = REFLEX_PRESETS[0];
  assert.match(bark.question.instructions, /makes no\s+sense as an answer to what the robot said/);
  assert.match(bark.question.instructions, /明白, 好的, 嗯嗯, 对对, 哈哈/);
  assert.equal(bark.state, 'Robot said: 「{robot}」\nPerson said: 「{person}」');
  assert.deepEqual(bark.question.options.find((o) => o.choice === 'tease')?.actions,
    [{ name: 'play_sound', args: { name: 'bark' } }]);
});

test('commands preset: the training question, word for word, and pass hands over', () => {
  const c = REFLEX_PRESETS[1];
  assert.equal(c.question.name, 'action');
  assert.equal(c.state, DEFAULT_STATE);
  assert.deepEqual(c.question.options.map((o) => o.choice),
    ['stop', 'forward', 'backward', 'left', 'right', 'keep_going', 'pass']);
  assert.match(c.question.instructions, /^A person is talking to a small wheeled robot\. /);
  assert.match(c.question.instructions, /and words meant for someone else, is pass\.$/);
  assert.deepEqual(c.question.options.find((o) => o.choice === 'pass')?.actions, []);
});
