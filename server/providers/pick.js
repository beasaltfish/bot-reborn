// Which adapter a layer gets, by the API its preset speaks (provider-presets.js
// `api`). The robot and the admin page's key checks both build through here,
// so a check that passes has gone down the path the robot will take.

import { presetApi, presetMaxInput } from '../../core/provider-presets.js';
import { OpenAiCompatStt } from '../../core/providers/stt-openai-compat.js';
import { VolcengineStt } from '../../core/providers/stt-volcengine.js';
import { OpenAiTtsSource } from './tts-openai.js';
import { VolcengineTtsSource } from './tts-volcengine.js';

/**
 * @param {{ baseURL: string, apiKey: string, model: string, prompt?: string }} cfg
 * @param {{ fetch?: typeof fetch }} [net]
 */
export function makeStt(cfg, net = {}) {
  return presetApi('stt', cfg) === 'volcengine' ? new VolcengineStt(cfg, net) : new OpenAiCompatStt(cfg, net);
}

/**
 * @param {{ baseURL: string, apiKey: string, model: string, voice: string }} cfg
 * @param {{ fetch?: typeof fetch }} [net]
 * @returns {import('./tts-pcm.js').TtsSource}
 */
export function makeTtsSource(cfg, net = {}) {
  return presetApi('tts', cfg) === 'volcengine' ? new VolcengineTtsSource(cfg, net) : new OpenAiTtsSource(cfg, { ...net, maxInput: presetMaxInput('tts', cfg) });
}
