// The body, as five cards that each say what it can and cannot do.
//
// The old Basic tab had a dropdown of five names the firmware understood. A
// name is not a decision anyone can make: "tarot" tells you nothing about
// whether it moves, and nothing at all about whether you have the hardware.
// So each row of core/bodies.js is a card, and the attributes are the ones a
// person can check against the box on their desk.
import { useEffect, useState } from 'react';
import { BODIES, CAPABILITIES } from '../../core/bodies.js';
import { PreviewFrames } from './PreviewFrames';
import { t, type Key } from './i18n';
import type { Detail, Motion, Patch } from './types';

const CAP: Record<string, Key> = {
  hear: 'capHear', speak: 'capSpeak', show: 'capShow', move: 'capMove', sense: 'capSense',
};
const LACK: Record<string, Key> = {
  hear: 'cannotHear', speak: 'cannotSpeak', show: 'cannotShow', move: 'cannotMove', sense: 'cannotSense',
};
const SOURCE: Record<string, Key> = {
  board: 'sourceBoard', phone: 'sourcePhone', none: 'sourceNone',
};

export function BodyTab({ detail, update }: { detail: Detail; update(p: Patch): void }) {
  const chosen = detail.config.body.id;
  const body = BODIES.find((b) => b.id === chosen) ?? BODIES[0];
  // Frame paths come from the brain: the admin bundle has no idea what the
  // render tools left on disk, and a guessed path is a broken picture.
  const [art, setArt] = useState<Record<string, string[]>>({});
  useEffect(() => {
    let live = true;
    fetch('/preview/list.json')
      .then((r) => (r.ok ? r.json() : {}))
      .then((j: unknown) => { if (live && j && typeof j === 'object') setArt(j as Record<string, string[]>); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  const frames = (art[body.preview] ?? []).map((rel) => `/preview/${body.preview}/${rel}`);
  const pick = (id: string) => update({ config: { body: { id: id as Motion } } });
  const next = body.source === 'board' ? t('bodyNextBoard') : body.source === 'phone' ? t('bodyNextPhone') : t('bodyNextNone');

  return (
    <div className="body-tab">
      <p className="hint">{t('bodyIntro')}</p>
      <div className="body-cards">
        {BODIES.map((b) => {
          const lacks = CAPABILITIES.filter((c) => !b.capabilities.includes(c));
          return (
            <label key={b.id} className="body-card" data-selected={b.id === chosen}>
              <input
                type="radio" name="body" value={b.id}
                checked={b.id === chosen} onChange={() => pick(b.id)}
              />
              <strong>{b.label}</strong>
              <span className="badge">{t(SOURCE[b.source])}</span>
              {b.needs.length > 0 && <small>{t('bodyNeeds')}: {b.needs.join(' · ')}</small>}
              <span className="caps">{b.capabilities.map((c) => t(CAP[c])).join(' · ')}</span>
              {lacks.length > 0 && <small className="lacks">{lacks.map((c) => t(LACK[c])).join(' · ')}</small>}
            </label>
          );
        })}
      </div>
      <div className="body-side">
        <div className="body-preview" data-testid="body-preview">
          {frames.length > 0
            ? <PreviewFrames key={body.id} frames={frames} alt={body.label} />
            : <span>{body.label}</span>}
        </div>
        <small>{t('previewNote')}</small>
        <p>{next}</p>
      </div>
    </div>
  );
}
