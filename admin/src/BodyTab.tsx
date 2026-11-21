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
import { TEMPLATES, bodyById, bodyProblem, labelOf, resolveBody } from '../../core/bodies.js';
import { ActionsEditor } from './ActionsEditor';
import { BodyDiagram } from './BodyDiagram';
import { lang, t, type Key } from './i18n';
import type { Detail, Motion, Patch } from './types';

const CAP: Record<string, Key> = {
  hear: 'capHear', speak: 'capSpeak', show: 'capShow', move: 'capMove',
};
const SOURCE: Record<string, Key> = {
  board: 'sourceBoard', phone: 'sourcePhone', none: 'sourceNone',
};
/** What to do next, one line per way this body can be reached. */
const NEXT: Record<string, Key> = {
  board: 'bodyNextBoard', phone: 'bodyNextPhone', none: 'bodyNextNone',
};
const NEED: Record<string, Key> = {
  board: 'needBoard', mic: 'needMic', amp: 'needAmp', toy: 'needToy', ftdi: 'needFtdi',
  screen: 'needScreen', wand: 'needWand', phone: 'needPhone',
};

export function BodyTab({ detail, update }: { detail: Detail; update(p: Patch): void }) {
  const patch = detail.config.body;
  // A body of one's own keeps its own id (`my-dog`) and names the template it
  // copied; the cards are the templates, so the template is what is chosen.
  // The brain resolves `template ?? id` too.
  const chosen = patch.template ?? patch.id;
  /** The sentence `bodyProblem` wrote when a switch was refused, and whether
   * the switch then dropped the user's edits or wrote nothing at all. */
  const [notice, setNotice] = useState<{ text: string; cleared: boolean } | null>(null);
  // A dry run is a bench tool: it moves nothing and shows nothing, and next to
  // four real bodies it reads as a fifth one. `?bench` brings it back for the
  // person editing prompts without hardware — and it is always shown when it is
  // already the choice, or the card would vanish from under them.
  const bench = new URLSearchParams(window.location.search).has('bench');
  const bodies = Object.values(TEMPLATES);
  const shown = bodies.filter((b) => bench || !b.hidden || b.id === chosen);
  // The fallback is the id config.js falls back to, not whatever sorts first.
  const body = bodyById(chosen) ?? TEMPLATES.toy;
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
  // A switch is a merge: the new id, the actions and triggers the body already
  // carried. Validate that merge before writing it — an action copied from a
  // pet cannot run on a voice-only body, and the editor would otherwise save a
  // body `bodyProblem` refuses. What still fits is kept; what does not is
  // cleared back to inherited, and the sentence says which.
  const pick = (id: string) => {
    const next = id as Motion;
    // A body of one's own keeps its name. Only an id that is itself a template
    // is rewritten: `my-dog` stays `my-dog`, and `template` says what it
    // follows. The chosen template is still written beside a template id.
    // Leaving the old template in place made a switch only cosmetic: the brain
    // resolves `template ?? id`, so a stale `pet` kept winning after a click on
    // `toy`. `hasOwn`, not a property read: `TEMPLATES.constructor` is a
    // function, so a body named `constructor` would lose its name.
    const named = Object.hasOwn(TEMPLATES, patch.id ?? '');
    /** The body keys this switch writes: a template id, or the template alone. */
    const follow = (value: Motion) => (named ? { id: value, template: value } : { template: value });
    /** The body as the brain will read it after a PATCH carrying this patch. */
    const read = (p: typeof patch) => {
      const candidate = resolveBody(next, { ...p, template: next });
      const base = TEMPLATES[(candidate.template ?? next) as Motion] ?? TEMPLATES.none;
      const rawTriggers = /** @type {any} */ (p.triggers ?? base.triggers ?? []);
      return { ...candidate, triggers: Array.isArray(rawTriggers) ? rawTriggers : [] };
    };
    const problem = bodyProblem(read(patch));
    if (!problem) {
      setNotice(null);
      update({ config: { body: follow(next) } });
      return;
    }
    // A switch drops what the new body cannot carry: the actions it wrote and
    // the triggers that may name them. It never drops a prompts override —
    // those are the person's words, not the body's — so if the prompt is the
    // reason the merge is refused, the switch is refused too rather than
    // taking the actions with it and leaving the body just as broken.
    const dropped = Array.isArray(patch.actions)
      ? { ...follow(next), actions: null, triggers: null }
      : patch.triggers !== undefined
        ? { ...follow(next), triggers: null }
        : follow(next);
    // Validate the patch that would actually be written, not just the merge.
    const settled = bodyProblem(read({ ...patch, ...dropped }));
    if (settled) {
      setNotice({ text: settled, cleared: false });
      return;
    }
    setNotice({ text: problem, cleared: true });
    update({ config: { body: dropped } });
  };
  const name = labelOf(body, lang);

  return (
    <div className="body-tab">
      <p className="hint">{t('bodyIntro')}</p>
      <div className="body-cards">
        {shown.map((b) => {
          return (
            <label key={b.id} className="body-card" data-selected={b.id === chosen}>
              <input
                type="radio" name="body" value={b.id}
                checked={b.id === chosen} onChange={() => pick(b.id)}
              />
              <strong>{labelOf(b, lang)}</strong>
              {/* One line per way: the badge is how you get it, the list is
                  what that way costs you — they are different shopping lists
                  for the same abilities. */}
              {b.ways.map((w) => (
                <span key={w.source} className="way">
                  <span className="badge">{t(SOURCE[w.source])}</span>
                  <span>{w.needs.length > 0 ? w.needs.map((n) => t(NEED[n.part])).join(' · ') : t('bodyNeedsNothing')}</span>
                </span>
              ))}
              <span className="caps">{b.capabilities.map((c) => t(CAP[c])).join(' · ')}</span>
            </label>
          );
        })}
        {/* Under the cards: the actions are this body's, and a body of one's
            own is told apart by carrying them. Remounted on a switch, so the
            box starts from the newly chosen body. */}
        <ActionsEditor key={chosen} detail={detail} update={update} />
        {notice && (
          <p className="hint" role="status">
            {notice.cleared && <>{t('bodySwitchCleared')} </>}
            <span>{notice.text}</span>
          </p>
        )}
      </div>
      <div className="body-side">
        <div className="body-preview" data-testid="body-preview">
          <BodyDiagram key={body.id} kind={body.preview} frames={frames} label={name} />
        </div>
        <small>{t('previewNote')}</small>
        {body.ways.map((w) => <p key={w.source}>{t(NEXT[w.source])}</p>)}
      </div>
    </div>
  );
}
