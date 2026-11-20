// The body's actions, in the one view the page has for them: JSON. The reflex
// tab already teaches the form/JSON trade (a custom action has no form yet), so
// this is a collapsed box under the cards rather than a second editor language.
//
// A body without its own `actions` follows its template. Copying the template
// writes them down as the body's own; "Use the template" removes the override
// again. Validation is `bodyProblem`, never `resolveBody`: resolution drops a
// trigger whose action is not written yet and cannot show what an edit did to
// the rest of the body. The candidate is the resolved body with its actions
// replaced and its triggers taken before resolution filters them, so
// capabilities, triggers and prompts are checked exactly as the brain will
// read them — including a `button -> wave` whose action is not written yet.
import { useState } from 'react';
import { TEMPLATES, bodyProblem, resolveBody } from '../../core/bodies.js';
import { t } from './i18n';
import type { BodyAction, BodyTrigger, Detail, Patch } from './types';

export function ActionsEditor({ detail, update }: { detail: Detail; update(p: Patch): void }) {
  const patch = detail.config.body;
  const body = resolveBody(patch.id, patch);
  // `null` is the wire form of "remove the key": the server merges instead of
  // replacing, so an absent JSON property would leave the old actions in place.
  // It is the same thing as inherited after the next read (`core/config.js`
  // keeps `actions` only when it is an array).
  const inherited = patch.actions == null;
  const table = TEMPLATES as unknown as Record<string, { actions: BodyAction[]; triggers?: BodyTrigger[] }>;
  const template = table[body.template ?? patch.id] ?? table.none;
  const [text, setText] = useState(() => JSON.stringify(body.actions, null, 2));
  const [error, setError] = useState<string | null>(null);
  // Whether the box holds an edit that has not reached the config. A rejected
  // edit counts: clearing the trigger should still save it once it is whole.
  const [dirty, setDirty] = useState(false);
  // "Use the template" was refused by a trigger, not by the actions. The box
  // already shows the template, so the next write that clears the trigger must
  // remove the override (`actions: null`) rather than save that copy.
  const [pendingInherit, setPendingInherit] = useState(false);

  /**
   * The triggers the body would read before `resolveBody` drops the ones whose
   * action is missing. Validation must see these whole: the filter that
   * silently removes `button -> wave` is exactly the broken edit to name.
   * A PATCH merges, so an absent `triggers` still inherits the template's.
   */
  const triggers = () => {
    const raw = /** @type {any} */ (patch.triggers ?? template.triggers ?? []);
    return Array.isArray(raw) ? raw : [];
  };

  /** The body as the brain will read it, with these actions and triggers. */
  const candidate = (actions: BodyAction[], nextTriggers = triggers()) => (
    { ...body, actions, triggers: nextTriggers }
  );

  /** Show an edit and, when it is whole, save it. A broken one is named, not saved. */
  const attempt = (actions: BodyAction[]) => {
    const problem = bodyProblem(candidate(actions));
    setText(JSON.stringify(actions, null, 2));
    setError(problem);
    setDirty(Boolean(problem));
    if (!problem) update({ config: { body: { actions } } });
  };

  const edit = (next: string) => {
    setText(next);
    // The person is editing the actions again; the template is no longer the
    // pending intent, even if it was what the box held a moment ago.
    setPendingInherit(false);
    let actions: BodyAction[];
    try {
      actions = JSON.parse(next);
    } catch {
      // The parser's own message is English and names a byte, not a line.
      setDirty(true);
      setError(t('jsonInvalid'));
      return;
    }
    const problem = bodyProblem(candidate(actions));
    setError(problem);
    setDirty(Boolean(problem));
    if (!problem) update({ config: { body: { actions } } });
  };

  const copy = () => {
    setPendingInherit(false);
    attempt(structuredClone(template.actions));
  };

  const useTemplate = () => {
    const problem = bodyProblem(candidate(template.actions));
    setText(JSON.stringify(template.actions, null, 2));
    setError(problem);
    setDirty(Boolean(problem));
    setPendingInherit(Boolean(problem));
    // A hand-written trigger can name one of the copy's own actions; removing
    // the override would then strand it and save a body `bodyProblem` refuses.
    if (!problem) update({ config: { body: { actions: null } } });
  };

  /**
   * An emptied trigger list must be written as `[]`: a PATCH merges, so a
   * missing key would inherit the template's shake again on the next read.
   * The actions ride along only when the box has an unsaved edit — an unedited
   * template must not silently become a copy of itself.
   */
  const clearTriggers = () => {
    const restore = pendingInherit;
    let actions: BodyAction[] | undefined;
    if (!restore) {
      try { actions = JSON.parse(text); } catch { /* the box is mid-edit */ }
    }
    // A restore writes `actions: null`, so the body it leaves behind carries
    // the template's actions, not the copy the box is showing.
    const written = restore ? template.actions : actions;
    const problem = written === undefined
      ? t('jsonInvalid')
      : bodyProblem(candidate(written, []));
    setError(problem);
    if (problem && restore) return;
    const keep = problem
      ? {}
      : restore
        ? { actions: null as null }
        : dirty && actions !== undefined ? { actions } : {};
    update({ config: { body: { triggers: [], ...keep } } });
    setDirty(false);
    setPendingInherit(false);
  };

  return (
    <details className="body-actions">
      <summary>
        {t('actionsTitle')}
        {!inherited && <span className="hint"> · {t('presetCustom')}</span>}
      </summary>
      <div className="fields">
        <p className="hint">{t('actionsHint')}</p>
        <label>
          {t('actionsTitle')}
          <textarea
            aria-label={t('actionsTitle')} rows={14} spellCheck={false} value={text}
            onChange={(e) => edit(e.target.value)}
          />
        </label>
        <div className="toggle">
          <button type="button" className="secondary" onClick={copy}>{t('actionsCopy')}</button>
          <button type="button" className="secondary" disabled={inherited} onClick={useTemplate}>
            {t('actionsUse')}
          </button>
          {triggers().length > 0 && (
            <button type="button" className="secondary" onClick={clearTriggers}>{t('actionsClearTriggers')}</button>
          )}
        </div>
        {error && <p role="alert" className="error">{error}</p>}
      </div>
    </details>
  );
}
