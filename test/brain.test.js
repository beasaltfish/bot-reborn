import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, SYSTEM_PROMPT, buildSystemPrompt, validate, Brain } from '../web/brain.js';
import { MIN_DURATION_MS } from '../web/executor.js';
import { KEYWORDS } from '../web/strings.js';

/** @param {string} name @returns {any} */
const byName = (name) => TOOLS.find((t) => t.function.name === name);

test('there are exactly the five tools: spec §6.2 plus play_sound', () => {
  assert.deepEqual(TOOLS.map((t) => t.function.name).sort(),
    ['cruise', 'move', 'play_sound', 'set_reply_language', 'stop']);
});

test('play_sound offers exactly the four sounds', () => {
  assert.deepEqual(byName('play_sound').function.parameters.properties.name.enum,
    ['bark', 'yip', 'whimper', 'growl']);
});

test('move: steps maxItems 5, duration_ms has a minimum and NO maximum (spec §6.6)', () => {
  const params = byName('move').function.parameters;
  assert.deepEqual(params.required, ['steps']);
  assert.equal(params.properties.steps.maxItems, 5);

  const step = params.properties.steps.items;
  assert.deepEqual(step.required.sort(), ['drive', 'duration_ms', 'steer']);
  assert.deepEqual(step.properties.drive.enum, ['forward', 'backward']);
  assert.deepEqual(step.properties.steer.enum, ['left', 'right', 'straight']);
  assert.equal(step.properties.duration_ms.minimum, MIN_DURATION_MS);
  assert.equal(step.properties.duration_ms.maximum, undefined,
    'spec §6.6 removed the upper bound; safety comes from slicing, not from a cap');
});

test('drive has no "none" anywhere (spec §3.3)', () => {
  for (const name of ['move', 'cruise']) {
    const props = byName(name).function.parameters.properties;
    const drive = name === 'move' ? props.steps.items.properties.drive : props.drive;
    assert.ok(!drive.enum.includes('none'));
  }
});

test('set_reply_language: three values, including the auto escape hatch', () => {
  assert.deepEqual(byName('set_reply_language').function.parameters.properties.lang.enum,
    ['zh', 'en', 'auto']);
});

test('every tool description is written in English (spec §6.2)', () => {
  for (const tool of TOOLS) {
    assert.ok(!/[一-鿿]/.test(JSON.stringify(tool)),
      `tool ${tool.function.name} contains CJK text`);
  }
});

test('the prompt makes the robot the subject, not a car it drives', () => {
  // Reported from the real car: the model kept calling itself 小车 ("the little
  // car"). The only place it can learn what it is, is this prompt and these
  // four tool descriptions — and every one of them used to say "the car",
  // with the model cast as something that operates one. The product's whole
  // shell (docs/ui.md) is a creature with a face, and the wheels are its body.
  // "Robot" was the next wrong answer: a robot is still a machine, and a
  // machine does not get teased or run off. It is cast as alive.
  assert.match(SYSTEM_PROMPT, /You are a small living creature/);
  assert.match(SYSTEM_PROMPT, /You are not a robot, a car, or a machine/);
  assert.match(SYSTEM_PROMPT, /Never call yourself a car/);
  for (const tool of TOOLS) {
    assert.ok(!/\bcars?\b/i.test(tool.function.description),
      `tool ${tool.function.name} still calls it a car`);
  }
});

test('the prompt lets chat end in a movement, but only one that stops itself', () => {
  // Barked at twice, a creature runs off. The old "chatting: do not call a
  // tool" forbade exactly that. The bound that replaces it is not a length
  // (the model picks the durations) but an end: cruise runs until someone
  // says stop, and nobody asked it to move.
  assert.doesNotMatch(SYSTEM_PROMPT, /Do not call a tool/);
  assert.match(SYSTEM_PROMPT, /react with your body/);
  assert.match(SYSTEM_PROMPT, /never use `cruise` for one/);
});

test('the prompt asks for a changed reaction when the user repeats themselves', () => {
  // A few-shot script would be copied verbatim — bark, bark back, forever.
  // The example is phrased as "might", and the rule is to escalate or vary.
  assert.match(SYSTEM_PROMPT, /do not repeat your reaction/);
});

test('the system prompt states that calling a tool cannot be substituted for', () => {
  // Spec §6.8: since §6.3 stopped discarding `content`, this clause is the ONLY
  // defence against "sure, going forward now" with no tool call. It must be
  // phrased as subordination, not as a ban on talking.
  assert.match(SYSTEM_PROMPT, /MUST call a tool/);
  assert.match(SYSTEM_PROMPT, /does not substitute for calling it/);
});

test('the system prompt disarms its own language bias (spec §6.8)', () => {
  assert.match(SYSTEM_PROMPT, /same language the user spoke/);
  assert.match(SYSTEM_PROMPT, /written in\s+English; that is not a reason to answer in English/);
});

test('the system prompt forbids inventing a long duration instead of cruising', () => {
  assert.match(SYSTEM_PROMPT, /never invent a long duration/i);
});

test('buildSystemPrompt: replyLang null injects nothing', () => {
  assert.equal(buildSystemPrompt({ replyLang: null, bargeIn: true }), SYSTEM_PROMPT);
});

test('buildSystemPrompt: a recorded preference is injected', () => {
  const p = buildSystemPrompt({ replyLang: 'zh', bargeIn: true });
  assert.match(p, /Always reply in Chinese, regardless of which language the user speaks\./);
});

test('buildSystemPrompt: bargeIn false forbids the emergency keyword only', () => {
  const p = buildSystemPrompt({ replyLang: null, bargeIn: false });
  assert.match(p, /Never say the words "all stop"/);
  // The wake word is a coined name the robot cannot produce, so it is NOT
  // forbidden — forbidding it would cost naturalness for nothing (spec §6.8).
  assert.ok(!p.includes('steven'));
});

test('buildSystemPrompt: bargeIn true injects no forbidden words at all', () => {
  assert.ok(!buildSystemPrompt({ replyLang: null, bargeIn: true }).includes('Never say'));
});

test('the prompt itself contains no keyword', () => {
  for (const keyword of KEYWORDS) {
    assert.ok(!SYSTEM_PROMPT.toLowerCase().includes(keyword));
  }
});

/** @param {string} name @param {any} args @param {string} [id] */
const call = (name, args, id = 'call_1') =>
  ({ id, name, args, rawArguments: JSON.stringify(args) });

test('validate: a well-formed move passes through untouched', () => {
  const r = validate([call('move', { steps: [{ drive: 'forward', steer: 'left', duration_ms: 600 }] })]);
  assert.deepEqual(r.actions, [{ kind: 'move', steps: [{ drive: 'forward', steer: 'left', duration_ms: 600 }] }]);
  assert.equal(r.dropped, 0);
});

test('validate: a huge duration is NOT clamped (spec §6.6)', () => {
  // Clamping fails silently in the worst direction: the car moves, but by an
  // amount you did not ask for and cannot see. Safety is the slicing loop's job.
  const r = validate([call('move', { steps: [{ drive: 'forward', steer: 'straight', duration_ms: 60000 }] })]);
  const a0 = /** @type {any} */ (r.actions[0]);
  assert.equal(a0.steps[0].duration_ms, 60000);
  assert.equal(r.dropped, 0);
});

test('a move with no steps array is a drop, and says so', () => {
  // The shape a smaller model produces most often: it flattens the schema and
  // sends the step's fields at the top level. `raw` came out empty, the loop
  // never ran, and the turn was counted as ZERO drops — so the one number that
  // could have said "it tried and I refused" said nothing happened at all.
  const r = validate([call('move', { drive: 'forward', steer: 'straight', duration_ms: 600 })]);
  assert.deepEqual(r.actions, []);
  assert.ok(r.hadMoveIntent, 'it was still a move');
  assert.equal(r.dropped, 1);
  assert.match(r.reasons.join('\n'), /steps/);
});

test('every drop carries a reason, because a silent drop cannot be debugged', () => {
  // Reported from the real car: "it reads the parameters out loud and then
  // does not move". Every path below produces exactly that — the sentence is
  // spoken, the action is not dispatched — and until now they were
  // indistinguishable from each other and from the model never calling a tool
  // at all.
  const tooShort = validate([call('move', { steps: [
    { drive: 'forward', steer: 'straight', duration_ms: 100 },
  ] })]);
  assert.match(tooShort.reasons.join('\n'), /duration_ms/);

  const badEnum = validate([call('cruise', { drive: 'sideways', steer: 'straight' })]);
  assert.match(badEnum.reasons.join('\n'), /cruise/);

  const unparsable = validate([
    { id: 'c1', name: 'move', args: null, rawArguments: '{"steps": [' },
  ]);
  assert.match(unparsable.reasons.join('\n'), /JSON/i);

  const unknown = validate([call('fly', {})]);
  assert.match(unknown.reasons.join('\n'), /fly/);
});

test('validate rule 1: a duration below the floor drops the step', () => {
  const r = validate([call('move', { steps: [
    { drive: 'forward', steer: 'straight', duration_ms: 100 },
    { drive: 'forward', steer: 'straight', duration_ms: 600 },
  ] })]);
  const a0 = /** @type {any} */ (r.actions[0]);
  assert.equal(a0.steps.length, 1);
  assert.equal(a0.steps[0].duration_ms, 600);
  assert.equal(r.dropped, 1);
});

test('validate rule 1: a non-integer duration drops the step', () => {
  const r = validate([call('move', { steps: [{ drive: 'forward', steer: 'straight', duration_ms: 600.5 }] })]);
  assert.deepEqual(r.actions, []);
  assert.equal(r.dropped, 1);
});

test('validate rule 2: an unknown enum value drops the step', () => {
  const r = validate([call('move', { steps: [
    { drive: 'sideways', steer: 'straight', duration_ms: 600 },
    { drive: 'forward', steer: 'diagonally', duration_ms: 600 },
    { drive: 'forward', steer: 'straight', duration_ms: 600 },
  ] })]);
  const a0 = /** @type {any} */ (r.actions[0]);
  assert.equal(a0.steps.length, 1);
  assert.equal(r.dropped, 2);
});

test('validate rule 2: drive "none" is rejected (spec §3.3)', () => {
  const r = validate([call('move', { steps: [{ drive: 'none', steer: 'left', duration_ms: 600 }] })]);
  assert.deepEqual(r.actions, []);
});

test('validate rule 3: more than five steps are truncated, not rejected', () => {
  const steps = Array.from({ length: 8 }, () => ({ drive: 'forward', steer: 'straight', duration_ms: 400 }));
  const r = validate([call('move', { steps })]);
  assert.equal(/** @type {any} */ (r.actions[0]).steps.length, 5);
});

test('validate rule 4: when every step dies, nothing is dispatched', () => {
  const r = validate([call('move', { steps: [{ drive: 'up', steer: 'straight', duration_ms: 10 }] })]);
  assert.deepEqual(r.actions, []);
  assert.equal(r.hadMoveIntent, true, 'the caller needs to know a move was attempted');
});

test('validate: unparsable arguments drop the whole call', () => {
  const r = validate([{ id: 'call_1', name: 'move', args: null, rawArguments: '{"steps":[' }]);
  assert.deepEqual(r.actions, []);
  assert.equal(r.hadMoveIntent, true);
});

test('validate: cruise and stop', () => {
  assert.deepEqual(validate([call('cruise', { drive: 'forward', steer: 'straight' })]).actions,
    [{ kind: 'cruise', drive: 'forward', steer: 'straight' }]);
  assert.deepEqual(validate([call('stop', {})]).actions, [{ kind: 'stop' }]);
  assert.deepEqual(validate([call('cruise', { drive: 'up', steer: 'straight' })]).actions, []);
});

test('validate rule 5: set_reply_language never becomes an action (spec §6.2)', () => {
  const r = validate([call('set_reply_language', { lang: 'en' })]);
  assert.deepEqual(r.actions, [], 'it writes config, it does not drive the car');
  assert.equal(r.replyLang, 'en');
});

test('validate rule 5: an unknown lang is ignored, config untouched', () => {
  const r = validate([call('set_reply_language', { lang: 'fr' })]);
  assert.equal(r.replyLang, null);
});

test('validate: an unknown tool name is dropped', () => {
  assert.deepEqual(validate([call('launch_missiles', {})]).actions, []);
});

test('validate: play_sound with a known name becomes a sound action', () => {
  const r = validate([{ id: 'a', name: 'play_sound', args: { name: 'bark' }, rawArguments: '' }]);
  assert.deepEqual(r.actions, [{ kind: 'sound', name: 'bark' }]);
  assert.equal(r.hadMoveIntent, false);
});

test('validate: play_sound with an unknown name is dropped, with a reason', () => {
  const r = validate([{ id: 'a', name: 'play_sound', args: { name: 'moo' }, rawArguments: '' }]);
  assert.deepEqual(r.actions, []);
  assert.match(r.reasons[0], /play_sound: rejected.*moo/);
});

/**
 * A promise this test controls the settling of, so a test can prove
 * "X happened before the motion finished" instead of just "X happened before
 * Y in this array" — event order alone cannot distinguish an awaited
 * #dispatch from a fire-and-forget one when the fake resolves instantly
 * either way (see the review note on the test this exists for).
 * @returns {{ promise: Promise<void>, resolve: (value?: any) => void }}
 */
function deferred() {
  /** @type {(value?: any) => void} */
  let resolve = () => {};
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

/** @param {{ connected?: boolean, reply?: any, gateMotion?: boolean, reflex?: any, ladder?: any }} [opts] */
function brainHarness({ connected = true, reply, gateMotion = false, reflex = null, ladder = undefined } = {}) {
  /** @type {any[]} */
  const events = [];
  // Only populated when gateMotion is true. Every move/cruise call then gets
  // its OWN gate, pushed here in call order, so a test can hold a motion open
  // and observe what happened while it was still running. Nothing resolves a
  // gate automatically — the test that asks for this is responsible for
  // calling .resolve() itself. gateMotion defaults to false, and every other
  // test's move/cruise still resolves on the next microtask exactly as
  // before — this is opt-in precisely so it cannot change what an unrelated
  // test observes (see the review note that added it).
  /** @type {Array<{ promise: Promise<void>, resolve: (value?: any) => void }>} */
  const motionGates = [];
  const executor = {
    connected,
    /** @param {any} steps */
    async move(steps) {
      events.push({ op: 'move', steps });
      if (!gateMotion) return;
      const gate = deferred();
      motionGates.push(gate);
      await gate.promise;
    },
    /** @param {any} drive @param {any} steer */
    async cruise(drive, steer) {
      events.push({ op: 'cruise', drive, steer });
      if (!gateMotion) return;
      const gate = deferred();
      motionGates.push(gate);
      await gate.promise;
    },
    stop() { events.push({ op: 'stop' }); return Promise.resolve(); },
  };
  const llm = {
    /** @type {any[]} */
    calls: [],
    /** @param {any} messages @param {any} tools @param {any} _opts */
    async chat(messages, tools, _opts) {
      this.calls.push({ messages: structuredClone(messages), tools });
      const r = typeof reply === 'function' ? reply(this.calls.length) : reply;
      if (r instanceof Error) throw r;
      return r;
    },
  };
  const tts = {
    /** @param {any} text @param {any} _opts */
    async speak(text, _opts) { events.push({ op: 'speak', text }); },
  };
  const earcon = (/** @type {any} */ name) => events.push({ op: 'earcon', name });
  const sound = async (/** @type {any} */ name) => { events.push({ op: 'sound', name }); };
  /** @type {{ lang: 'en' | 'zh', replyLang: 'en' | 'zh' | null, bargeIn: boolean }} */
  const config = { lang: 'zh', replyLang: null, bargeIn: true };
  /** @type {Array<'en' | 'zh' | null>} */
  const langChanges = [];
  /** @type {Array<[string, string]>} */
  const faults = [];
  /** @type {string[]} */
  const traced = [];
  return { events, executor, llm, tts, config, motionGates, langChanges, faults, traced,
    brain: new Brain({
      llm, executor, tts, earcon, sound, config, reflex, ladder,
      onReplyLangChange: (lang) => langChanges.push(lang),
      onFault: (part, err) => faults.push([part, err.message]),
      trace: (line) => traced.push(line),
    }) };
}

/** Make the fake TTS reject, the way a 401 or a timeout does. */
const breakVoice = (/** @type {any} */ h, /** @type {string} */ why) => {
  h.tts.speak = async () => { throw new Error(why); };
};

/** @param {any} content @param {any[]} [tool_calls] */
const say = (content, tool_calls) => ({
  text: content ?? '',
  toolCalls: (tool_calls ?? []).map((c) => ({ ...c, rawArguments: JSON.stringify(c.args) })),
  rawMessage: { role: 'assistant', content, ...(tool_calls ? { tool_calls: tool_calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}) },
});

test('a turn that narrates the move instead of calling it leaves a trace', async () => {
  // The reported symptom, written down: the model says the parameters out loud
  // and calls nothing. On screen this is indistinguishable from an ordinary
  // chat reply — no error earcon fires, because nothing was refused — and the
  // car is equally silent about it. The trace is the only place the difference
  // exists, so it is the only place that can be tested.
  const h = brainHarness({ reply: say('Going forward for 600 milliseconds.') });
  await h.brain.handle('往前走');

  assert.deepEqual(h.events.filter((e) => e.op === 'move'), [], 'it did not move');
  assert.match(h.traced.join('\n'), /calls \[\]/,
    'the trace must say the model called nothing');
});

test('a refused call is traced with the field that was refused', async () => {
  const h = brainHarness({ reply: say('Just a nudge.', [
    { id: 'c1', name: 'move', args: { steps: [{ drive: 'forward', steer: 'straight', duration_ms: 50 }] } },
  ]) });
  await h.brain.handle('往前走一点点');

  assert.deepEqual(h.events.filter((e) => e.op === 'move'), []);
  assert.match(h.traced.join('\n'), /dropped — move: step rejected.*duration_ms/s);
});

test('handle: USB not connected is intercepted BEFORE the LLM (spec §6.5)', async () => {
  const h = brainHarness({ connected: false, reply: say('should never happen') });
  await h.brain.handle('往前走');
  assert.equal(h.llm.calls.length, 0, 'the LLM must not be called at all');
  assert.deepEqual(h.events, [
    { op: 'earcon', name: 'error' },
    { op: 'speak', text: '小车还没连上。' },
  ]);
});

test('handle: the fixed line follows `lang`, not the conversation (spec §11.1)', async () => {
  const h = brainHarness({ connected: false, reply: say('x') });
  h.config.lang = 'en';
  await h.brain.handle('go forward');
  assert.equal(h.events[1].text, 'The car is not plugged in yet.');
});

test('handle: pure chat speaks and drives nothing', async () => {
  const h = brainHarness({ reply: say('北京是中国的首都。') });
  await h.brain.handle('中国的首都是哪');
  assert.deepEqual(h.events, [{ op: 'speak', text: '北京是中国的首都。' }]);
});

test('handle: a sound-only reply plays it and does not beep done', async () => {
  // done means "an instruction for the car ran"; a bark is its own answer.
  const h = brainHarness({ reply: say('', [{ id: 's1', name: 'play_sound', args: { name: 'yip' } }]) });
  await h.brain.handle('好乖');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(h.events, [{ op: 'sound', name: 'yip' }]);
});

test('handle: a sound then a move run in order, and done still beeps for the move', async () => {
  const steps = [{ drive: 'backward', steer: 'left', duration_ms: 600 }];
  const h = brainHarness({ reply: say('', [
    { id: 's1', name: 'play_sound', args: { name: 'bark' } },
    { id: 'm1', name: 'move', args: { steps } },
  ]) });
  await h.brain.handle('汪汪');
  await new Promise((r) => setTimeout(r, 0));
  // #dispatch's loop runs synchronously up to its first await, so the sound
  // starts before handle() reaches the done beep; the move waits for the sound.
  assert.deepEqual(h.events, [
    { op: 'sound', name: 'bark' },
    { op: 'earcon', name: 'done' },
    { op: 'move', steps },
  ]);
});

test('handle: a move dispatches, beeps, and does NOT wait for the car to finish', async () => {
  // A pure event-order assertion cannot tell an awaited #dispatch from a
  // fire-and-forget one when the fake executor resolves on the very next
  // microtask regardless — the order comes out the same either way. This test
  // instead holds the motion open (via an unresolved gate) and checks that
  // handle() returns, and that 'done' and the spoken reply have already
  // landed, WHILE that gate is still pending. That is the one thing an
  // awaited #dispatch cannot produce: it would block handle() on the gate,
  // which nothing here ever resolves until after the assertions below.
  const h = brainHarness({ gateMotion: true, reply: say('挪一下，好嘞。', [
    { id: 'c1', name: 'move', args: { steps: [{ drive: 'forward', steer: 'straight', duration_ms: 600 }] } },
  ]) });

  const handlePromise = h.brain.handle('往前走');

  // Race handle() against a short real timer instead of awaiting it directly:
  // if #dispatch awaits the motion, handle() cannot resolve before the gate
  // does, and the gate is only resolved further down — so this race would
  // time out and fail here, cleanly, instead of hanging the suite.
  const winner = await Promise.race([
    handlePromise.then(() => 'handle'),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 100)),
  ]);
  assert.equal(winner, 'handle',
    'handle() must return without waiting for the car to finish moving (spec §6.3, §6.6)');

  assert.equal(h.motionGates.length, 1, 'the fake executor.move must have been invoked exactly once');

  // Confirm, directly, that the gate really is still pending at this point —
  // not merely that handle() happened to return first.
  const stillPending = await Promise.race([
    h.motionGates[0].promise.then(() => false),
    Promise.resolve(true),
  ]);
  assert.equal(stillPending, true, 'the motion must still be running when done/speak fire');

  assert.deepEqual(h.events, [
    { op: 'move', steps: [{ drive: 'forward', steer: 'straight', duration_ms: 600 }] },
    { op: 'earcon', name: 'done' },
    { op: 'speak', text: '挪一下，好嘞。' },
  ]);

  // Let the motion "finish" now, and confirm that doesn't break anything.
  h.motionGates[0].resolve();
  await handlePromise;
});

/** Let a fire-and-forget dispatch chain run to its next await. */
const flushMicrotasks = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('handle: a turn with move AND stop dispatches the stop and nothing else (spec §4.4)', async () => {
  // Providers do emit parallel tool calls, whatever spec §6.2 prefers. The
  // dispatch loop used to start every action without awaiting the previous
  // one, and executor.move() runs synchronously all the way to transferOut, so
  // this turn put a full second of forward bytes on the bus BEFORE the purge —
  // the car drove for a second on a turn that contained "stop".
  const h = brainHarness({ gateMotion: true, reply: say('好，那就不动了。', [
    { id: 'c1', name: 'move', args: { steps: [{ drive: 'forward', steer: 'straight', duration_ms: 5000 }] } },
    { id: 'c2', name: 'stop', args: {} },
  ]) });

  await h.brain.handle('往前开 —— 算了，别动');
  await flushMicrotasks();

  assert.deepEqual(h.events.filter((e) => e.op !== 'earcon' && e.op !== 'speak'),
    [{ op: 'stop' }], 'the stop must be the ONLY thing dispatched');
  assert.equal(h.motionGates.length, 0, 'no motion may be started at all');
});

test('handle: actions run one at a time, so the second cannot outrun the first', async () => {
  // Sequencing is what makes the stop above reach the wire first; it has to
  // hold for the general case too, or the ordering guarantee is accidental.
  const h = brainHarness({ gateMotion: true, reply: say(null, [
    { id: 'c1', name: 'move', args: { steps: [{ drive: 'forward', steer: 'straight', duration_ms: 600 }] } },
    { id: 'c2', name: 'cruise', args: { drive: 'forward', steer: 'straight' } },
  ]) });

  await h.brain.handle('往前挪一下，然后一直开');
  await flushMicrotasks();
  assert.equal(h.motionGates.length, 1,
    'the cruise must not start while the move is still running');
  assert.deepEqual(h.events.filter((e) => e.op === 'cruise'), []);

  h.motionGates[0].resolve();
  await flushMicrotasks();
  assert.deepEqual(h.events.filter((e) => e.op === 'cruise'),
    [{ op: 'cruise', drive: 'forward', steer: 'straight' }]);
});

test('handle: a cruise ends its turn — what follows is dropped, not deferred', async () => {
  // executor.cruise() has no end condition of its own: it resolves only when
  // something else bumps the generation. So an action awaited behind it is not
  // merely delayed — it runs inside a LATER turn and preempts whatever is live
  // then. Gating the cruise here and resolving it by hand is what that
  // generation bump looks like from in here; the move must still never run.
  // The default fake cruise returns immediately, which is exactly why this
  // hole was invisible until the fake could hang (spec §6.2).
  const h = brainHarness({ gateMotion: true, reply: say(null, [
    { id: 'c1', name: 'cruise', args: { drive: 'forward', steer: 'straight' } },
    { id: 'c2', name: 'move', args: { steps: [{ drive: 'forward', steer: 'left', duration_ms: 600 }] } },
  ]) });

  await h.brain.handle('一直往前开，然后往左挪一下');
  await flushMicrotasks();
  assert.deepEqual(h.events.filter((e) => e.op === 'cruise'),
    [{ op: 'cruise', drive: 'forward', steer: 'straight' }]);
  assert.deepEqual(h.events.filter((e) => e.op === 'move'), []);

  h.motionGates[0].resolve();
  await flushMicrotasks();
  assert.deepEqual(h.events.filter((e) => e.op === 'move'), [],
    'the move behind the cruise must be dropped, not deferred into a later turn');
});

test('handle: a stop anywhere in the turn is the whole turn, even last (spec §6.2)', async () => {
  // Not just [move, stop]: [stop, move] is dropped too. Run in order that one
  // is safe by itself, but it is the same shape as "the user said stop and the
  // model appended a move", and that one must not reach the wire.
  const h = brainHarness({ reply: say(null, [
    { id: 'c1', name: 'stop', args: {} },
    { id: 'c2', name: 'move', args: { steps: [{ drive: 'forward', steer: 'straight', duration_ms: 600 }] } },
  ]) });

  await h.brain.handle('停下，然后往前挪一点');
  await flushMicrotasks();
  assert.deepEqual(h.events.filter((e) => e.op === 'stop' || e.op === 'move'),
    [{ op: 'stop' }]);
});

test('handle: content AND tool_calls both happen, action first (spec §6.3)', async () => {
  const h = brainHarness({ reply: say('好，我往前开两秒，然后给你讲个笑话。', [
    { id: 'c1', name: 'move', args: { steps: [{ drive: 'forward', steer: 'straight', duration_ms: 2000 }] } },
  ]) });
  await h.brain.handle('往前开两秒，顺便讲个笑话');
  assert.deepEqual(h.events.map((e) => e.op), ['move', 'earcon', 'speak']);
});

test('handle: every step dropped means an error earcon and no dispatch (rule 4)', async () => {
  const h = brainHarness({ reply: say(null, [
    { id: 'c1', name: 'move', args: { steps: [{ drive: 'up', steer: 'straight', duration_ms: 5 }] } },
  ]) });
  await h.brain.handle('往上飞');
  assert.deepEqual(h.events, [{ op: 'earcon', name: 'error' }]);
});

test('handle: set_reply_language writes config and does not touch the car', async () => {
  const h = brainHarness({ reply: say('好的，以后我说英文。', [
    { id: 'c1', name: 'set_reply_language', args: { lang: 'en' } },
  ]) });
  await h.brain.handle('以后都说英文');
  assert.equal(h.config.replyLang, 'en');
  assert.deepEqual(h.events, [{ op: 'speak', text: '好的，以后我说英文。' }]);
});

test('handle: set_reply_language "auto" clears the preference (spec §11.1)', async () => {
  const h = brainHarness({ reply: say(null, [{ id: 'c1', name: 'set_reply_language', args: { lang: 'auto' } }]) });
  h.config.replyLang = 'en';
  await h.brain.handle('跟着我说的语言就行');
  assert.equal(h.config.replyLang, null, 'auto means "no recorded preference", i.e. null');
});

test('handle: the recorded preference reaches the NEXT system prompt', async () => {
  const h = brainHarness({ reply: (/** @type {number} */ n) => n === 1
    ? say(null, [{ id: 'c1', name: 'set_reply_language', args: { lang: 'zh' } }])
    : say('好的。') });
  await h.brain.handle('以后都说中文');
  await h.brain.handle('你好');
  assert.match(h.llm.calls[1].messages[0].content, /Always reply in Chinese/);
  assert.ok(!/Always reply in/.test(h.llm.calls[0].messages[0].content));
});

test('history: native tool_calls and a paired tool message are kept (spec §6.4)', async () => {
  const h = brainHarness({ reply: say(null, [
    { id: 'c1', name: 'move', args: { steps: [{ drive: 'forward', steer: 'straight', duration_ms: 600 }] } },
  ]) });
  await h.brain.handle('往前走');

  const history = /** @type {any[]} */ (h.brain.history);
  const assistant = history.find((m) => m.role === 'assistant');
  assert.ok(assistant.tool_calls, 'the assistant message must keep its native tool_calls');
  const toolMsg = history.find((m) => m.role === 'tool');
  assert.equal(toolMsg.tool_call_id, 'c1');
  assert.ok(typeof toolMsg.content === 'string' && toolMsg.content.length > 0,
    'the API requires the tool message to exist and carry content');
});

test('history: EVERY tool call gets a paired tool message, dropped ones included', async () => {
  // Missing pairs are a hard API error on the *next* turn, so a dropped call
  // still has to be answered.
  const h = brainHarness({ reply: say(null, [
    { id: 'c1', name: 'move', args: { steps: [{ drive: 'up', steer: 'straight', duration_ms: 5 }] } },
    { id: 'c2', name: 'launch_missiles', args: {} },
  ]) });
  await h.brain.handle('乱说');
  const toolIds = /** @type {any[]} */ (h.brain.history).filter((m) => m.role === 'tool').map((m) => m.tool_call_id);
  assert.deepEqual(toolIds, ['c1', 'c2']);
});

test('history: keeps the last 6 rounds', async () => {
  const h = brainHarness({ reply: say('ok') });
  for (let i = 0; i < 10; i++) await h.brain.handle(`第 ${i} 句`);
  const users = /** @type {any[]} */ (h.brain.history).filter((m) => m.role === 'user');
  assert.equal(users.length, 6);
  assert.equal(users[0].content, '第 4 句');
});

test('resetHistory(): clears it (called when the session times out, spec §6.4)', async () => {
  const h = brainHarness({ reply: say('ok') });
  await h.brain.handle('你好');
  h.brain.resetHistory();
  assert.deepEqual(h.brain.history, []);
});

test('the system prompt is rebuilt each turn and is not stored in history', async () => {
  const h = brainHarness({ reply: say('ok') });
  await h.brain.handle('你好');
  assert.ok(!(/** @type {any[]} */ (h.brain.history)).some((m) => m.role === 'system'));
  assert.equal(h.llm.calls[0].messages[0].role, 'system');
});

test('handle: an API failure gives the low double beep and a fixed line (spec §6.7)', async () => {
  const h = brainHarness({ reply: new Error('network down') });
  await h.brain.handle('你好');
  assert.deepEqual(h.events, [
    { op: 'earcon', name: 'error' },
    { op: 'speak', text: '连不上服务器。' },
  ]);
});

test('handle: an empty transcript never reaches the LLM (spec §6.7)', async () => {
  const h = brainHarness({ reply: say('x') });
  await h.brain.handle('   ');
  assert.equal(h.llm.calls.length, 0);
  assert.deepEqual(h.events, [{ op: 'earcon', name: 'huh' }]);
});

test('cancel(): an aborted turn ends silently, not as a failure (spec §8.1)', async () => {
  // Two things at once, and they are the same thing: the LLM call has to
  // receive a signal at all (without it §4.5's third use of the generation
  // counter can only IGNORE a stale reply, never stop it), and the abort must
  // not fall into the catch below — that one treats every throw as an API
  // failure, so changing your mind would be answered with an error earcon and
  // "接口失败" read aloud.
  const h = brainHarness({ reply: say('too late') });
  /** @param {any} messages @param {any} tools @param {any} opts */
  h.llm.chat = (messages, tools, opts) => new Promise((_, reject) => {
    opts.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });

  const turn = h.brain.handle('往前走');
  h.brain.cancel();
  await turn;

  assert.deepEqual(h.events, []);
});

test('cancel(): the reply already being spoken is cut off too', async () => {
  // Barge-in (§5.3) and the stop button both land mid-reply, and the symptom
  // the user actually notices is the robot still talking. WebAudioTts resolves
  // rather than throws when its signal fires, so the turn just ends.
  const h = brainHarness({ reply: say('一段很长的回答') });
  /** @param {any} text @param {any} opts */
  h.tts.speak = (text, opts) => new Promise(/** @param {any} resolve */ (resolve) => {
    h.events.push({ op: 'speak', text });
    opts?.signal?.addEventListener('abort', () => resolve());
  });

  const turn = h.brain.handle('说点什么');
  await flushMicrotasks();
  assert.deepEqual(h.events, [{ op: 'speak', text: '一段很长的回答' }]);

  h.brain.cancel();
  const outcome = await Promise.race([
    turn.then(() => 'finished'),
    new Promise((r) => setTimeout(() => r('still speaking'), 50)),
  ]);
  assert.equal(outcome, 'finished');
});

test('cancel(): the fixed lines are cancellable too, not just the LLM reply', async () => {
  // A half-cancellable Brain is worse than an uncancellable one: the stop
  // button works on most turns and then silently does not on the two that
  // speak a fixed line (§6.5, §6.7). Spec §8.1 scopes the controller to the
  // whole turn, so it has to exist before the first thing that can speak.
  const h = brainHarness({ connected: false });
  /** @param {any} text @param {any} opts */
  h.tts.speak = (text, opts) => new Promise(/** @param {any} resolve */ (resolve) => {
    h.events.push({ op: 'speak', text });
    opts?.signal?.addEventListener('abort', () => resolve());
  });

  const turn = h.brain.handle('往前走');
  await flushMicrotasks();
  h.brain.cancel();

  const outcome = await Promise.race([
    turn.then(() => 'finished'),
    new Promise((r) => setTimeout(() => r('still speaking'), 50)),
  ]);
  assert.equal(outcome, 'finished');
});

test('a recorded reply language is handed out, not just written into the object', async () => {
  // Brain used to mutate the caller's config and stop there. That was fine
  // while the config was a literal; it now comes from localStorage, and §11.1's
  // whole argument is that this preference is sticky and invisible. A sticky
  // state that dies on the next refresh is neither.
  const h = brainHarness({ reply: say(null, [
    { id: 'c1', name: 'set_reply_language', args: { lang: 'en' } },
  ]) });
  await h.brain.handle('from now on speak English');
  assert.deepEqual(h.langChanges, ['en']);
  assert.equal(h.config.replyLang, 'en');
});

test('"auto" is handed out as null — the same value the config stores', async () => {
  const h = brainHarness({ reply: say(null, [
    { id: 'c1', name: 'set_reply_language', args: { lang: 'auto' } },
  ]) });
  h.config.replyLang = 'zh';
  await h.brain.handle('go back to following me');
  assert.deepEqual(h.langChanges, [null]);
  assert.equal(h.config.replyLang, null);
});

test('a turn that records nothing does not touch the stored preference', async () => {
  const h = brainHarness({ reply: say('ok') });
  await h.brain.handle('hello');
  assert.deepEqual(h.langChanges, []);
});


// --- a failure has to reach somebody (§6.7) --------------------------------

test('handle: a TTS that throws is reported, not swallowed', async () => {
  // It used to take the whole turn down: handle() rejected, session.js's
  // `void this.#turn(samples)` dropped the rejection, and the robot went
  // quiet with nothing on screen and nothing in the console.
  const h = brainHarness({ reply: say('北京是中国的首都。') });
  breakVoice(h, 'TTS request failed: 401 Unauthorized');
  await h.brain.handle('中国的首都是哪');
  assert.deepEqual(h.faults, [['tts', 'TTS request failed: 401 Unauthorized']]);
  assert.deepEqual(h.events, [{ op: 'earcon', name: 'error' }]);
});

test('handle: an LLM failure reports which instrument it was, and why', async () => {
  const h = brainHarness({ reply: new Error('LLM request failed: 429 Too Many Requests') });
  await h.brain.handle('你好');
  assert.deepEqual(h.faults, [['llm', 'LLM request failed: 429 Too Many Requests']]);
});

test('both down: two reports, one beep (the second failure is a consequence)', async () => {
  // The LLM goes down, and then the fixed line saying so cannot be spoken
  // either. Two low two-tones back to back would claim two independent
  // faults; the written channel has no such limit and carries both.
  const h = brainHarness({ reply: new Error('network down') });
  breakVoice(h, 'no voice');
  await h.brain.handle('你好');
  assert.deepEqual(h.faults, [['llm', 'network down'], ['tts', 'no voice']]);
  assert.equal(h.events.filter((e) => e.op === 'earcon').length, 1);
});

test('the beep budget is per turn, not for the life of the brain', async () => {
  const h = brainHarness({ reply: new Error('down') });
  await h.brain.handle('你好');
  await h.brain.handle('你好');
  assert.equal(h.events.filter((e) => e.op === 'earcon').length, 2);
});

test('cancel(): a TTS abort is not a fault (spec §8.1)', async () => {
  const h = brainHarness({ reply: say('一段很长的回答') });
  // The signal is ALREADY aborted by the time #say reaches it — cancel() runs
  // before the fake LLM resolves — so this must not wait for an event that has
  // already fired. A provider behaves the same way: fetch rejects at once on a
  // spent signal.
  h.tts.speak = async (/** @type {any} */ _text, /** @type {any} */ opts) => {
    if (opts.signal.aborted) throw new DOMException('aborted', 'AbortError');
  };
  const turn = h.brain.handle('说点什么');
  h.brain.cancel();
  await turn;
  assert.deepEqual(h.faults, []);
  assert.deepEqual(h.events, []);
});

// --- Reflex layer (reflex spec §2, §6) ---------------------------------------

/** A judge that answers with a fixed verdict and records what it was asked.
 *  @param {string} verdict */
function judgeSaying(verdict) {
  /** @type {any[]} */ const asked = [];
  return {
    asked,
    judge: async (/** @type {string} */ heard, /** @type {string} */ robotSaid) => {
      asked.push({ heard, robotSaid });
      return { verdict, detail: verdict === 'fired' ? 'tease 0.94' : 'reply 0.01', ms: 5 };
    },
  };
}
const oneRung = { next: () => [{ kind: 'sound', name: 'bark' }], reset() {} };

test('reflex fired: no LLM, the rung runs, no done beep, and it is traced', async () => {
  const h = brainHarness({ reply: say('never'), reflex: judgeSaying('fired'), ladder: oneRung });
  await h.brain.handle('忘忘');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(h.llm.calls.length, 0);
  assert.deepEqual(h.events, [{ op: 'sound', name: 'bark' }]);
  assert.match(h.traced.join('\n'), /\[reflex\] 忘忘 → fired tease 0\.94 \(5ms\)/);
});

test('reflex fired: history holds the turn as a native, paired tool call', async () => {
  // Review focus 4: the NEXT request is rejected if a tool call has no tool
  // message. Written as the model's own turn, so the LLM remembers barking.
  const steps = [{ drive: 'backward', steer: 'left', duration_ms: 600 }];
  const h = brainHarness({ reply: say('ok'), reflex: judgeSaying('fired'),
    ladder: { next: () => [{ kind: 'sound', name: 'bark' }, { kind: 'move', steps }], reset() {} } });
  await h.brain.handle('忘忘');
  const [user, assistant, ...tools] = /** @type {any[]} */ (h.brain.history);
  assert.deepEqual(user, { role: 'user', content: '忘忘' });
  assert.equal(assistant.role, 'assistant');
  assert.deepEqual(assistant.tool_calls.map((/** @type {any} */ c) => [c.function.name, JSON.parse(c.function.arguments)]),
    [['play_sound', { name: 'bark' }], ['move', { steps }]]);
  assert.deepEqual(tools.map((t) => t.tool_call_id), assistant.tool_calls.map((/** @type {any} */ c) => c.id));
  assert.ok(tools.every((t) => t.role === 'tool' && t.content === 'ok'));
});

test('reflex passed: the LLM turn runs exactly as without a reflex', async () => {
  const h = brainHarness({ reply: say('明白就好。'), reflex: judgeSaying('passed'), ladder: oneRung });
  await h.brain.handle('明白');
  assert.equal(h.llm.calls.length, 1);
  assert.deepEqual(h.events, [{ op: 'speak', text: '明白就好。' }]);
});

test('reflex failed or skipped: the LLM answers', async () => {
  for (const verdict of ['failed', 'skipped']) {
    const h = brainHarness({ reply: say('嗯？'), reflex: judgeSaying(verdict), ladder: oneRung });
    await h.brain.handle('汪汪');
    assert.equal(h.llm.calls.length, 1, verdict);
  }
});

test('the judge is told what the robot last said', async () => {
  // Review focus 1: context is what separates 明白 the answer from a noise.
  const judge = judgeSaying('passed');
  const h = brainHarness({ reply: say('你明白吗？'), reflex: judge, ladder: oneRung });
  await h.brain.handle('跟我解释一下');
  await h.brain.handle('明白');
  assert.deepEqual(judge.asked.map((a) => a.robotSaid), ['', '你明白吗？']);
});

test('USB not connected is still intercepted before the reflex', async () => {
  const judge = judgeSaying('fired');
  const h = brainHarness({ connected: false, reply: say('x'), reflex: judge, ladder: oneRung });
  await h.brain.handle('汪汪');
  assert.equal(judge.asked.length, 0);
});

test('cancel() during the JEV call ends the turn with nothing dispatched', async () => {
  // Review focus 2: the stop button must work on a reflex turn too.
  /** @type {(v: any) => void} */ let answer = () => {};
  const reflex = { judge: () => new Promise((r) => { answer = r; }) };
  const h = brainHarness({ reply: say('never'), reflex, ladder: oneRung });
  const turn = h.brain.handle('汪汪');
  h.brain.cancel();
  answer({ verdict: 'fired', detail: 'tease 0.9', ms: 1 });
  await turn;
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(h.events, []);
  assert.equal(h.llm.calls.length, 0);
});

test('resetHistory() also resets the ladder', () => {
  let resets = 0;
  const h = brainHarness({ reflex: judgeSaying('passed'), ladder: { next: () => [], reset() { resets++; } } });
  h.brain.resetHistory();
  assert.equal(resets, 1);
});
