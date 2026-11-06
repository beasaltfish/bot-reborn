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
