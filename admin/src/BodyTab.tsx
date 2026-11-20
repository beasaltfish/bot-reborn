// The body, as five cards that each say what it needs and what it does.
//
// The old Basic tab had a dropdown of five names the firmware understood. A
// name is not a decision anyone can make: "tarot" tells you nothing about
// whether it moves, and nothing at all about whether you have the hardware.
// So each row of core/bodies.js is a card, and the attributes are the ones a
// person can check against the box on their desk. What a body lacks is not
// printed: five lines of "cannot" is a page that argues against itself, and
// the badges above already say what it does.
import { useEffect, useState } from 'react';
import { BODIES, labelOf } from '../../core/bodies.js';
import { PhoneLink } from './PhoneLink';
import { PreviewFrames } from './PreviewFrames';
import { lang, t, type Key } from './i18n';
import type { Detail, Motion, Patch } from './types';

const CAP: Record<string, Key> = {
  hear: 'capHear', speak: 'capSpeak', show: 'capShow', move: 'capMove', sense: 'capSense',
};
const SOURCE: Record<string, Key> = {
  board: 'sourceBoard', phone: 'sourcePhone', none: 'sourceNone',
};
/** What to do next, one line per way this body can be reached. */
const NEXT: Record<string, Key> = {
  board: 'bodyNextBoard', phone: 'bodyNextPhone', none: 'bodyNextNone',
};
const NEED: Record<string, Key> = {
  board: 'needBoard', motor: 'needMotor', battery: 'needBattery',
  screen: 'needScreen', wand: 'needWand', phone: 'needPhone',
};

export function BodyTab({ detail, update, onToken }: { detail: Detail; update(p: Patch): void; onToken(token: string): void }) {
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
  const name = labelOf(body, lang);

  return (
    <div className="body-tab">
      <p className="hint">{t('bodyIntro')}</p>
      <div className="body-cards">
        {BODIES.map((b) => {
          return (
            <label key={b.id} className="body-card" data-selected={b.id === chosen}>
              <input
                type="radio" name="body" value={b.id}
                checked={b.id === chosen} onChange={() => pick(b.id)}
              />
              <strong>{labelOf(b, lang)}</strong>
              <span className="badges">{b.sources.map((src) => <span key={src} className="badge">{t(SOURCE[src])}</span>)}</span>
              {b.needs.length > 0 && <small>{t('bodyNeeds')}: {b.needs.map((n) => t(NEED[n])).join(' · ')}</small>}
              <span className="caps">{b.capabilities.map((c) => t(CAP[c])).join(' · ')}</span>
            </label>
          );
        })}
      </div>
      <div className="body-side">
        <div className="body-preview" data-testid="body-preview">
          {frames.length > 0
            ? <PreviewFrames key={body.id} frames={frames} alt={name} />
            : <span>{name}</span>}
        </div>
        <small>{t('previewNote')}</small>
        {body.sources.map((src) => <p key={src}>{t(NEXT[src])}</p>)}
        {body.sources.includes('phone') && <PhoneLink token={detail.token} />}
      </div>
    </div>
  );
}
