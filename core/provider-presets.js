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
// was typed. A config assembled on dev.html by hand loads back into these
// rows as `custom` if it matches no preset, and still works.
//
// The endpoints and the two default models are the ones spec §8.3 chose and
// dev.html has been carrying as placeholders since it was written. Anything
// this list gets wrong is fixable by picking `custom`, which is why the list
// can afford to be short.
//
// It can afford to be short and cannot afford to be aspirational. A model an
// ordinary key cannot reach answers 404 "no such model", and on a sheet whose
// only typed field is the key, that reads as a bad key — the exact failure the
// dropdowns exist to prevent. Only list what a new account can actually call.
//
// The one thing it must not do is narrow the project to its author. This is an
// open-source robot; the decisions in the spec about Chinese and English mixed
// in one sentence are decisions about THIS robot's own user, and a provider is
// not disqualified for failing to serve that user as long as it serves some
// user completely. The hard requirement is the wire format: a provider can be
// listed only if there is an adapter that speaks it. Most rows are
// OpenAI-compatible; a row with its own API shape says so in `api`, and the
// brain picks the adapter by it (server/providers/pick.js).

/**
 * `reflex` is listed here so both the setup sheet and the instrument page
 * offer it from the same table (reflex spec §7).
 * @typedef {'stt' | 'llm' | 'tts' | 'reflex'} LayerName
 */

/** @typedef {'openai' | 'volcengine'} ProviderApi */

/**
 * `region` is set only on a provider that runs two sites, mainland China and
 * global, whose keys refuse each other. Each site is its own row, because
 * rows are told apart by address; the label says which site it is.
 *
 * `voices` is keyed by model id, not held once per provider, because on some
 * providers the voice name contains the model name: SiliconFlow's speakers are
 * spelled `<model>:<speaker>`, so changing the model invalidates every voice
 * in the list. OpenAI's do not, and its two models simply share one array.
 *
 * `api` names the adapter for a row that is not OpenAI-compatible; absent
 * means it is. `voiceLabels` gives a voice id the name the dropdown shows —
 * a voice without one shows its id. `voicesURL` is the provider's own full
 * list, linked beside the field where somebody types a voice by hand.
 * `maxInput` is the most characters one TTS request may carry; a longer reply
 * is spoken in pieces (tts-openai.js) rather than refused.
 *
 * @typedef {{
 *   id: string,
 *   label: string,
 *   baseURL: string,
 *   models: string[],
 *   openModels?: boolean,
 *   voices?: Record<string, string[]>,
 *   voiceLabels?: Record<string, string>,
 *   voicesURL?: string,
 *   body?: Record<string, unknown>,
 *   region?: 'cn' | 'global',
 *   api?: ProviderApi,
 *   maxInput?: number,
 * }} Preset
 */

/** The eight speakers SiliconFlow gives every one of its TTS models. */
const SPEAKERS = ['alex', 'anna', 'bella', 'benjamin', 'charles', 'claire', 'david', 'diana'];

/** @param {string} model @returns {string[]} */
const prefixed = (model) => SPEAKERS.map((s) => `${model}:${s}`);

const SILICONFLOW = 'https://api.siliconflow.com/v1';

// Volcengine's speech service (豆包语音) answers on one host for both layers,
// with the resource id — written here as the model — in a header. Mainland
// only, so no `region`: that field marks one of a pair of sites.
const VOLCENGINE = 'https://openspeech.bytedance.com';

/**
 * Only 2.0 (`uranus`) voices: the 1.0 ones (`mars`/`moon`) are believed not to
 * synthesise on seed-tts-2.0, and whether the `ICL_` ones need enabling first
 * is unknown. Either kind can still be typed under "Other". First is default.
 * @type {Record<string, string>}
 */
const VOLCENGINE_VOICES = {
  zh_female_xiaohe_uranus_bigtts: '小何 2.0',
  zh_female_vv_uranus_bigtts: 'Vivi 2.0',
  zh_male_m191_uranus_bigtts: '云舟 2.0',
  zh_male_taocheng_uranus_bigtts: '小天 2.0',
  zh_male_naiqimengwa_uranus_bigtts: '奶气萌娃 2.0',
  en_male_tim_uranus_bigtts: 'Tim',
};
const SILICONFLOW_CN = 'https://api.siliconflow.cn/v1';

/**
 * Mainland addresses of the providers that run a second site, by the id of
 * the global row: its own address and its own keys, and otherwise the global
 * row's catalogue unless a layer says different.
 * @type {Record<string, { baseURL: string, layers?: Partial<Record<LayerName, Partial<Preset>>> }>}
 */
const MAINLAND = {
  siliconflow: {
    baseURL: SILICONFLOW_CN,
    layers: {
      // The .cn catalogue is its own, and a lot fresher. Each of these was
      // checked against its /models list and answered a tool call, 2026-10-17.
      // Off, thinking roughly halves the wait for the first word; GLM ignores
      // the flag and stays quick either way.
      llm: {
        models: [
          'deepseek-ai/DeepSeek-V4-Flash',
          'Qwen/Qwen3.6-35B-A3B',
          'zai-org/GLM-5.3-Flash',
          'Pro/moonshotai/Kimi-K2.6',
        ],
        body: { enable_thinking: false },
      },
    },
  },
  moonshot: { baseURL: 'https://api.moonshot.cn/v1' },
  dashscope: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  zhipu: { baseURL: 'https://open.bigmodel.cn/api/paas/v4' },
};

/**
 * Puts each mainland row right under its global twin, so the dropdown shows
 * the pair together.
 * @param {Record<LayerName, Preset[]>} presets
 * @returns {Record<LayerName, Preset[]>}
 */
function withMainland(presets) {
  return /** @type {Record<LayerName, Preset[]>} */ (Object.fromEntries(
    Object.entries(presets).map(([layer, list]) => [layer, list.flatMap((p) => {
      const site = MAINLAND[p.id];
      if (!site) return [p];
      const own = site.layers?.[/** @type {LayerName} */ (layer)];
      return [p, { ...p, ...own, id: `${p.id}-cn`, baseURL: site.baseURL, region: /** @type {const} */ ('cn') }];
    })])));
}

/** The id every layer falls back to: nothing filled in, every field typed. */
export const CUSTOM = 'custom';

/** @type {Record<LayerName, Preset[]>} */
export const PRESETS = withMainland({
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
      // gpt-transcribe (2026-07) replaced whisper-1 as OpenAI's recommended
      // recogniser. It answers plain JSON only, which stt-openai-compat.js
      // knows; a layer still saved on whisper-1 keeps working.
      models: ['gpt-transcribe'],
    },
    {
      // Spec §8.3 names it as the STT alternative for one reason: SenseVoice
      // is built for Chinese and English mixed inside a sentence, which is the
      // shape this project's input actually has.
      id: 'siliconflow',
      label: 'SiliconFlow',
      baseURL: SILICONFLOW,
      models: ['FunAudioLLM/SenseVoiceSmall'],
      region: 'global',
    },
    {
      // 一句话识别 in whole-sentence mode (`bigmodel_nostream`), 2.0 only.
      // Hourly first: it needs no concurrency bought ahead. Not the flash
      // recogniser any more — Volcengine moved it to 历史文档, and it is 1.0.
      id: 'volcengine',
      label: 'Volcengine 火山引擎',
      baseURL: VOLCENGINE,
      models: ['volc.seedasr.sauc.duration', 'volc.seedasr.sauc.concurrent'],
      api: 'volcengine',
    },
  ],
  llm: [
    {
      id: 'deepseek',
      label: 'DeepSeek',
      baseURL: 'https://api.deepseek.com',
      // The 2026-09 names. deepseek-chat and deepseek-reasoner are legacy
      // aliases now — the non-thinking and thinking halves of an older Flash —
      // and reasoner, being thinking-only, was never one to offer here.
      models: ['deepseek-flash', 'deepseek-v4-pro'],
      // Both models think by default, at high effort, and every second of it
      // is spent before the robot can say a word or move the car. A toy
      // answering out loud wants the answer, not the deliberation; the tool
      // calls it makes are simple enough not to need it. OpenAI-format
      // spelling — the Anthropic endpoint spells it differently.
      body: { thinking: { type: 'disabled' } },
    },
    {
      id: 'groq',
      label: 'Groq',
      baseURL: 'https://api.groq.com/openai/v1',
      // Groq's two llama models are Enterprise-only — their catalogue prices
      // them at "Contact Sales", and an ordinary key gets 404 "no such model",
      // which reads as a broken setup rather than as a plan you are not on.
      // They are not here for exactly the reason this list exists; anybody
      // with that contract can type the name under "Other".
      //
      // Between the two that remain, the 120B is first because tool calling is
      // the capability smaller models lose first and this product cannot work
      // without it. The 20B is one line down for anybody chasing
      // time-to-first-token, and the Mind check answers whether they went too
      // far, because it asks for a tool call and not merely an answer.
      models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
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
      region: 'global',
    },
    {
      // Kimi. Moonshot runs two platforms — api.moonshot.ai and
      // api.moonshot.cn — and a key from one is refused by the other, exactly
      // like SiliconFlow's pair; the mainland one is its own row.
      //
      // NOT moonshot-v1-*: that whole series was retired on 2026-08-31 and now
      // answers 404, which on this sheet reads as a broken key.
      id: 'moonshot',
      label: 'Moonshot (Kimi)',
      baseURL: 'https://api.moonshot.ai/v1',
      models: ['kimi-k3', 'kimi-k2.6'],
      region: 'global',
    },
    {
      // Z.ai is Zhipu's global platform; open.bigmodel.cn is the mainland one,
      // with its own console and its own keys.
      id: 'zhipu',
      label: 'Zhipu (GLM)',
      baseURL: 'https://api.z.ai/api/paas/v4',
      models: ['glm-4.7-flash', 'glm-4.7'],
      region: 'global',
    },
    {
      // Alibaba Model Studio, international endpoint. The mainland one is
      // dashscope.aliyuncs.com without the -intl, and the keys are again not
      // interchangeable.
      id: 'dashscope',
      label: 'Alibaba (Qwen)',
      baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      models: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
      region: 'global',
    },
    {
      // Address known, model yours to name. A dropdown exists to fill in the
      // value that is the same for everybody on a provider; OpenRouter's model
      // is a real choice among hundreds, so a dropdown there stops being a
      // default and becomes a browser — and a four-hundred-row select on a
      // phone is worse than a text box. Only the half that is identical for
      // everybody is filled in.
      //
      // Their /api/v1/models is public and reports which models accept tools,
      // which is the one argument for fetching the list instead. That belongs
      // to a picker with a search box in it, not to this select, and it is not
      // what stands between somebody and their first turn of the wheels.
      id: 'openrouter',
      label: 'OpenRouter',
      baseURL: 'https://openrouter.ai/api/v1',
      models: [],
      openModels: true,
    },
  ],
  tts: [
    {
      id: 'openai',
      label: 'OpenAI',
      baseURL: 'https://api.openai.com/v1',
      // gpt-4o-mini-tts is OpenAI's recommended one; it goes last so a new
      // character keeps starting on tts-1. marin and cedar, OpenAI's best,
      // are not in the tts-1 family's voice list (docs read 2026-10-19).
      models: ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'],
      // §11.1 fixes ONE voice rather than switching per language, so these
      // lists are "which voice", never "which voice for which language".
      //
      // That rule picks a MULTILINGUAL voice for this robot, because its own
      // user speaks Chinese and English in one breath and a voice that guesses
      // wrong loses half a sentence. It is not an entry requirement for this
      // table. Somebody who will only ever speak English to their robot is
      // well served by an English-only provider, and keeping one out on the
      // strength of a decision made for a different user is the same mistake
      // as testing that user's setup with a code-switching clip.
      //
      // OpenAI's names stand on their own, so the tts-1 models share them.
      voices: {
        'tts-1': ['alloy', 'nova', 'shimmer'],
        'tts-1-hd': ['alloy', 'nova', 'shimmer'],
        'gpt-4o-mini-tts': ['marin', 'cedar', 'alloy', 'nova', 'shimmer'],
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
      region: 'global',
    },
    {
      // English only (Orpheus by Canopy Labs; the Saudi Arabic model is left
      // out). WAV is its only format, which is what tts-openai.js asks for.
      // 200 characters a request, so a longer reply goes in pieces.
      id: 'groq',
      label: 'Groq',
      baseURL: 'https://api.groq.com/openai/v1',
      models: ['canopylabs/orpheus-v1-english'],
      voices: { 'canopylabs/orpheus-v1-english': ['hannah', 'autumn', 'diana', 'austin', 'daniel', 'troy'] },
      maxInput: 200,
    },
    {
      id: 'volcengine',
      label: 'Volcengine 火山引擎',
      baseURL: VOLCENGINE,
      models: ['seed-tts-2.0'],
      voices: { 'seed-tts-2.0': Object.keys(VOLCENGINE_VOICES) },
      voiceLabels: VOLCENGINE_VOICES,
      // Chinese only; finding a voice needs nothing more than copying its id.
      voicesURL: 'https://docs.volcengine.com/docs/DoubaoVoice/Tonelist-1',
      api: 'volcengine',
    },
  ],
  reflex: [
    {
      // JEV is not OpenAI-compatible — it answers typed questions at
      // /systemone, not chat — which is why it is its own layer with its own
      // client (reflex.js) rather than an LLM row. OpenRouter serves it at the
      // same address as everything else it serves.
      id: 'openrouter',
      label: 'OpenRouter',
      baseURL: 'https://openrouter.ai/api/v1',
      models: ['jev-1.13'],
    },
  ],
});

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
 * Which adapter a layer needs. Found by address like the preset itself, so a
 * layer typed by hand under "Other" that points at a known service still gets
 * that service's adapter; anything unknown is OpenAI-compatible.
 *
 * @param {LayerName} layer
 * @param {{ baseURL: string }} cfg
 * @returns {ProviderApi}
 */
export function presetApi(layer, cfg) {
  return presetById(layer, presetIdFor(layer, cfg))?.api ?? 'openai';
}

/**
 * Fields a provider needs in every request beyond the standard ones.
 *
 * Found by address, the same way the setup sheet finds the preset, so a layer
 * typed by hand under "Other" gets them too if it points at the same service.
 * Everybody else gets nothing: a field a provider never defined is at best
 * ignored and at worst a 400.
 *
 * @param {LayerName} layer
 * @param {{ baseURL: string }} cfg
 * @returns {Record<string, unknown>}
 */
export function presetBody(layer, cfg) {
  return presetById(layer, presetIdFor(layer, cfg))?.body ?? {};
}

/**
 * The most characters one request may carry, found by address like the
 * preset; null when the provider sets no limit this list knows of.
 * @param {LayerName} layer
 * @param {{ baseURL: string }} cfg
 * @returns {number | null}
 */
export function presetMaxInput(layer, cfg) {
  return presetById(layer, presetIdFor(layer, cfg))?.maxInput ?? null;
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

/**
 * The dropdown's order: providers alphabetical by name, a mainland row always
 * right after its global twin, and the custom choice is added by the caller.
 * @template {{ id: string, label: string, region?: 'cn' | 'global' }} T
 * @param {T[]} list
 * @returns {T[]}
 */
export function orderForPicker(list) {
  /** @type {Map<string, T[]>} */ const groups = new Map();
  for (const p of list) {
    const key = p.id.replace(/-cn$/, '');
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const name = (/** @type {T[]} */ g) => (g.find((p) => !p.region) ?? g[0]).label;
  return [...groups.values()]
    .sort((a, b) => name(a).localeCompare(name(b)))
    .flatMap((g) => [...g].sort((a, b) => Number(a.region === 'cn') - Number(b.region === 'cn')));
}


/**
 * Where a new character starts on each layer: OpenAI for ears, mind and
 * voice, so one key fills three layers, and its voices speak more than
 * English (Groq, first by name, does not). Reflex has no OpenAI row and starts
 * on the first the dropdown shows.
 * @type {Partial<Record<LayerName, string>>}
 */
const STARTING = { stt: 'openai', llm: 'openai', tts: 'openai' };

/**
 * @param {LayerName} layer
 * @returns {Preset | null}
 */
export function startingPreset(layer) {
  const id = STARTING[layer];
  return (id ? presetById(layer, id) : null) ?? orderForPicker(PRESETS[layer])[0] ?? null;
}
