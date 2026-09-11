import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, SYSTEM_PROMPT, buildSystemPrompt, validate, Brain } from '../web/brain.js';
import { MIN_DURATION_MS } from '../web/executor.js';
import { KEYWORDS } from '../web/strings.js';

/** @param {string} name @returns {any} */
const byName = (name) => TOOLS.find((t) => t.function.name === name);

test('there are exactly the four tools of spec §6.2', () => {
  assert.deepEqual(TOOLS.map((t) => t.function.name).sort(),
    ['cruise', 'move', 'set_reply_language', 'stop']);
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

/** @param {{ connected?: boolean, reply?: any }} [opts] */
function brainHarness({ connected = true, reply } = {}) {
  /** @type {any[]} */
  const events = [];
  const executor = {
    connected,
    /** @param {any} steps */
    async move(steps) { events.push({ op: 'move', steps }); },
    /** @param {any} drive @param {any} steer */
    async cruise(drive, steer) { events.push({ op: 'cruise', drive, steer }); },
    stop() { events.push({ op: 'stop' }); return Promise.resolve(); },
  };
  const llm = {
    /** @type {any[]} */
    calls: [],
    /** @param {any} messages @param {any} tools */
    async chat(messages, tools) {
      this.calls.push({ messages: structuredClone(messages), tools });
      const r = typeof reply === 'function' ? reply(this.calls.length) : reply;
      if (r instanceof Error) throw r;
      return r;
    },
  };
  const tts = {
    /** @param {any} text */
    async speak(text) { events.push({ op: 'speak', text }); },
  };
  const earcon = (/** @type {any} */ name) => events.push({ op: 'earcon', name });
  /** @type {{ lang: 'en' | 'zh', replyLang: 'en' | 'zh' | null, bargeIn: boolean }} */
  const config = { lang: 'zh', replyLang: null, bargeIn: true };
  return { events, executor, llm, tts, config,
    brain: new Brain({ llm, executor, tts, earcon, config }) };
}

/** @param {any} content @param {any[]} [tool_calls] */
const say = (content, tool_calls) => ({
  text: content ?? '',
  toolCalls: (tool_calls ?? []).map((c) => ({ ...c, rawArguments: JSON.stringify(c.args) })),
  rawMessage: { role: 'assistant', content, ...(tool_calls ? { tool_calls: tool_calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}) },
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

test('handle: a move dispatches, beeps, and does NOT wait for the car to finish', async () => {
  const h = brainHarness({ reply: say(null, [
    { id: 'c1', name: 'move', args: { steps: [{ drive: 'forward', steer: 'straight', duration_ms: 600 }] } },
  ]) });
  await h.brain.handle('往前走');
  assert.deepEqual(h.events, [
    { op: 'move', steps: [{ drive: 'forward', steer: 'straight', duration_ms: 600 }] },
    { op: 'earcon', name: 'done' },
  ]);
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
