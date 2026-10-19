import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStt, makeTtsSource } from '../../server/providers/pick.js';
import { OpenAiCompatStt } from '../../core/providers/stt-openai-compat.js';
import { VolcengineStt } from '../../server/providers/stt-volcengine.js';
import { OpenAiTtsSource } from '../../server/providers/tts-openai.js';
import { VolcengineTtsSource } from '../../server/providers/tts-volcengine.js';

const layer = (/** @type {string} */ baseURL) => ({ baseURL, apiKey: 'k', model: 'm', voice: 'v', prompt: '' });

test('openai-compatible and custom layers get the OpenAI adapters', () => {
  for (const url of ['https://api.groq.com/openai/v1', 'https://my.box.local/v1', '']) {
    assert.ok(makeStt(layer(url)) instanceof OpenAiCompatStt, url);
    assert.ok(makeTtsSource(layer(url)) instanceof OpenAiTtsSource, url);
  }
});

test('a Volcengine address gets the Volcengine adapters, even typed by hand with a trailing slash', () => {
  const cfg = layer('https://openspeech.bytedance.com/');
  assert.ok(makeStt(cfg) instanceof VolcengineStt);
  assert.ok(makeTtsSource(cfg) instanceof VolcengineTtsSource);
});
