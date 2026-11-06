import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TOOLS, RETURNING_TOOLS, toolsFor, validate, buildSystemPrompt, SYSTEM_PROMPT_TAROT,
} from '../core/brain.js';

const names = (/** @type {any} */ m) => toolsFor(m).map((t) => t.function.name).sort();

test('toolsFor: a tarot body is offered draw_card and nothing else', () => {
  assert.deepEqual(names('tarot'), ['draw_card']);
});

test('toolsFor: every other body gets exactly the tools it had before tarot', () => {
  assert.deepEqual(names('car'), ['cruise', 'move', 'play_sound', 'set_reply_language', 'stop']);
  assert.deepEqual(names('dry-run'), ['cruise', 'move', 'play_sound', 'set_reply_language', 'stop']);
  assert.deepEqual(names('none'), ['play_sound', 'set_reply_language']);
  assert.deepEqual(names('pet'), ['play_sound', 'pose']);
  assert.deepEqual(names(undefined), ['cruise', 'move', 'play_sound', 'set_reply_language', 'stop']);
});

test('draw_card takes no arguments, and only it is a returning tool', () => {
  const tool = TOOLS.find((t) => t.function.name === 'draw_card');
  assert.deepEqual(tool?.function.parameters.properties, {});
  assert.deepEqual([...RETURNING_TOOLS], ['draw_card']);
});

test('validate: a draw_card call becomes a draw action with no card chosen yet', () => {
  const out = validate([{ name: 'draw_card', args: {}, rawArguments: '{}' }]);
  assert.deepEqual(out.actions, [{ kind: 'draw' }]);
  assert.equal(out.hadMoveIntent, false);
  assert.deepEqual(out.reasons, []);
});

test('the tarot prompt: its own body, the reading limits, and no dog', () => {
  assert.match(SYSTEM_PROMPT_TAROT, /draw_card/);
  assert.match(SYSTEM_PROMPT_TAROT, /80 Chinese characters/);
  assert.match(SYSTEM_PROMPT_TAROT, /50 English words/);
  assert.doesNotMatch(SYSTEM_PROMPT_TAROT, /bark/i);
  assert.doesNotMatch(SYSTEM_PROMPT_TAROT, /wheels/i);
});

test('the tarot prompt follows the recorded reply language, and adds none when there is none', () => {
  const tarot = { body: { motion: /** @type {const} */ ('tarot') } };
  assert.match(buildSystemPrompt({ replyLang: 'en', ...tarot }), /Always reply in English/);
  assert.match(buildSystemPrompt({ replyLang: 'zh', ...tarot }), /Always reply in Chinese/);
  assert.doesNotMatch(buildSystemPrompt({ replyLang: null, ...tarot }), /Always reply in/);
});

test('the tarot prompt keeps the persona, and tells the model not to describe the picture', () => {
  const p = buildSystemPrompt({ replyLang: null, persona: 'You are Madame Rue.', body: { motion: 'tarot' } });
  assert.match(p, /^You are Madame Rue\./);
  assert.match(p, /do not describe what is drawn on the card/i);
  assert.match(p, /not a prediction/i);
});

// --- Drawing, the reading and the reflex hand-off (plan task 4) -------------

import { Brain, READING_TIMEOUT_MS } from '../core/brain.js';
import { TAROT_CARDS } from '../core/tarot.js';
import { t } from '../core/strings.js';

/**
 * A tarot brain whose every side effect lands, in order, in `events`: the
 * model's calls, the executor's draw and reveal, and what is spoken.
 * @param {{ replies?: any[], llmFails?: Error, hang?: boolean, motion?: any, reflex?: any, onDraw?: () => void }} [opts]
 */
function tarotHarness({ replies = [], llmFails, hang = false, motion = 'tarot', reflex = null, onDraw = () => {} } = {}) {
  /** @type {any[]} */ const events = [];
  /** @type {any[]} */ const calls = [];
  /** @type {Array<{ ms: number, fn: () => void, live: boolean }>} */ const timers = [];
  /** @type {Array<[string, string]>} */ const faults = [];
  const llm = {
    /** @param {any} messages @param {any} tools @param {{ signal?: AbortSignal }} [opts] */
    async chat(messages, tools, opts) {
      events.push({ op: 'chat' });
      calls.push({ messages: structuredClone(messages), tools });
      if (llmFails) throw llmFails;
      if (hang) {
        await new Promise((_, reject) => opts?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
      }
      return replies[Math.min(calls.length, replies.length) - 1];
    },
  };
  const executor = {
    async move() {}, async cruise() {}, async stop() {},
    async pose() { events.push({ op: 'pose' }); },
    async draw(/** @type {any} */ card) { events.push({ op: 'draw', card }); onDraw(); },
    async reveal() { events.push({ op: 'reveal' }); },
  };
  const tts = {
    /** @param {string} text */
    async speak(text) { events.push({ op: 'speak', text }); },
  };
  /** @type {string[]} */ const traced = [];
  const brain = new Brain({
    llm, executor, tts, earcon: () => {}, sound: async () => {}, reflex,
    config: { lang: 'en', replyLang: null, bargeIn: true, body: { motion } },
    rng: () => 0,
    after: (ms, fn) => { const timer = { ms, fn, live: true }; timers.push(timer); return () => { timer.live = false; }; },
    onFault: (part, err) => faults.push([part, err.message]),
    trace: (line) => traced.push(line),
  });
  const fire = () => { for (const timer of timers.filter((x) => x.live)) { timer.live = false; timer.fn(); } };
  return { brain, events, calls, timers, fire, faults, traced };
}

/** @param {string} content */
const reading = (content) => ({ text: content, toolCalls: [], rawMessage: { role: 'assistant', content } });
/** @param {string} id */
const drawCall = (id = 'd1') => ({
  text: '',
  toolCalls: [{ id, name: 'draw_card', args: {}, rawArguments: '{}' }],
  rawMessage: { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name: 'draw_card', arguments: '{}' } }] },
});
const ops = (/** @type {any[]} */ events) => events.map((e) => e.op);
const FOOL = TAROT_CARDS[0];

test('drawCard: draw, ask the model once with no tools, reveal, then speak', async () => {
  const h = tarotHarness({ replies: [reading('A fresh start.')] });
  await h.brain.drawCard();
  assert.deepEqual(ops(h.events), ['draw', 'chat', 'reveal', 'speak']);
  assert.deepEqual(h.events[0].card, { id: FOOL.id, reversed: false });
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].tools, []);
  const user = h.calls[0].messages.filter((/** @type {any} */ m) => m.role === 'user').at(-1).content;
  for (const part of [FOOL.en, FOOL.zh, 'upright']) assert.ok(user.includes(part), part);
  assert.deepEqual(h.events.at(-1), { op: 'speak', text: 'A fresh start.' });
});

test('the draw_card tool path asks the model twice: the call, then the reading', async () => {
  const h = tarotHarness({ replies: [drawCall(), reading('Your reading.')] });
  await h.brain.handle('give me a card');
  assert.deepEqual(ops(h.events), ['chat', 'draw', 'chat', 'reveal', 'speak']);
  const tool = h.calls[1].messages.find((/** @type {any} */ m) => m.role === 'tool');
  assert.ok(tool.content.includes(FOOL.en));
});

test('the model calling draw_card again after its result does not draw a second card', async () => {
  const h = tarotHarness({ replies: [drawCall()] });
  await h.brain.handle('another, another');
  assert.equal(h.events.filter((e) => e.op === 'draw').length, 1);
  assert.ok(h.calls.length <= 1 + 2);
  assert.equal(h.events.filter((e) => e.op === 'reveal').length, 1);
});

test('a second request in a later turn draws a new card', async () => {
  const h = tarotHarness({ replies: [reading('one'), reading('two')] });
  await h.brain.drawCard();
  await h.brain.drawCard();
  assert.equal(h.events.filter((e) => e.op === 'draw').length, 2);
});

test('an LLM failure reveals the card and speaks the error line', async () => {
  const h = tarotHarness({ llmFails: new Error('503') });
  await h.brain.drawCard();
  assert.deepEqual(ops(h.events), ['draw', 'chat', 'reveal', 'speak']);
  assert.deepEqual(h.events.at(-1), { op: 'speak', text: t('en', 'apiFailed') });
  assert.deepEqual(h.faults, [['llm', '503']]);
});

test('no reading within the time limit reveals the card anyway and speaks the error line', async () => {
  const h = tarotHarness({ hang: true });
  const done = h.brain.drawCard();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(h.timers.map((x) => x.ms), [READING_TIMEOUT_MS]);
  assert.equal(READING_TIMEOUT_MS, 20000);
  h.fire();
  await done;
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(ops(h.events), ['draw', 'chat', 'reveal', 'speak']);
  assert.deepEqual(h.events.at(-1), { op: 'speak', text: t('en', 'apiFailed') });
});

test('a reading that arrives in time cancels the time limit', async () => {
  const h = tarotHarness({ replies: [reading('quick')] });
  await h.brain.drawCard();
  assert.ok(h.timers.every((x) => !x.live));
});

/** A reflex that fires the named tool calls. */
const firing = (/** @type {string[]} */ names) => ({
  async judge() {
    return {
      verdict: /** @type {const} */ ('fired'), detail: 'test', ms: 0,
      calls: names.map((name) => ({ name, args: name === 'pose' ? { name: 'sit' } : {}, rawArguments: '{}' })),
    };
  },
});

test('a reflex that fires draw_card draws, then the model reads it once', async () => {
  const h = tarotHarness({ replies: [reading('Reflexive reading.')], reflex: firing(['draw_card']) });
  await h.brain.handle('draw a card');
  assert.deepEqual(ops(h.events), ['draw', 'chat', 'reveal', 'speak']);
  assert.deepEqual(h.calls[0].tools, []);
  const user = h.calls[0].messages.filter((/** @type {any} */ m) => m.role === 'user').at(-1).content;
  assert.ok(user.includes('draw a card') && user.includes(FOOL.en));
});

test('a reflex that fires a pet pose still ends the turn with no model call', async () => {
  const h = tarotHarness({ motion: 'pet', reflex: firing(['pose']) });
  await h.brain.handle('sit');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(h.calls.length, 0);
  assert.deepEqual(ops(h.events), ['pose']);
});

test('a draw fired for a body that cannot draw is dropped with a trace line, and no model call', async () => {
  const h = tarotHarness({ motion: 'car', reflex: firing(['draw_card']) });
  await h.brain.handle('draw a card');
  assert.equal(h.calls.length, 0);
  assert.deepEqual(ops(h.events), []);
  assert.match(h.traced.join('\n'), /draw dropped: body "car" does not do draw/);
});

test('a turn cancelled while the card is being drawn still turns it over, and nothing fires later', async () => {
  /** @type {any} */ let h;
  h = tarotHarness({ replies: [drawCall(), reading('never said')], onDraw: () => h.brain.cancel() });
  await h.brain.handle('give me a card');
  assert.deepEqual(ops(h.events), ['chat', 'draw', 'reveal']);
  assert.ok(h.timers.every((/** @type {{ live: boolean }} */ x) => !x.live), 'the give-up timer is not left armed');
  h.fire();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(ops(h.events), ['chat', 'draw', 'reveal'], 'no late apology');
});
