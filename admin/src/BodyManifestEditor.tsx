// The bench's half of a body, made editable: the pins a command may touch and
// the example actions that tell the model when to use them. It writes a new
// body, never over one that exists — an installed module is the repository's
// copy of the truth, and an edit of it belongs under a new name.
//
// Deliberately not a wiring editor: the ends of a bench wire are holes, not
// pins, so a pin change is a number in this table, not a drag on the canvas.
import { useState } from 'react';
import { labelOf } from '../../core/bodies.js';
import { t } from './i18n';
import type { BodyAction } from './types';

type Body = import('../../core/bodies.js').Body;
type Resource = { kind?: string, name: string, gpio?: number, direction?: string, safe?: number };

/** The manifest a save writes: what the brain runs plus what a person reads. */
type Manifest = {
  id: string,
  label: { en: string, zh: string },
  parts: string[],
  resources: Resource[],
  commands: any[],
  examples: BodyAction[],
  wiring?: any,
};

/**
 * @param {{ body: Body, resources: Resource[], commands: any[], actions: BodyAction[], wiring?: any, parts: string[] }} props
 */
export function BodyManifestEditor({ body, resources, commands, actions, wiring, parts }: {
  body: Body,
  resources: Resource[],
  commands: any[],
  actions: BodyAction[],
  wiring?: any,
  parts: string[],
}) {
  const seed = body.template ?? body.id;
  const [id, setId] = useState('');
  const [pins, setPins] = useState<Resource[]>(() => structuredClone(resources));
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A body with no example action is a body the model has no tool for; the save
  // says so before the brain has to.
  const examples = actions.filter((action) => Array.isArray(action.run) && action.run.length > 0);

  /** @param {number} index @param {number} gpio */
  const changePin = (index: number, gpio: number) => {
    setPins((rows) => rows.map((row, at) => (at === index ? { ...row, gpio } : row)));
  };

  const save = async () => {
    setFailure(null);
    setSaved(null);
    if (id.trim() === '') { setFailure(t('manifestNeedsId')); return; }
    if (examples.length === 0) { setFailure(t('manifestNeedsExample')); return; }
    const manifest: Manifest = {
      id: id.trim(),
      label: { en: labelOf(body, 'en'), zh: labelOf(body, 'zh') },
      parts: [...parts],
      resources: pins,
      commands,
      examples,
      ...(wiring ? { wiring } : {}),
    };
    setBusy(true);
    try {
      const res = await fetch('/api/bodies/save', {
        method: 'POST',
        headers: { 'X-Bot-Reborn': '1', 'Content-Type': 'application/json' },
        body: JSON.stringify(manifest),
      });
      const answer = await res.json().catch(() => ({}));
      if (!res.ok || typeof answer?.error === 'string') {
        setFailure(typeof answer?.error === 'string' ? answer.error : t('manifestSaveFailed'));
        return;
      }
      setSaved(answer.id ?? manifest.id);
    } catch {
      setFailure(t('manifestSaveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="body-manifest">
      <summary>{t('manifestTitle').replace('{body}', seed)}</summary>
      <p className="hint">{t('manifestHint')}</p>
      <label>
        {t('manifestId')}
        <input value={id} onChange={(e) => setId(e.target.value)} placeholder={`${seed}-mine`} />
      </label>
      {pins.map((pin, index) => (
        <div key={pin.name} className="manifest-pin">
          <span>{pin.name}</span>
          <label>
            {`${t('manifestGpio')} (${pin.name})`}
            <input
              type="number"
              min={0}
              max={48}
              value={pin.gpio ?? 0}
              onChange={(e) => changePin(index, Number(e.target.value))}
            />
          </label>
          <span className="hint">{pin.direction === 'output' ? t('manifestOutput') : t('manifestInput')}</span>
        </div>
      ))}
      <p className="hint">{t('manifestExamples').replace('{n}', String(examples.length))}</p>
      {failure && <p className="error">{failure}</p>}
      {saved && <p className="hint">{t('manifestSaved').replace('{id}', saved)}</p>}
      <button type="button" disabled={busy || examples.length === 0} onClick={save}>
        {t('manifestSave')}
      </button>
    </details>
  );
}
