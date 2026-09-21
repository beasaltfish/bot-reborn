import test from 'node:test';
import assert from 'node:assert/strict';

import { PRESETS, CUSTOM, presetIdFor, presetById, voicesFor } from '../web/provider-presets.js';

test('a stored baseURL is recognised as the preset it came from', () => {
  assert.equal(presetIdFor('llm', { baseURL: 'https://api.deepseek.com' }), 'deepseek');
  assert.equal(presetIdFor('stt', { baseURL: 'https://api.groq.com/openai/v1' }), 'groq');
});

test('a trailing slash is the same provider, not a different one', () => {
  // Somebody who pasted the URL by hand on dev.html before the sheet existed
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
      assert.ok(preset.models.length > 0 || preset.openModels,
        `${layer}/${preset.id} has no model and did not say so`);
      assert.ok(preset.id !== CUSTOM, `${layer}/${preset.id} shadows "custom"`);
    }
  }
});

test('every TTS model carries its own voices, not the provider', () => {
  // Spec §8.2: TTS is the one layer with a required `voice`, and a model with
  // no voices leaves it empty — the request then fails on a field the sheet
  // never showed.
  //
  // Keyed by MODEL because on SiliconFlow the speaker names contain the model
  // name (`<model>:<speaker>`), so a provider-wide list would offer eight
  // voices that all belong to whichever model was written down first.
  for (const preset of PRESETS.tts) {
    for (const model of preset.models) {
      assert.ok(voicesFor(preset, model).length > 0,
        `${preset.id} has no voices for ${model}`);
    }
  }
});

test('a voice that names a model names the model it is filed under', () => {
  // The failure this catches is a copy-paste one: filing fish-speech's
  // speakers under CosyVoice. Every field would look filled in and every
  // request would be refused.
  for (const preset of PRESETS.tts) {
    for (const model of preset.models) {
      for (const voice of voicesFor(preset, model)) {
        if (!voice.includes(':')) continue;
        assert.equal(voice.split(':')[0], model,
          `${preset.id}: voice "${voice}" is filed under "${model}"`);
      }
    }
  }
});

test('voicesFor answers empty rather than throwing for a layer that has none', () => {
  // STT and LLM presets have no voices at all, and custom has no preset.
  assert.deepEqual(voicesFor(presetById('llm', 'groq'), 'anything'), []);
  assert.deepEqual(voicesFor(null, 'anything'), []);
  assert.deepEqual(voicesFor(presetById('tts', 'openai'), 'a-model-it-has-never-heard-of'), []);
});

test('an empty model list has to be deliberate', () => {
  // `openModels` is not ceremony. Without it, a typo that empties a list and a
  // provider whose model is genuinely the user's to name look identical — and
  // the first one ships a preset that fills in an address and leaves the model
  // blank, which reads on screen as configured and fails at the first request.
  for (const [layer, list] of Object.entries(PRESETS)) {
    for (const preset of list) {
      if (preset.openModels) {
        assert.equal(preset.models.length, 0,
          `${layer}/${preset.id} says openModels and also lists models`);
      }
    }
  }
});

test('ids are unique within a layer', () => {
  for (const [layer, list] of Object.entries(PRESETS)) {
    const ids = list.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, `${layer} has a duplicate id`);
  }
});
