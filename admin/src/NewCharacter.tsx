import { useEffect, useState } from 'react';
import { api } from './api';
import { providerLayers } from './layerEdit';
import { t } from './i18n';
import type { Detail, Summary } from './types';

export function NewCharacter(props: { onCreated(d: Detail): void; onCancel?(): void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sources, setSources] = useState<Summary[]>([]);
  const [from, setFrom] = useState('');

  useEffect(() => {
    let live = true;
    api.list().then((l) => { if (live) setSources(l); }, () => {});
    return () => { live = false; };
  }, []);

  return (
    <form
      className="new-character"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const made = await api.create(name.trim());
          // The providers the character picked uses now, and every provider it has, with its key.
          const d = from ? await api.get(from) : null;
          props.onCreated(d ? await api.patch(made.id, { config: providerLayers(d.config), endpoints: d.endpoints }) : made);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <input autoFocus value={name} placeholder={t('namePlaceholder')} onChange={(e) => setName(e.target.value)} />
      {sources.length > 0 && (
        <label>{t('newCopyFrom')}
          <select aria-label={t('newCopyFrom')} value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">{t('newCopyNone')}</option>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      )}
      <button type="submit" disabled={busy || !name.trim()}>{t('create')}</button>
      {props.onCancel && <button type="button" onClick={props.onCancel}>{t('cancel')}</button>}
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  );
}
