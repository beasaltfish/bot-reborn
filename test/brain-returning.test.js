import test from 'node:test';
import assert from 'node:assert/strict';

import { Brain, MAX_TOOL_ROUNDS } from '../core/brain.js';

/**
 * A scripted model: the nth call to chat() gets the nth reply (the last one repeats).
 * @param {{ replies: any[], returning?: any, returningTools?: any, motion?: any }} opts
 */
function harness({ replies, returning, returningTools, motion = 'car' }) {
  /** @type {any[]} */ const events = [];
  /** @type {any[]} */ const calls = [];
  const llm = {
    /** @param {any} messages @param {any} tools */
    async chat(messages, tools) {
      calls.push({ messages: structuredClone(messages), tools });
      return replies[Math.min(calls.length, replies.length) - 1];
    },
  };
  const executor = {
    async move() { events.push({ op: 'move' }); },
    async cruise() {}, async stop() {},
  };
  const tts = {
    /** @param {string} text */
    async speak(text) { events.push({ op: 'speak', text }); },
  };
  const brain = new Brain({
    llm, executor, tts, earcon: () => {}, sound: async () => {},
    config: { lang: 'en', replyLang: null, bargeIn: true, body: { motion } },
    returning, returningTools, trace: () => {},
  });
  return { brain, events, calls };
}

/** @param {string} content */
const text = (content) => ({
  text: content, toolCalls: [], rawMessage: { role: 'assistant', content },
});
/** @param {string} name @param {any} args @param {string} [id] @param {string} [content] */
const call = (name, args, id = 'c1', content = '') => ({
  text: content,
  toolCalls: [{ id, name, args, rawArguments: JSON.stringify(args) }],
  rawMessage: {
    role: 'assistant', content,
    tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
  },
});

const LOOKUP = new Set(['lookup']);

test('a returning call is answered with its real result and the model is asked again', async () => {
  /** @type {any[]} */ const seen = [];
  const h = harness({
    replies: [call('lookup', { q: 'x' }), text('done')],
    returningTools: LOOKUP,
    returning: { lookup: (/** @type {any} */ args) => { seen.push(args); return '42'; } },
  });
  await h.brain.handle('what is it');
  assert.deepEqual(seen, [{ q: 'x' }]);
  assert.equal(h.calls.length, 2);
  const second = h.calls[1].messages;
  assert.deepEqual(second.filter((/** @type {any} */ m) => m.role === 'tool'), [{ role: 'tool', tool_call_id: 'c1', content: '42' }]);
  assert.deepEqual(h.events, [{ op: 'speak', text: 'done' }]);
});

test('a handler that throws becomes the result text, and the turn goes on', async () => {
  const h = harness({
    replies: [call('lookup', {}), text('sorry about that')],
    returningTools: LOOKUP,
    returning: { lookup: () => { throw new Error('boom'); } },
  });
  await h.brain.handle('go');
  const tool = h.calls[1].messages.find((/** @type {any} */ m) => m.role === 'tool');
  assert.match(tool.content, /boom/);
  assert.deepEqual(h.events, [{ op: 'speak', text: 'sorry about that' }]);
});

test('at most MAX_TOOL_ROUNDS round trips, then the turn ends with one thing said', async () => {
  let ran = 0;
  const h = harness({
    replies: [call('lookup', {}, 'c1', 'checking')],
    returningTools: LOOKUP,
    returning: { lookup: () => { ran++; return 'again'; } },
  });
  await h.brain.handle('loop forever');
  assert.equal(MAX_TOOL_ROUNDS, 2);
  assert.equal(h.calls.length, 1 + MAX_TOOL_ROUNDS);
  assert.equal(ran, MAX_TOOL_ROUNDS);
  assert.deepEqual(h.events, [{ op: 'speak', text: 'checking' }], 'only the last reply is spoken, once');
});

test('words that come with a returning call are not spoken; only the last reply is', async () => {
  const h = harness({
    replies: [call('lookup', {}, 'c1', 'let me look'), text('here it is')],
    returningTools: LOOKUP,
    returning: { lookup: () => 'found' },
  });
  await h.brain.handle('find it');
  assert.deepEqual(h.events, [{ op: 'speak', text: 'here it is' }]);
});

test('a turn with only action tools asks the model exactly once and keeps the placeholder result', async () => {
  const steps = [{ drive: 'forward', steer: 'straight', duration_ms: 600 }];
  const h = harness({ replies: [call('move', { steps })] });
  await h.brain.handle('forward');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.events, [{ op: 'move' }]);
  const history = /** @type {any} */ (h.brain.history);
  assert.deepEqual(history.filter((/** @type {any} */ m) => m.role === 'tool'), [{ role: 'tool', tool_call_id: 'c1', content: 'ok' }]);
});

test('trimming never leaves a tool message without the assistant call that owns it', async () => {
  let n = 0;
  const h = harness({
    replies: [call('lookup', {}, 'a'), text('r1')],
    returningTools: LOOKUP,
    returning: { lookup: () => `res${n++}` },
  });
  // Eight turns is more than the history keeps.
  for (let i = 0; i < 8; i++) {
    h.calls.length = 0;
    await h.brain.handle(`turn ${i}`);
  }
  const history = /** @type {any[]} */ (h.brain.history);
  history.forEach((m, i) => {
    if (m.role !== 'tool') return;
    const owner = history.slice(0, i).reverse().find((x) => x.role === 'assistant' && x.tool_calls?.some((/** @type {any} */ c) => c.id === m.tool_call_id));
    assert.ok(owner, `tool message ${m.tool_call_id} at ${i} has no assistant call before it`);
  });
  assert.equal(history[0].role, 'user', 'history starts at a user message');
});

test('an aborted turn does not start the next round', async () => {
  /** @type {any} */ let brain;
  const h = harness({
    replies: [call('lookup', {}), text('never said')],
    returningTools: LOOKUP,
    returning: { lookup: () => { brain.cancel(); return 'late'; } },
  });
  brain = h.brain;
  await h.brain.handle('stop me');
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.events, []);
});
