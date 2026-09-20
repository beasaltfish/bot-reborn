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
 * @typedef {{
 *   id: string,
 *   label: string,
 *   baseURL: string,
 *   models: string[],
 *   voices?: string[],
 * }} Preset
 */

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
      models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    },
    {
      id: 'openai',
      label: 'OpenAI',
      baseURL: 'https://api.openai.com/v1',
      models: ['gpt-4o-mini', 'gpt-4o'],
    },
  ],
  tts: [
    {
      id: 'openai',
      label: 'OpenAI',
      baseURL: 'https://api.openai.com/v1',
      models: ['tts-1', 'tts-1-hd'],
      // §11.1 fixes ONE multilingual voice rather than switching per language,
      // so this list is "which voice", never "which voice for which language".
      voices: ['alloy', 'nova', 'shimmer'],
    },
  ],
};

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
