import { useEffect, useState } from 'react';
import { api } from './api';
import { presetById } from '../../core/provider-presets.js';
import { t } from './i18n';
import type { Endpoint, LayerName, Summary } from './types';

// Copies a provider from another character, key included. Two choices: the
// character, then one of its providers that this layer can use. The layer
// picks it up through onPick, the same as choosing it from the list.
export function CopyProvider({ id, layer, onPick }: { id: string; layer: LayerName; onPick(e: Endpoint): void }) {
  const [others, setOthers] = useState<Summary[]>([]);
  const [from, setFrom] = useState('');
  const [entries, setEntries] = useState<Endpoint[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.list().then((l) => { if (live) setOthers(l.filter((s) => s.id !== id)); }, () => {});
    return () => { live = false; };
  }, [id]);

  if (!others.length) return null;
  return (
    <div className="copy-provider">
      <label>{t('copyProviderFrom')}
        <select
          aria-label={t('copyProviderFrom')}
          value={from}
          onChange={async (e) => {
            const next = e.target.value;
            setFrom(next);
            setEntries(null);
            setNote(null);
            if (!next) return;
            try {
              const other = await api.get(next);
              // A preset this layer cannot use is not offered; a custom one is.
              const usable = other.endpoints.filter((x) => x.custom || presetById(layer, x.id));
              setEntries(usable);
              if (!usable.length) setNote(t('copyProviderNone'));
            } catch (err) {
              setNote((err as Error).message);
            }
          }}
        >
          <option value="">{t('copyKeyPick')}</option>
          {others.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      {entries && entries.length > 0 && (
        <label>{t('copyProviderPick')}
          <select
            aria-label={t('copyProviderPick')}
            value=""
            onChange={(e) => {
              const picked = entries.find((x) => x.id === e.target.value);
              setFrom('');
              setEntries(null);
              if (picked) onPick(picked);
            }}
          >
            <option value="">{t('copyProviderPick')}</option>
            {entries.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
      )}
      {note && <small role="status">{note}</small>}
    </div>
  );
}
