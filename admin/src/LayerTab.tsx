import { useState } from 'react';
import { PRESETS, orderForPicker, presetById, voicesFor } from '../../core/provider-presets.js';
import { MAX_CUSTOM, addressOf, entryOf, newCustomId, pickModel, pickProvider, syncLayers, usersOf } from './layerEdit';
import { CopyProvider } from './CopyProvider';
import { t } from './i18n';
import type { CheckFn } from './checks';
import type { Config, Endpoint, LayerConfig, LayerName, Patch } from './types';

// The picker's choice that opens the form for a new custom provider.
const NEW = '__new__';

const hostOf = (u: string) => {
  try { return new URL(u).host; } catch { return u; }
};

export function LayerTab({ id, layer, config, endpoints, update, check }: {
  id: string;
  layer: LayerName;
  config: Config;
  endpoints: Endpoint[];
  update(p: Patch): void;
  check: CheckFn;
}) {
  const cfg = config[layer];
  // The layer's provider is an entry: a preset's, or one the user made.
  const selected = entryOf(endpoints, cfg.endpointId);
  const preset = selected && !selected.custom ? presetById(layer, selected.id) : null;
  const listed = Boolean(preset) && !preset?.openModels;
  const customs = endpoints.filter((e) => e.custom);
  const [freeModel, setFreeModel] = useState(() => !listed || !preset?.models.includes(cfg.model));
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // The form for a custom provider: 'new' makes one, 'edit' changes the selected one.
  const [form, setForm] = useState<'new' | 'edit' | null>(null);
  const [draft, setDraft] = useState({ name: '', baseURL: '' });
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<LayerConfig>) => update({ config: { [layer]: p } });
  const voices = voicesFor(preset, cfg.model);
  // "Other" is open when it was picked, or when the stored voice is not one
  // the list has — a typed-in id must never be swapped for the default.
  const [freeVoice, setFreeVoice] = useState(false);
  const otherVoice = freeVoice || (Boolean(cfg.voice) && !voices.includes(cfg.voice ?? ''));

  // Changes one entry's fields, and every layer that uses it follows.
  const changeEntry = (entryId: string, change: Partial<Endpoint>) => {
    const next = endpoints.map((e) => (e.id === entryId ? { ...e, ...change } : e));
    update({ endpoints: next, config: syncLayers(config, next) });
  };

  // The layer uses this entry now. `list` is the providers after this edit.
  const use = (e: Endpoint, list: Endpoint[]) => {
    const made = list === endpoints ? {} : { endpoints: list };
    if (e.custom || !presetById(layer, e.id)) {
      setFreeModel(true);
      setFreeVoice(false);
      update({ ...made, config: { [layer]: { endpointId: e.id, baseURL: e.baseURL, apiKey: e.apiKey } } });
      return;
    }
    const r = pickProvider(layer, cfg, e.id);
    setFreeModel(r.freeModel);
    setFreeVoice(false);
    update({ ...made, config: { [layer]: { ...r.patch, endpointId: e.id, baseURL: e.baseURL, apiKey: e.apiKey } } });
  };

  const pickFrom = (value: string) => {
    if (value === NEW) {
      setDraft({ name: '', baseURL: '' });
      setError(null);
      setForm('new');
      return;
    }
    setForm(null);
    const p = presetById(layer, value);
    if (p) {
      // A preset's entry is made the first time it is picked; its address is the preset's.
      const e = entryOf(endpoints, p.id) ?? { id: p.id, name: p.label, baseURL: p.baseURL, apiKey: '' };
      use(e, endpoints.some((x) => x.id === p.id) ? endpoints : [...endpoints, e]);
      return;
    }
    const e = entryOf(endpoints, value);
    if (e) use(e, endpoints);
  };

  // A provider copied from another character: the same one here takes its key
  // (a preset by id, a custom one by address); otherwise it is added. Then it is used.
  const copyFrom = (source: Endpoint) => {
    const mine = endpoints.find((x) => x.id === source.id)
      ?? (source.custom ? endpoints.find((x) => x.custom && addressOf(x.baseURL) === addressOf(source.baseURL)) : undefined);
    if (mine) {
      const filled = { ...mine, apiKey: source.apiKey };
      use(filled, endpoints.map((x) => (x.id === mine.id ? filled : x)));
      return;
    }
    if (source.custom && customs.length >= MAX_CUSTOM) {
      setError(t('endpointLimit'));
      return;
    }
    const preset = presetById(layer, source.id);
    const added: Endpoint = source.custom
      ? { ...source, id: endpoints.some((x) => x.id === source.id) ? newCustomId() : source.id }
      : { id: source.id, name: preset?.label ?? source.name, baseURL: preset?.baseURL ?? source.baseURL, apiKey: source.apiKey };
    setError(null);
    use(added, [...endpoints, added]);
  };

  const save = () => {
    const name = draft.name.trim();
    const url = addressOf(draft.baseURL);
    if (!name) return setError(t('endpointNeedsName'));
    if (!/^https?:\/\/\S+$/.test(url)) return setError(t('badUrl'));
    if (form === 'new') {
      if (customs.length >= MAX_CUSTOM) return setError(t('endpointLimit'));
      const e: Endpoint = { id: newCustomId(), name, baseURL: url, apiKey: '', custom: true };
      update({ endpoints: [...endpoints, e], config: { [layer]: { endpointId: e.id, baseURL: url, apiKey: '' } } });
    } else if (selected) {
      changeEntry(selected.id, { name, baseURL: url });
    }
    setError(null);
    setForm(null);
  };

  const remove = () => {
    if (!selected) return;
    const users = usersOf(config, selected.id).join(', ');
    if (!window.confirm(`${t('confirmDeleteEndpoint')} ${users}`)) return;
    const next = endpoints.filter((e) => e.id !== selected.id);
    update({ endpoints: next, config: syncLayers(config, next) });
    setForm(null);
  };

  return (
    <div className="fields">
      <label>{t('provider')}
        <select aria-label={t('provider')} value={selected?.id ?? ''} onChange={(e) => pickFrom(e.target.value)}>
          <option value="">{t('pickProvider')}</option>
          {orderForPicker(PRESETS[layer]).map((p) => (
            <option key={p.id} value={p.id}>
              {p.region ? `${p.label} · ${t(p.region === 'cn' ? 'regionCn' : 'regionGlobal')}` : p.label}
            </option>
          ))}
          {customs.length > 0 && (
            <optgroup label={t('customProviders')}>
              {customs.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </optgroup>
          )}
          <option value={NEW}>{t('addCustom')}</option>
        </select>
      </label>
      {selected
        ? <p className="hint">{hostOf(selected.baseURL)}</p>
        : <p className="hint">{t('pickProviderHint')}</p>}
      {selected?.custom && !form && (
        <button type="button" onClick={() => { setDraft({ name: selected.name, baseURL: selected.baseURL }); setError(null); setForm('edit'); }}>
          {t('endpointEdit')}
        </button>
      )}
      {form && (
        <div className="endpoint-form">
          <label>{t('endpointName')}
            <input aria-label={t('endpointName')} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label>{t('baseUrl')}
            <input aria-label={t('baseUrl')} value={draft.baseURL} placeholder="https://…" onChange={(e) => setDraft({ ...draft, baseURL: e.target.value })} />
          </label>
          {error && <p role="alert" className="error">{error}</p>}
          <button type="button" onClick={save}>{t('endpointSave')}</button>
          <button type="button" onClick={() => setForm(null)}>{t('cancel')}</button>
          {form === 'edit' && selected && <button type="button" className="danger" onClick={remove}>{t('endpointDelete')}</button>}
        </div>
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
            <select
              aria-label={t('voice')}
              value={otherVoice ? '' : cfg.voice || voices[0]}
              onChange={(e) => {
                const v = e.target.value;
                setFreeVoice(v === '');
                if (v) set({ voice: v });
              }}
            >
              {voices.map((v) => <option key={v} value={v}>{preset?.voiceLabels?.[v] ?? v}</option>)}
              <option value="">{t('custom')}</option>
            </select>
          ) : (
            <input aria-label={t('voice')} value={cfg.voice ?? ''} onChange={(e) => set({ voice: e.target.value })} />
          )}
        </label>
      )}
      {layer === 'tts' && voices.length > 0 && otherVoice && (
        <label>{t('voiceName')}
          <input aria-label={t('voiceName')} value={cfg.voice ?? ''} onChange={(e) => set({ voice: e.target.value })} />
          {preset?.voicesURL && <a href={preset.voicesURL} target="_blank" rel="noreferrer">{t('voicesLink')}</a>}
        </label>
      )}
      <label>{t('key')}
        <input
          aria-label={t('key')}
          type="password"
          autoComplete="off"
          value={selected?.apiKey ?? ''}
          disabled={!selected}
          placeholder="sk-…"
          onChange={(e) => selected && changeEntry(selected.id, { apiKey: e.target.value })}
        />
      </label>
      <CopyProvider id={id} layer={layer} onPick={copyFrom} />
      {error && !form && <p role="alert" className="error">{error}</p>}
      {layer !== 'reflex' && (
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
      )}
    </div>
  );
}
