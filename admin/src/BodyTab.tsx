// The body, as a card per template — plus one per plugin body the brain loaded,
// which reaches this page through `/api/bodies` and is registered with
// `core/bodies.js` before it is drawn.
//
// The old Basic tab had a dropdown of five names the firmware understood. A
// name is not a decision anyone can make: "tarot" tells you nothing about
// whether it moves, and nothing at all about whether you have the hardware.
// So each row of core/bodies.js is a card, and the attributes are the ones a
// person can check against the box on their desk. What a body lacks is not
// printed: five lines of "cannot" is a page that argues against itself, and
// the badges above already say what it does.
//
// Above them sits the module panel: a module is a body this repository ships,
// so it is installed and its example actions adopted in one step rather than
// retyped — see `core/body-switch.js` for the write that step makes.
import { useEffect, useState } from 'react';
import { TEMPLATES, bodyById, bodyProblem, labelOf, pluginBodies, registerPlugins, resolveBody } from '../../core/bodies.js';
import { ActionsEditor } from './ActionsEditor';
import { BodyDiagram } from './BodyDiagram';
import { BodyManifestEditor } from './BodyManifestEditor';
import { adoptModule } from '../../core/body-switch.js';
import { lang, t, type Key } from './i18n';
import type { BodyAction, Detail, Patch } from './types';

type Body = import('../../core/bodies.js').Body;

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

/** One plugin body as the brain lists it: enough to build the same body here,
 * so `resolveBody` and `bodyById` agree with the brain about a plugin id. The
 * card has no ways or artwork of its own: a plugin hears and speaks like a
 * bare board, and adds commands. */
interface PluginBody {
  id: string;
  label: { en: string; zh: string };
  commands: NonNullable<Body['commands']>;
  resources: NonNullable<Body['resources']>;
}

/**
 * One entry, if it has what a body and a card need. The brain validates every
 * plugin at load, so this is only the page refusing to crash on a shape from an
 * older or newer brain — a refused entry is skipped, like a failed fetch.
 * @returns {PluginBody | null}
 */
function asPlugin(value: unknown): PluginBody | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || row.id === '') return null;
  const label = row.label as { en?: unknown; zh?: unknown } | undefined;
  if (!label || typeof label.en !== 'string' || typeof label.zh !== 'string') return null;
  /** @param {unknown} entry */
  const named = (entry: unknown) => Boolean(entry)
    && typeof entry === 'object'
    && typeof (entry as { name?: unknown }).name === 'string';
  const { commands, resources } = row;
  if (!Array.isArray(commands) || !commands.every(named)) return null;
  if (!Array.isArray(resources) || !resources.every(named)) return null;
  return {
    id: row.id,
    label: { en: label.en, zh: label.zh },
    commands: commands as PluginBody['commands'],
    resources: resources as PluginBody['resources'],
  };
}

/**
 * The body the brain built from the manifest: voice-only plus the plugin's own
 * id, label, commands and pins. `template` names the plugin itself, so
 * `resolveBody` lands on this row rather than on a template's.
 * @param {PluginBody} p @returns {Body}
 */
function pluginBody(p: PluginBody): Body {
  return {
    ...TEMPLATES.none,
    id: p.id,
    template: p.id,
    label: { ...p.label },
    commands: p.commands,
    resources: p.resources,
  };
}

/** One module as `/api/modules` lists it: enough for a card and the adopt step. */
interface Module {
  id: string;
  label: { en: string; zh: string };
  parts: string[];
  note: { en: string; zh: string } | null;
  installed: boolean;
  examples: BodyAction[];
  commands: string[];
}

/** The string entries of a list from the brain, and nothing else. */
const strings = (value: unknown): string[] => (
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
);

/** One module, if it has what a card needs; a bad row is skipped, not fatal. */
function asModule(value: unknown): Module | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const label = row.label as { en?: unknown; zh?: unknown } | undefined;
  if (typeof row.id !== 'string' || row.id === '') return null;
  if (!label || typeof label.en !== 'string' || typeof label.zh !== 'string') return null;
  // The examples are what adoption writes into a character, so a row without a
  // list of them is not a row to offer: it would install a body and then have
  // nothing to merge, which is a card the person cannot use.
  if (!Array.isArray(row.examples)) return null;
  const note = row.note as { en?: unknown; zh?: unknown } | null | undefined;
  return {
    id: row.id,
    label: { en: label.en, zh: label.zh },
    parts: strings(row.parts),
    note: note && typeof note.en === 'string' && typeof note.zh === 'string'
      ? { en: note.en, zh: note.zh }
      : null,
    installed: row.installed === true,
    examples: row.examples as BodyAction[],
    commands: strings(row.commands),
  };
}

/**
 * Parse a `/api/bodies` answer and register it here, so `resolveBody` and
 * `bodyById` agree with the brain about a plugin id. Replacement, not a merge:
 * an empty answer must clear what a previous fetch registered, and the cards
 * and the actions box read the same registry.
 * @param {unknown} value @returns {PluginBody[] | null} null when not a list
 */
function takeBodies(value: unknown): PluginBody[] | null {
  if (!Array.isArray(value)) return null;
  const entries = value.map(asPlugin).filter((p): p is PluginBody => p !== null);
  /** @type {Record<string, Body>} */
  const registry: Record<string, Body> = {};
  for (const p of entries) registry[p.id] = pluginBody(p);
  registerPlugins(registry);
  return entries;
}

export function BodyTab({ detail, update }: { detail: Detail; update(p: Patch): void }) {
  const patch = detail.config.body;
  // A body of one's own keeps its own id (`my-dog`) and names the template it
  // copied; the cards are the templates, so the template is what is chosen.
  // The brain resolves `template ?? id` too, so an old config with no template
  // must land on the same card as the solver does — not on a missing id.
  const chosen = resolveBody(patch.id ?? 'toy', patch).template ?? 'toy';
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
  // A plugin is installed on the brain, not in this bundle: the page asks for
  // the bodies, registers them so `resolveBody`/`bodyById` can find a plugin id,
  // and draws a card each. A brain without the endpoint (or a page opened while
  // it was down) simply shows the templates it already has.
  const [plugins, setPlugins] = useState<PluginBody[]>([]);
  useEffect(() => {
    let live = true;
    fetch('/api/bodies')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: unknown) => {
        if (!live) return;
        const entries = takeBodies(j);
        if (entries) setPlugins(entries);
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  // The modules this repository ships, and whether each body is already here.
  // A brain without the endpoint simply offers none, like the plugin list.
  const [modules, setModules] = useState<Module[]>([]);
  /** The module whose request is in flight, so its card cannot be clicked
   * twice. */
  const [installing, setInstalling] = useState<string | null>(null);
  /** A failed step in the module panel: the sentence the brain sent, or '' when
   * it sent none, plus whether the install itself worked but this page could not
   * re-read the body. `null` means no failure to show. */
  const [failure, setFailure] = useState<{ text: string; refresh: boolean } | null>(null);
  /** The module installed and waiting for the person to say yes to its
   * examples. A dialog the page draws itself, so it can be tested and read. */
  const [pendingExamples, setPendingExamples] = useState<{ id: string; examples: BodyAction[] } | null>(null);
  useEffect(() => {
    let live = true;
    fetch('/api/modules')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: unknown) => {
        if (!live || !Array.isArray(j)) return;
        setModules(j.map(asModule).filter((m): m is Module => m !== null));
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  /**
   * Re-read `/api/bodies` and register it on this page. `null` means the answer
   * was not a list: the install may have written a body, but adopting before
   * this page knows its commands would refuse the module's own examples.
   * @returns {Promise<PluginBody[] | null>}
   */
  const refreshBodies = async () => {
    const listed = await fetch('/api/bodies')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    const entries = takeBodies(listed);
    if (entries) setPlugins(entries);
    return entries;
  };

  /**
   * Install a module and then, in this order: re-read `/api/bodies` and
   * register it, replace the plugin cards, ask about the examples, write the
   * adoption. The refresh must come before the question: an example that calls
   * `led_on` is refused as "unknown command" if the page has not registered the
   * body yet, and the person would be told their own module is broken.
   *
   * The same call is the reinstall: the brain rewrites the body, and this page
   * asks about the examples again. A failure to read it back is its own
   * sentence: the install did happen, so telling the person it failed would be
   * false.
   */
  const installModule = async (id: string) => {
    setInstalling(id);
    setFailure(null);
    setPendingExamples(null);
    try {
      const res = await fetch(`/api/modules/${encodeURIComponent(id)}/install`, {
        method: 'POST', headers: { 'X-Bot-Reborn': '1' },
      });
      const answer = await res.json().catch(() => ({})) as { error?: unknown; examples?: unknown };
      // Every failure is a 404 with a sentence: the sentence is what the person
      // reads, so it is shown instead of a status code.
      if (!res.ok || typeof answer.error === 'string') {
        setFailure({ text: typeof answer.error === 'string' ? answer.error : '', refresh: false });
        return;
      }
      // The brain has the body now, even if this page cannot read it back.
      setModules((rows) => rows.map((row) => (row.id === id ? { ...row, installed: true } : row)));
      const entries = await refreshBodies();
      if (!entries) {
        setFailure({ text: '', refresh: true });
        return;
      }
      setPendingExamples({
        id,
        examples: (Array.isArray(answer.examples) ? answer.examples : []) as BodyAction[],
      });
    } catch {
      // The brain is down or the answer was not JSON: the copy says the install
      // failed, and nothing has been written.
      setFailure({ text: '', refresh: false });
    } finally {
      setInstalling(null);
    }
  };

  /**
   * Offer an already installed module's examples to this character. Installation
   * is body-level and global; adoption is per character, so a second character —
   * or this page after a reload — must still get an entry. The plugin registry
   * is per page, not per brain: when it lacks the id, re-read `/api/bodies`
   * before asking, or the examples would read as unknown commands.
   */
  const addExamples = async (module: Module) => {
    setFailure(null);
    setPendingExamples(null);
    if (!Object.hasOwn(pluginBodies(), module.id)) {
      setInstalling(module.id);
      const entries = await refreshBodies();
      setInstalling(null);
      if (!entries) {
        setFailure({ text: '', refresh: true });
        return;
      }
    }
    setPendingExamples({ id: module.id, examples: module.examples });
  };

  /**
   * The one write of an adoption: the body follows the module, with the
   * actions the character already had plus the examples that were confirmed.
   * An action the module body cannot run is left behind and named, because a
   * written one would be offered to the model and then refused by the hardware.
   */
  const adopt = (id: string, examples: BodyAction[]) => {
    // Only the character's own actions are carried: what it merely inherited
    // belongs to the template it is leaving. The panel says so in words, because
    // a dropped `draw_card` would otherwise leave no trace in this list.
    const current = Array.isArray(patch.actions) ? patch.actions : [];
    const moduleBody = bodyById(id) ?? resolveBody(id, { template: id });
    /** `bodyProblem` for the module body carrying these actions; triggers are
     * judged against the actions that survived, as `resolveBody` reads them. */
    const accepts = (actions: BodyAction[]) => {
      const names = new Set(actions.map((action) => action.name));
      const triggers = (moduleBody.triggers ?? []).filter((trigger) => names.has(trigger.action));
      return bodyProblem({ ...moduleBody, actions, triggers });
    };
    const { body, dropped } = adoptModule(
      patch, id, current, examples, (name) => Object.hasOwn(TEMPLATES, name), accepts,
    );
    // What the brain will read after this PATCH. A body still refused is not
    // written: the sentence names the reason and the character keeps what it
    // had, rather than saving tools nothing can run.
    const problem = bodyProblem(resolveBody(body.id ?? patch.id ?? id, { ...patch, ...body }));
    if (problem) {
      setNotice({ text: problem, cleared: false });
      return;
    }
    setNotice(dropped.length > 0
      ? { text: `${t('moduleActionsDropped')}${dropped.join(', ')}`, cleared: false }
      : null);
    update({ config: { body } });
    setPendingExamples(null);
  };
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
  const pick = (next: string) => {
    // A body of one's own keeps its name. Only an id that is itself a template
    // is rewritten: `my-dog` stays `my-dog`, and `template` says what it
    // follows. The chosen template is still written beside a template id.
    // Leaving the old template in place made a switch only cosmetic: the brain
    // resolves `template ?? id`, so a stale `pet` kept winning after a click on
    // `toy`. `hasOwn`, not a property read: `TEMPLATES.constructor` is a
    // function, so a body named `constructor` would lose its name.
    const named = Object.hasOwn(TEMPLATES, patch.id ?? '');
    /** The body keys this switch writes: a template id, or the template alone. */
    const follow = (value: string) => (named ? { id: value, template: value } : { template: value });
    /** The body as the brain will read it after a PATCH carrying this patch. */
    const read = (p: typeof patch) => {
      const candidate = resolveBody(next, { ...p, template: next });
      const base = bodyById(candidate.template ?? next) ?? TEMPLATES.none;
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
      {/* Above the cards: a module is not a body to pick, it is a body to
          install and then adopt. Only the panel writes it, in one step. */}
      {modules.length > 0 && (
        <section className="body-modules">
          <h3>{t('modules')}</h3>
          <p className="hint">{t('addModule')}</p>
          {modules.map((m) => (
            <div key={m.id} className="module-card">
              <strong>{lang === 'zh' ? m.label.zh : m.label.en}</strong>
              <span className="caps">{m.parts.join(' · ')}</span>
              <span className="hint">{t('moduleExamples').replace('{n}', String(m.examples.length))}</span>
              {m.commands.length > 0 && (
                <span className="hint">{t('moduleCommands').replace('{n}', String(m.commands.length))}</span>
              )}
              {m.note && <p className="hint">{lang === 'zh' ? m.note.zh : m.note.en}</p>}
              {/* Installed is body-level and global; adoption is per character.
                  Both entries stay: a second character, or this page after a
                  reload, still needs the examples. */}
              {m.installed ? (
                <>
                  <span className="badge ok">{t('installed')}</span>
                  <div className="toggle">
                    <button type="button" disabled={installing !== null} onClick={() => addExamples(m)}>
                      {t('addExamples')}
                    </button>
                    <button
                      type="button" className="secondary"
                      disabled={installing !== null} onClick={() => installModule(m.id)}
                    >
                      {t('reinstall')}
                    </button>
                  </div>
                  <p className="hint">{t('moduleReconnected')}</p>
                </>
              ) : (
                <button type="button" disabled={installing !== null} onClick={() => installModule(m.id)}>
                  {t('addToCharacter')}
                </button>
              )}
              {pendingExamples?.id === m.id && (
                <div className="toggle">
                  <button type="button" onClick={() => adopt(m.id, pendingExamples.examples)}>
                    {t('confirmExamples').replace('{n}', String(pendingExamples.examples.length))}
                  </button>
                  <button type="button" className="secondary" onClick={() => adopt(m.id, [])}>
                    {t('cancel')}
                  </button>
                </div>
              )}
            </div>
          ))}
          {failure !== null && (
            <p className="error" role="alert">
              {failure.refresh
                ? t('moduleRefreshFailed')
                : failure.text.trim() === ''
                  ? t('moduleInstallFailed')
                  : `${t('moduleInstallFailed')} ${failure.text}`}
            </p>
          )}
        </section>
      )}
      {/* Under both panels: a refusal or a dropped action is about the body as
          a whole, whether it came from a card above or the module panel. */}
      {notice && (
        <p className="hint" role="status">
          {notice.cleared && <>{t('bodySwitchCleared')} </>}
          <span>{notice.text}</span>
        </p>
      )}
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
        {plugins.map((p) => (
          <label key={p.id} className="body-card" data-selected={p.id === chosen}>
            <input
              type="radio" name="body" value={p.id}
              checked={p.id === chosen} onChange={() => pick(p.id)}
            />
            <strong>{lang === 'zh' ? p.label.zh : p.label.en}</strong>
            {/* A plugin is the bare board plus the commands its author wrote:
                there is no art to draw and no other way to reach it, so the
                card says it is simulator-only and what it can be asked for. */}
            <span className="way">
              <span className="badge">{t('sourcePlugin')}</span>
              <span>{t('pluginOnBoard')}</span>
            </span>
            <span className="caps">
              {t('capVoiceOnly')}
              {p.commands.length > 0 && <> · {t('pluginCommands')}: {p.commands.map((c) => c.name).join(' · ')}</>}
            </span>
          </label>
        ))}
        {/* Under the cards: the actions are this body's, and a body of one's
            own is told apart by carrying them. Remounted on a switch, so the
            box starts from the newly chosen body. */}
        <ActionsEditor key={chosen} detail={detail} update={update} />
        {/* The bench half, made editable: a pin number and the examples the
            model reads. Only for a body that carries commands — a template has
            no pins of its own to save. */}
        {Array.isArray(body.resources) && body.resources.length > 0 && (
          <BodyManifestEditor
            key={`manifest-${chosen}`}
            body={body}
            resources={body.resources}
            commands={body.commands ?? []}
            actions={body.actions}
            wiring={body.wiring}
            parts={body.parts ?? []}
          />
        )}
      </div>
        <div className="body-side">
          <div className="body-preview" data-testid="body-preview">
            <BodyDiagram key={body.id} kind={body.preview} frames={frames} label={name} />
          </div>
          <small>{t('previewNote')}</small>
          {/* A plugin body is reached through the bench, not through the body
              firmware: its ways come from the template it was built on, and
              repeating that template's "flash it" line would promise a board
              that cannot answer a command yet. */}
          {plugins.some((p) => p.id === body.id)
            ? <p>{t('pluginNext')}</p>
            : body.ways.map((w) => <p key={w.source}>{t(NEXT[w.source])}</p>)}
        </div>
    </div>
  );
}
