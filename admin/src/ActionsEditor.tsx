// The body's actions, in the one view the page has for them: JSON. The reflex
// tab already teaches the form/JSON trade (a custom action has no form yet), so
// this is a collapsed box under the cards rather than a second editor language.
//
// A body without its own `actions` follows its template. Copying the template
// writes them down as the body's own; "Use the template" removes the override
// again. Validation is `bodyProblem`, never `resolveBody`: resolution drops a
// trigger whose action is not written yet and cannot show what an edit did to
// the rest of the body. The candidate is the resolved body with only its
// actions replaced, so capabilities, triggers and prompts are checked exactly
// as the brain will read them.
import { useState } from 'react';
import { TEMPLATES, bodyProblem, resolveBody } from '../../core/bodies.js';
import { t } from './i18n';
import type { BodyAction, Detail, Patch } from './types';

export function ActionsEditor({ detail, update }: { detail: Detail; update(p: Patch): void }) {
  const patch = detail.config.body;
  const body = resolveBody(patch.id, patch);
  // `null` is the wire form of "remove the key": the server merges instead of
  // replacing, so an absent JSON property would leave the old actions in place.
  // It is the same thing as inherited after the next read (`core/config.js`
  // keeps `actions` only when it is an array).
  const inherited = patch.actions == null;
  const table = TEMPLATES as unknown as Record<string, { actions: BodyAction[] }>;
  const template = table[body.template ?? patch.id] ?? table.none;
  const [text, setText] = useState(() => JSON.stringify(body.actions, null, 2));
  const [error, setError] = useState<string | null>(null);

  /** Show an edit and, when it is whole, save it. A broken one is named, not saved. */
  const attempt = (actions: BodyAction[]) => {
    const problem = bodyProblem({ ...body, actions });
    setText(JSON.stringify(actions, null, 2));
    setError(problem);
    if (!problem) update({ config: { body: { actions } } });
  };

  const edit = (next: string) => {
    setText(next);
    let actions: BodyAction[];
    try {
      actions = JSON.parse(next);
    } catch {
      // The parser's own message is English and names a byte, not a line.
      setError(t('jsonInvalid'));
      return;
    }
    const problem = bodyProblem({ ...body, actions });
    setError(problem);
    if (!problem) update({ config: { body: { actions } } });
  };

  const copy = () => attempt(structuredClone(template.actions));

  const useTemplate = () => {
    setText(JSON.stringify(template.actions, null, 2));
    setError(null);
    update({ config: { body: { actions: null } } });
  };

  /**
   * An emptied trigger list must be written as `[]`: a PATCH merges, so a
   * missing key would inherit the template's shake again on the next read.
   * Saving the box as well matters — an edit that only failed because of the
   * trigger has not reached the config yet, and clearing it should not throw
   * that work away.
   */
  const clearTriggers = () => {
    let actions: BodyAction[] | undefined;
    try { actions = JSON.parse(text); } catch { /* the box is mid-edit */ }
    const problem = actions === undefined ? t('jsonInvalid') : bodyProblem({ ...body, triggers: [], actions });
    setError(problem);
    update({ config: { body: { triggers: [], ...(actions !== undefined && !problem ? { actions } : {}) } } });
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
          {(body.triggers?.length ?? 0) > 0 && (
            <button type="button" className="secondary" onClick={clearTriggers}>{t('actionsClearTriggers')}</button>
          )}
        </div>
        {error && <p role="alert" className="error">{error}</p>}
      </div>
    </details>
  );
}
