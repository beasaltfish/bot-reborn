import test from 'node:test';
import assert from 'node:assert/strict';

import { PRESETS, CUSTOM, presetIdFor, presetById, presetBody, presetApi, presetMaxInput, voicesFor, orderForPicker, startingPreset } from '../core/provider-presets.js';

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

test('DeepSeek offers its current models, and not the thinking-only alias', () => {
  const models = presetById('llm', 'deepseek')?.models ?? [];
  assert.equal(models[0], 'deepseek-flash');
  assert.ok(!models.includes('deepseek-reasoner'));
});

test('the reflex layer offers JEV on OpenRouter', () => {
  // Reflex spec §7. Here, not typed into dev.html, because this list is the one
  // place the repo names providers (test/instrument-ui.test.js enforces it).
  const jev = presetById('reflex', 'openrouter');
  assert.equal(jev?.baseURL, 'https://openrouter.ai/api/v1');
  assert.deepEqual(jev?.models, ['jev-1.13']);
});

test('a mainland key has its own row, recognised by the mainland address', () => {
  // The two sites of each provider refuse each other's keys, so a mainland
  // account on the global row fails with what reads as a bad key.
  assert.equal(presetIdFor('stt', { baseURL: 'https://api.siliconflow.cn/v1' }), 'siliconflow-cn');
  assert.equal(presetIdFor('llm', { baseURL: 'https://api.siliconflow.cn/v1' }), 'siliconflow-cn');
  assert.equal(presetIdFor('tts', { baseURL: 'https://api.siliconflow.cn/v1' }), 'siliconflow-cn');
  assert.equal(presetIdFor('llm', { baseURL: 'https://api.moonshot.cn/v1' }), 'moonshot-cn');
  assert.equal(
    presetIdFor('llm', { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }),
    'dashscope-cn');
  assert.equal(presetIdFor('llm', { baseURL: 'https://open.bigmodel.cn/api/paas/v4' }), 'zhipu-cn');
});

test('a config saved on a global site still opens on the global row', () => {
  assert.equal(presetIdFor('stt', { baseURL: 'https://api.siliconflow.com/v1' }), 'siliconflow');
  assert.equal(presetIdFor('llm', { baseURL: 'https://api.moonshot.ai/v1' }), 'moonshot');
  assert.equal(
    presetIdFor('llm', { baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' }),
    'dashscope');
  assert.equal(presetIdFor('llm', { baseURL: 'https://api.z.ai/api/paas/v4' }), 'zhipu');
});

test('a mainland row has a global twin and the same voices', () => {
  // Models may differ — SiliconFlow's two sites carry different catalogues —
  // but a voice list is per model, so a shared model keeps its voices.
  for (const [layer, list] of Object.entries(PRESETS)) {
    for (const cn of list.filter((p) => p.region === 'cn')) {
      const global = presetById(/** @type {any} */ (layer), cn.id.replace(/-cn$/, ''));
      assert.ok(global, `${layer}/${cn.id} has no global twin`);
      assert.equal(global.region, 'global', `${layer}/${global.id} is not marked global`);
      assert.deepEqual(cn.voices, global.voices, `${layer}/${cn.id} voices`);
    }
  }
});

test('SiliconFlow mainland offers current tool-calling chat models, thinking off', () => {
  // Checked against the .cn /models list and a tool call each, 2026-10-17.
  const cn = presetById('llm', 'siliconflow-cn');
  assert.deepEqual(cn?.models, [
    'deepseek-ai/DeepSeek-V4-Flash',
    'Qwen/Qwen3.6-35B-A3B',
    'zai-org/GLM-5.3-Flash',
    'Pro/moonshotai/Kimi-K2.6',
  ]);
  assert.deepEqual(presetBody('llm', { baseURL: 'https://api.siliconflow.cn/v1' }), { enable_thinking: false });
  // The override is the LLM row's alone.
  assert.deepEqual(presetById('stt', 'siliconflow-cn')?.models, ['FunAudioLLM/SenseVoiceSmall']);
  assert.deepEqual(presetBody('stt', { baseURL: 'https://api.siliconflow.cn/v1' }), {});
});

test('no two rows in a layer share an address', () => {
  // Rows are found by address, so a shared one makes the second row
  // unreachable: picking it would reopen as the first.
  for (const [layer, list] of Object.entries(PRESETS)) {
    const urls = list.map((p) => p.baseURL.replace(/\/+$/, ''));
    assert.equal(new Set(urls).size, urls.length, `${layer} has a duplicate address`);
  }
});

test('Volcengine is listed for STT and TTS with its resource ids', () => {
  const stt = presetById('stt', 'volcengine');
  assert.deepEqual(stt?.models, ['volc.seedasr.sauc.duration', 'volc.seedasr.sauc.concurrent']);
  assert.equal(stt?.api, 'volcengine');
  assert.equal(stt?.baseURL, 'https://openspeech.bytedance.com');
  const tts = presetById('tts', 'volcengine');
  assert.deepEqual(tts?.models, ['seed-tts-2.0']);
  assert.equal(tts?.api, 'volcengine');
});

test('Volcengine voices start with 小何 and every voice has a label', () => {
  const tts = presetById('tts', 'volcengine');
  const voices = voicesFor(tts, 'seed-tts-2.0');
  assert.equal(voices[0], 'zh_female_xiaohe_uranus_bigtts');
  assert.equal(voices.length, 6);
  for (const v of voices) assert.ok(tts?.voiceLabels?.[v], `${v} has no label`);
  assert.equal(tts?.voicesURL, 'https://docs.volcengine.com/docs/DoubaoVoice/Tonelist-1');
});

test('presetApi finds the API by address, and anything unknown is openai', () => {
  assert.equal(presetApi('tts', { baseURL: 'https://openspeech.bytedance.com/' }), 'volcengine');
  assert.equal(presetApi('stt', { baseURL: 'https://openspeech.bytedance.com' }), 'volcengine');
  assert.equal(presetApi('tts', { baseURL: 'https://api.openai.com/v1' }), 'openai');
  assert.equal(presetApi('stt', { baseURL: 'https://example.com' }), 'openai');
});

test('Groq speaks English through Orpheus, 200 characters a request', () => {
  const tts = presetById('tts', 'groq');
  assert.deepEqual(tts?.models, ['canopylabs/orpheus-v1-english']);
  assert.deepEqual(voicesFor(tts, 'canopylabs/orpheus-v1-english'), ['hannah', 'autumn', 'diana', 'austin', 'daniel', 'troy']);
  assert.equal(presetMaxInput('tts', { baseURL: 'https://api.groq.com/openai/v1/' }), 200);
  assert.equal(presetMaxInput('tts', { baseURL: 'https://api.openai.com/v1' }), null);
});

test('a new character speaks through OpenAI, not English-only Groq, though Groq sorts first', () => {
  assert.equal(orderForPicker(PRESETS.tts)[0].id, 'groq');
  assert.equal(startingPreset('tts')?.id, 'openai');
  assert.equal(startingPreset('stt')?.id, 'openai');
  assert.equal(startingPreset('llm')?.id, 'openai');
  assert.equal(startingPreset('reflex')?.id, orderForPicker(PRESETS.reflex)[0].id);
});

test('OpenAI offers gpt-4o-mini-tts with marin and cedar, after the tts-1 models', () => {
  const tts = presetById('tts', 'openai');
  assert.deepEqual(tts?.models, ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts']);
  assert.deepEqual(voicesFor(tts, 'gpt-4o-mini-tts'), ['marin', 'cedar', 'alloy', 'nova', 'shimmer']);
  // marin and cedar are not in the tts-1 family's list.
  assert.ok(!voicesFor(tts, 'tts-1').includes('marin'));
});

test('OpenAI STT is gpt-transcribe, not whisper-1', () => {
  assert.deepEqual(presetById('stt', 'openai')?.models, ['gpt-transcribe']);
});
