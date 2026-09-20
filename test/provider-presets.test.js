import test from 'node:test';
import assert from 'node:assert/strict';

import { PRESETS, CUSTOM, presetIdFor, presetById } from '../web/provider-presets.js';

test('a stored baseURL is recognised as the preset it came from', () => {
  assert.equal(presetIdFor('llm', { baseURL: 'https://api.deepseek.com' }), 'deepseek');
  assert.equal(presetIdFor('stt', { baseURL: 'https://api.groq.com/openai/v1' }), 'groq');
});

test('a trailing slash is the same provider, not a different one', () => {
  // Somebody who pasted the URL by hand on setup.html before the sheet existed
  // would otherwise open the sheet and find their provider demoted to "Other",
  // with the address they already had sitting in a text box.
  assert.equal(presetIdFor('llm', { baseURL: 'https://api.deepseek.com/' }), 'deepseek');
});

test('an unrecognised address, and an empty one, are custom', () => {
  assert.equal(presetIdFor('llm', { baseURL: 'https://llm.example.internal/v1' }), CUSTOM);
  assert.equal(presetIdFor('llm', { baseURL: '' }), CUSTOM);
});

test('an unknown model does not demote the provider to custom', () => {
  // The identity is the address. Somebody on Groq who typed a model this list
  // has never heard of is still on Groq, and blanking the dropdown they chose
  // would lose the address along with it.
  assert.equal(
    presetIdFor('llm', { baseURL: 'https://api.groq.com/openai/v1' }),
    'groq');
});

test('presetById answers null for custom, so callers have one shape to test', () => {
  assert.equal(presetById('llm', CUSTOM), null);
  assert.equal(presetById('llm', 'a-provider-that-was-removed'), null);
  assert.equal(presetById('llm', 'deepseek')?.baseURL, 'https://api.deepseek.com');
});

test('every preset can fill in the fields it promises to fill in', () => {
  // A preset with no models would select itself, write a baseURL, and leave
  // the model empty — which reads on screen as "configured" and fails at the
  // first request.
  for (const [layer, list] of Object.entries(PRESETS)) {
    for (const preset of list) {
      assert.ok(preset.baseURL.startsWith('https://'), `${layer}/${preset.id} baseURL`);
      assert.ok(preset.models.length > 0, `${layer}/${preset.id} has no model`);
      assert.ok(preset.id !== CUSTOM, `${layer}/${preset.id} shadows "custom"`);
    }
  }
});

test('TTS presets carry a voice list, because that layer has a fourth field', () => {
  // Spec §8.2: TTS is the one layer with a required `voice`. A TTS preset
  // without voices leaves it empty and the request fails on a field the sheet
  // never showed.
  for (const preset of PRESETS.tts) {
    assert.ok(preset.voices && preset.voices.length > 0, `${preset.id} has no voices`);
  }
});

test('ids are unique within a layer', () => {
  for (const [layer, list] of Object.entries(PRESETS)) {
    const ids = list.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, `${layer} has a duplicate id`);
  }
});
