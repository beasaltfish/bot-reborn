// What picking a provider or a model does to a layer — the same rules as the
// phone's setup sheet (phone/setup-sheet.js), as functions the page can test.
import { CUSTOM, presetById, voicesFor } from '../../core/provider-presets.js';
import type { LayerConfig, LayerName } from './types';

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
