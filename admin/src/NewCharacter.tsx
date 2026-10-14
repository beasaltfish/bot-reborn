import { useState } from 'react';
import { api } from './api';
import { t } from './i18n';
import type { Detail } from './types';

export function NewCharacter(props: { onCreated(d: Detail): void; onCancel?(): void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="new-character"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          props.onCreated(await api.create(name.trim()));
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <input autoFocus value={name} placeholder={t('namePlaceholder')} onChange={(e) => setName(e.target.value)} />
      <button type="submit" disabled={busy || !name.trim()}>{t('create')}</button>
      {props.onCancel && <button type="button" onClick={props.onCancel}>{t('cancel')}</button>}
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  );
}
