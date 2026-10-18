import { useState } from 'react';
import { api } from './api';
import { t } from './i18n';

// The token is not shown here: the phone's address on PhoneLink carries it,
// and a second copy on screen only makes two places to keep in step. What is
// left is the one thing a person needs to do with it: replace it.
export function TokenBox({ id, onToken }: { id: string; onToken(token: string): void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="token">
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
