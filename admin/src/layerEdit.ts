// What picking a provider or a model does to a layer — the same rules as the
// phone's setup sheet (phone/setup-sheet.js), as functions the page can test.
import { CUSTOM, orderForPicker, presetById, voicesFor } from '../../core/provider-presets.js';
import type { Config, DeepPartial, Endpoint, LayerConfig, LayerName } from './types';

type Preset = NonNullable<ReturnType<typeof presetById>>;

/** Only the fields that change, so the save sends only those. */
export function pickProvider(layer: LayerName, cfg: LayerConfig, id: string):
  { patch: Partial<LayerConfig>; freeModel: boolean } {
  const preset = id === CUSTOM ? null : presetById(layer, id);
  if (!preset) return { patch: {}, freeModel: true };
  const patch: Partial<LayerConfig> = {};
  if (cfg.baseURL !== preset.baseURL) patch.baseURL = preset.baseURL;
  const model = preset.models.includes(cfg.model) ? cfg.model : (preset.models[0] ?? cfg.model);
  if (model !== cfg.model) patch.model = model;
  // On some providers a voice belongs to one model; a provider that cannot
  // supply the stored voice has invalidated it.
  const voices = voicesFor(preset, model);
  if (voices.length && !voices.includes(cfg.voice ?? '')) patch.voice = voices[0];
  return { patch, freeModel: !preset.models.includes(model) };
}

export function pickModel(preset: Preset | null, cfg: LayerConfig, model: string): Partial<LayerConfig> {
  const patch: Partial<LayerConfig> = { model };
  const voices = voicesFor(preset, model);
  if (voices.length && !voices.includes(cfg.voice ?? '')) {
    // Keep the speaker if the new model has one by the same name.
    const speaker = (cfg.voice ?? '').split(':').pop();
    patch.voice = voices.find((v) => v.endsWith(`:${speaker}`)) ?? voices[0];
  }
  return patch;
}

export { orderForPicker };

const LAYERS: LayerName[] = ['stt', 'llm', 'tts', 'reflex'];

/** Custom providers one character may have. Also checked by server/endpoints.js. */
export const MAX_CUSTOM = 50;

/** The address as it is stored: no trailing slash. */
export const addressOf = (u: string) => u.trim().replace(/\/+$/, '');

/** A new custom provider's id. Random, so two characters' ids never have to agree. */
export const newCustomId = () => `ep-${Math.random().toString(16).slice(2, 10)}`;

/** The entry a layer points at, or undefined. */
export const entryOf = (endpoints: Endpoint[], id: string | undefined) =>
  (id ? endpoints.find((e) => e.id === id) : undefined);

/** The layers that point at an entry, for the delete warning. */
export function usersOf(config: Config, id: string): LayerName[] {
  return LAYERS.filter((l) => config[l].endpointId === id);
}

/**
 * The config that follows the entries: every layer that points at an entry
 * takes its address and key from it; a layer whose entry is gone points at
 * nothing, and is blank until it is picked again. Only changed fields are set.
 */
export function syncLayers(config: Config, endpoints: Endpoint[]): DeepPartial<Config> {
  const out: DeepPartial<Config> = {};
  for (const l of LAYERS) {
    const cur = config[l];
    if (!cur.endpointId) continue;
    const e = entryOf(endpoints, cur.endpointId);
    const next = e
      ? { baseURL: e.baseURL, apiKey: e.apiKey }
      : { endpointId: '', baseURL: '', apiKey: '' };
    const patch: Partial<LayerConfig> = {};
    for (const k of Object.keys(next) as Array<keyof typeof next>) {
      if (cur[k] !== next[k]) patch[k] = next[k];
    }
    if (Object.keys(patch).length) (out as any)[l] = patch;
  }
  return out;
}

/** The key another character has for the same address, or ''. */
export function keyCopyFor(endpoints: Endpoint[], baseURL: string): string {
  const a = addressOf(baseURL);
  if (!a) return '';
  return endpoints.find((e) => addressOf(e.baseURL) === a && e.apiKey)?.apiKey ?? '';
}

/**
 * What a new character copies from another one: which provider each layer
 * uses, the address and key it had, and the provider list itself. The prompt
 * and the reflex question are the character's own, so they are left out.
 */
export function providerLayers(config: Config): DeepPartial<Config> {
  const pick = (l: LayerConfig) => ({ endpointId: l.endpointId ?? '', baseURL: l.baseURL, model: l.model, apiKey: l.apiKey });
  return {
    stt: pick(config.stt),
    llm: pick(config.llm),
    tts: { ...pick(config.tts), voice: config.tts.voice },
    reflex: pick(config.reflex),
  };
}
