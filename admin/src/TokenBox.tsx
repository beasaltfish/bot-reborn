import { useState } from 'react';
import { api } from './api';
import { t } from './i18n';

export function TokenBox({ id, token, onToken }: { id: string; token: string; onToken(token: string): void }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="token">
      <span className="token-label">{t('token')}</span>
      <code data-testid="token">{shown ? token : '•'.repeat(16)}</code>
      <button type="button" onClick={() => setShown((s) => !s)}>{shown ? t('hide') : t('show')}</button>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(token);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? t('copied') : t('copy')}
      </button>
      <button
        type="button"
        onClick={async () => {
          // The confirm says what it costs: a body online with the old token
          // is disconnected (admin spec §5).
          if (!window.confirm(t('confirmRegenerate'))) return;
          try {
            onToken((await api.token(id)).token);
            setError(null);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        {t('regenerate')}
      </button>
      {error && <p role="alert" className="error">{error}</p>}
    </div>
  );
}
