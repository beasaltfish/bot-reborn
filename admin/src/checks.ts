// The four layers' tests, run from this browser straight to the provider, as
// the phone's setup sheet does (web/checks.js). STT plays the synthesised
// clip the brain serves at /fixtures.
import { checkLlm, checkReflex, checkStt, checkTts } from '../../web/checks.js';
import { OpenAiCompatStt } from '../../web/providers/stt-openai-compat.js';
import { OpenAiCompatLlm } from '../../web/providers/llm-openai-compat.js';
import { WebAudioTts } from '../../web/providers/tts-webaudio.js';
import { Reflex } from '../../web/reflex.js';
import { TOOLS, buildSystemPrompt } from '../../web/brain.js';
import { lang } from './i18n';
import type { Config, LayerName } from './types';

export type CheckFn = (layer: LayerName, config: Config) => Promise<string>;

let ctx: AudioContext | null = null;
const audio = () => (ctx ??= new AudioContext());

export const runCheck: CheckFn = async (layer, config) => {
  if (layer === 'stt') return `“${await checkStt(new OpenAiCompatStt(config.stt), audio(), lang)}”`;
  if (layer === 'llm') {
    return checkLlm(new OpenAiCompatLlm(config.llm), {
      tools: TOOLS, systemPrompt: buildSystemPrompt({ replyLang: null, bargeIn: true }),
    });
  }
  if (layer === 'reflex') return checkReflex(new Reflex(config.reflex));
  return checkTts(new WebAudioTts(config.tts as Required<typeof config.tts>, { audioContext: audio() }), lang);
};
