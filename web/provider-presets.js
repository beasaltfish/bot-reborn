// The built-in provider list behind the setup sheet's dropdowns.
//
// Spec §8 of the 2026-09-17 design: the only field that is genuinely personal
// is the key. A baseURL and a model name are the same for everybody using the
// same provider, and asking somebody to paste them is handing out one more
// chance to get them wrong — with a failure that reads as "the key is bad".
//
// This is a convenience over §8.2's schema, not a replacement for it. Nothing
// here is stored: picking a preset writes its baseURL and model into the same
// three flat fields the config has always had, and `custom` writes whatever
// was typed. A config assembled on setup.html by hand loads back into these
// rows as `custom` if it matches no preset, and still works.
//
// The endpoints and the two default models are the ones spec §8.3 chose and
// setup.html has been carrying as placeholders since it was written. Anything
// this list gets wrong is fixable by picking `custom`, which is why the list
// can afford to be short.

/** @typedef {'stt' | 'llm' | 'tts'} LayerName */

/**
 * `voices` is keyed by model id, not held once per provider, because on some
 * providers the voice name contains the model name: SiliconFlow's speakers are
 * spelled `<model>:<speaker>`, so changing the model invalidates every voice
 * in the list. OpenAI's do not, and its two models simply share one array.
 *
 * @typedef {{
 *   id: string,
 *   label: string,
 *   baseURL: string,
 *   models: string[],
 *   voices?: Record<string, string[]>,
 * }} Preset
 */

/** The eight speakers SiliconFlow gives every one of its TTS models. */
const SPEAKERS = ['alex', 'anna', 'bella', 'benjamin', 'charles', 'claire', 'david', 'diana'];

/** @param {string} model @returns {string[]} */
const prefixed = (model) => SPEAKERS.map((s) => `${model}:${s}`);

const SILICONFLOW = 'https://api.siliconflow.com/v1';

/** The id every layer falls back to: nothing filled in, every field typed. */
export const CUSTOM = 'custom';

/** @type {Record<LayerName, Preset[]>} */
export const PRESETS = {
  stt: [
    {
      id: 'groq',
      label: 'Groq',
      baseURL: 'https://api.groq.com/openai/v1',
      models: ['whisper-large-v3-turbo', 'whisper-large-v3'],
    },
    {
      id: 'openai',
      label: 'OpenAI',
      baseURL: 'https://api.openai.com/v1',
      models: ['whisper-1'],
    },
    {
      // Spec §8.3 names it as the STT alternative for one reason: SenseVoice
      // is built for Chinese and English mixed inside a sentence, which is the
      // shape this project's input actually has.
      id: 'siliconflow',
      label: 'SiliconFlow',
      baseURL: SILICONFLOW,
      models: ['FunAudioLLM/SenseVoiceSmall'],
    },
  ],
  llm: [
    {
      id: 'deepseek',
      label: 'DeepSeek',
      baseURL: 'https://api.deepseek.com',
      models: ['deepseek-chat', 'deepseek-reasoner'],
    },
    {
      id: 'groq',
      label: 'Groq',
      baseURL: 'https://api.groq.com/openai/v1',
      // Groq's four, as its own catalogue lists them (checked 2026-09-20). The
      // first is the default a preset fills in, and it is the 70B rather than
      // the fastest of them on purpose: this product cannot work at all
      // without tool calling, and tool calling is the capability small models
      // lose first. Anybody chasing time-to-first-token can drop down the
      // list — the Mind check tells them immediately if they went too far,
      // because it asks for a tool call and not just an answer.
      models: [
        'llama-3.3-70b-versatile',
        'openai/gpt-oss-120b',
        'openai/gpt-oss-20b',
        'llama-3.1-8b-instant',
      ],
    },
    {
      id: 'openai',
      label: 'OpenAI',
      baseURL: 'https://api.openai.com/v1',
      models: ['gpt-4o-mini', 'gpt-4o'],
    },
    {
      id: 'siliconflow',
      label: 'SiliconFlow',
      baseURL: SILICONFLOW,
      models: ['deepseek-ai/DeepSeek-V3'],
    },
  ],
  tts: [
    {
      id: 'openai',
      label: 'OpenAI',
      baseURL: 'https://api.openai.com/v1',
      models: ['tts-1', 'tts-1-hd'],
      // §11.1 fixes ONE multilingual voice rather than switching per language,
      // so these lists are "which voice", never "which voice for which
      // language". OpenAI's names stand on their own, so both models share
      // them.
      voices: {
        'tts-1': ['alloy', 'nova', 'shimmer'],
        'tts-1-hd': ['alloy', 'nova', 'shimmer'],
      },
    },
    {
      id: 'siliconflow',
      label: 'SiliconFlow',
      baseURL: SILICONFLOW,
      models: ['fishaudio/fish-speech-1.5', 'FunAudioLLM/CosyVoice2-0.5B'],
      voices: {
        'fishaudio/fish-speech-1.5': prefixed('fishaudio/fish-speech-1.5'),
        'FunAudioLLM/CosyVoice2-0.5B': prefixed('FunAudioLLM/CosyVoice2-0.5B'),
      },
    },
  ],
};

/**
 * The voices a layer can use as it is configured right now.
 *
 * Takes the model, not just the preset, because that is the whole reason this
 * table is shaped the way it is: on SiliconFlow the speaker names carry the
 * model name, and a voice list that ignored the model would offer eight names
 * that all belong to some other model.
 *
 * @param {Preset | null} preset
 * @param {string} model
 * @returns {string[]}
 */
export function voicesFor(preset, model) {
  return preset?.voices?.[model] ?? [];
}

/**
 * Which preset a stored layer came from, or `custom`.
 *
 * Matched on baseURL alone. The model is not part of the identity: somebody
 * who picked Groq and then typed a model this list has never heard of is still
 * on Groq, and demoting them to `custom` would blank the dropdown they chose.
 *
 * @param {LayerName} layer
 * @param {{ baseURL: string }} cfg
 * @returns {string}
 */
export function presetIdFor(layer, cfg) {
  const url = cfg.baseURL.trim().replace(/\/+$/, '');
  if (!url) return CUSTOM;
  const hit = PRESETS[layer].find(
    (p) => p.baseURL.replace(/\/+$/, '') === url);
  return hit ? hit.id : CUSTOM;
}

/**
 * @param {LayerName} layer
 * @param {string} id
 * @returns {Preset | null} null for `custom`, and for an id that has since
 *   been removed from the list — both mean "there is nothing to fill in for
 *   you", which is exactly how custom behaves.
 */
export function presetById(layer, id) {
  return PRESETS[layer].find((p) => p.id === id) ?? null;
}
