import { useState } from 'react';
import { CUSTOM, PRESETS, presetById, presetIdFor, voicesFor } from '../../web/provider-presets.js';
import { pickModel, pickProvider } from './layerEdit';
import { t } from './i18n';
import type { CheckFn } from './checks';
import type { Config, LayerConfig, LayerName, Patch } from './types';

export function LayerTab({ layer, config, update, check }: {
  layer: LayerName;
  config: Config;
  update(p: Patch): void;
  check: CheckFn;
}) {
  const cfg = config[layer];
  const [presetId, setPresetId] = useState(() => presetIdFor(layer, cfg));
  const preset = presetById(layer, presetId);
  const listed = Boolean(preset) && !preset?.openModels;
  const [freeModel, setFreeModel] = useState(() => !listed || !preset?.models.includes(cfg.model));
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<LayerConfig>) => update({ config: { [layer]: p } });
  const voices = voicesFor(preset, cfg.model);

  return (
    <div className="fields">
      {layer === 'reflex' && <p className="hint">{t('optional')}</p>}
      <label>{t('provider')}
        <select
          aria-label={t('provider')}
          value={presetId}
          onChange={(e) => {
            const id = e.target.value;
            setPresetId(id);
            const r = pickProvider(layer, cfg, id);
            setFreeModel(r.freeModel);
            if (Object.keys(r.patch).length) set(r.patch);
          }}
        >
          {PRESETS[layer].map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          <option value={CUSTOM}>{t('custom')}</option>
        </select>
      </label>
      {!preset && (
        <label>{t('baseUrl')}
          <input aria-label={t('baseUrl')} value={cfg.baseURL} placeholder="https://…" onChange={(e) => set({ baseURL: e.target.value })} />
        </label>
      )}
      {listed && preset && (
        <label>{t('model')}
          <select
            aria-label={t('model')}
            value={freeModel ? '' : cfg.model}
            onChange={(e) => {
              const v = e.target.value;
              setFreeModel(v === '');
              if (v) set(pickModel(preset, cfg, v));
            }}
          >
            {preset.models.map((m) => <option key={m} value={m}>{m}</option>)}
            <option value="">{t('custom')}</option>
          </select>
        </label>
      )}
      {(!listed || freeModel) && (
        <label>{t('modelName')}
          <input aria-label={t('modelName')} value={cfg.model} onChange={(e) => set({ model: e.target.value })} />
        </label>
      )}
      {layer === 'tts' && (
        <label>{t('voice')}
          {voices.length ? (
            <select aria-label={t('voice')} value={cfg.voice || voices[0]} onChange={(e) => set({ voice: e.target.value })}>
              {voices.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          ) : (
            <input aria-label={t('voice')} value={cfg.voice ?? ''} onChange={(e) => set({ voice: e.target.value })} />
          )}
        </label>
      )}
      <label>{t('key')}
        <input
          aria-label={t('key')}
          type="password"
          autoComplete="off"
          value={cfg.apiKey}
          placeholder="sk-…"
          onChange={(e) => set({ apiKey: e.target.value })}
        />
      </label>
      <div className="test">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setResult(null);
            try {
              setResult({ ok: true, text: await check(layer, config) });
            } catch (err) {
              setResult({ ok: false, text: (err as Error).message });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? t('testing') : t('test')}
        </button>
        {result && <p role="status" className={result.ok ? 'result ok' : 'result bad'}>{result.text}</p>}
      </div>
    </div>
  );
}
