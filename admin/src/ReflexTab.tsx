// The reflex tab below the provider fields (configurable reflex spec §4):
// which question, what each answer does, when it fires, and a sentence to try.
import { useEffect, useState } from 'react';
import { SOUNDS } from '../../core/audio/sfx.js';
import { MIN_DURATION_MS } from '../../core/motion.js';
import { normalizeReflex, reflexMissing } from '../../core/config.js';
import {
  DRIVES, STEERS, blankQuestion, freshChoice, fromUnsloth, presetIdOf, presetPatch, toUnsloth, unsupported,
} from './reflexEdit';
import { t, type Key } from './i18n';
import type { TryFn } from './checks';
import type { Config, Patch, ReflexCall, ReflexConfig, ReflexOption, ReflexQuestion, SavedReflex } from './types';

export function ReflexTab({ config, saved, update, tryIt }:
  { config: Config; saved: SavedReflex[]; update(p: Patch): void; tryIt: TryFn }) {
  const r = config.reflex;
  const set = (p: Partial<ReflexConfig>) => update({ config: { reflex: p } });
  const setQuestion = (question: ReflexQuestion | null) => set({ question });
  const [view, setView] = useState<'form' | 'json'>('form');
  // Bumped whenever the question is replaced from outside the JSON box, so the
  // box starts over from the new one instead of writing its stale text back.
  const [epoch, setEpoch] = useState(0);
  const replace = (p: Partial<ReflexConfig>) => { setEpoch((e) => e + 1); set(p); };
  const preset = presetIdOf(r, saved);
  const ignored = unsupported(r, config.body.motion);
  // The brain reads this through the same normalisation; when it would read
  // something else, the page says so rather than show what will not run.
  const read = normalizeReflex(r);
  const diverges = JSON.stringify(read.question) !== JSON.stringify(r.question) || read.state !== r.state;

  return (
    <div className="fields">
      <label>{t('reflexPreset')}
        <select
          aria-label={t('reflexPreset')}
          value={preset}
          onChange={(e) => {
            // A hand-edited question exists nowhere else; a preset can be picked again.
            if (preset === 'custom' && !window.confirm(t('confirmReplaceQuestion'))) return;
            replace(presetPatch(e.target.value, saved));
          }}
        >
          <option value="none">{t('presetNone')}</option>
          <option value="bark">{t('presetBark')}</option>
          <option value="commands">{t('presetCommands')}</option>
          {saved.length > 0 && (
            <optgroup label={t('presetsSaved')}>
              {saved.map((s) => <option key={s.name} value={`saved:${s.name}`}>{s.name}</option>)}
            </optgroup>
          )}
          {preset === 'custom' && <option value="custom">{t('presetCustom')}</option>}
        </select>
      </label>
      <SavedButtons reflex={r} saved={saved} current={preset} update={update} />
      {r.question ? (
        <>
          <div className="toggle" role="group" aria-label={t('questionView')}>
            <button type="button" aria-pressed={view === 'form'} onClick={() => setView('form')}>{t('viewForm')}</button>
            <button type="button" aria-pressed={view === 'json'} onClick={() => setView('json')}>JSON</button>
          </div>
          {view === 'form'
            ? <QuestionForm question={r.question} onChange={setQuestion} />
            : <QuestionJson key={epoch} question={r.question} onChange={setQuestion} />}
        </>
      ) : (
        <button type="button" className="secondary" onClick={() => replace({ question: blankQuestion() })}>{t('newQuestion')}</button>
      )}
      {diverges && <p className="hint">{t('reflexDiverges')}</p>}
      {ignored.length > 0 && <p className="hint" role="note">{t('reflexUnsupported').replace('{kinds}', ignored.join(', '))}</p>}
      <label>{t('threshold')}
        <ThresholdInput value={r.threshold} onChange={(threshold) => set({ threshold })} />
      </label>
      <label>{t('stateTemplate')}
        <textarea aria-label={t('stateTemplate')} rows={2} value={r.state} onChange={(e) => set({ state: e.target.value })} />
        <small>{t('stateHint')}</small>
      </label>
      <TryBox config={config} tryIt={tryIt} />
    </div>
  );
}

/**
 * Save the reflex as it stands under a name; rename or delete the saved one
 * it currently is. The list is sent whole, like the provider entries.
 */
function SavedButtons({ reflex: r, saved, current, update }:
  { reflex: ReflexConfig; saved: SavedReflex[]; current: string; update(p: Patch): void }) {
  const mine = current.startsWith('saved:') ? current.slice('saved:'.length) : null;
  // A name typed, trimmed and short enough, and free unless the admin says
  // to replace what has it; null when they backed out anywhere along the way.
  const ask = (start: string, keep: string | null) => {
    const name = window.prompt(t('presetName'), start)?.trim().slice(0, 60);
    if (!name) return null;
    if (name !== keep && saved.some((s) => s.name === name)
      && !window.confirm(t('confirmOverwritePreset').replace('{name}', name))) return null;
    return name;
  };
  const save = () => {
    if (!r.question) return;
    const name = ask(mine ?? '', null);
    if (!name) return;
    const entry = structuredClone({ name, threshold: r.threshold, state: r.state, question: r.question });
    update({ savedReflexes: [...saved.filter((s) => s.name !== name), entry] });
  };
  const rename = () => {
    if (!mine) return;
    const name = ask(mine, mine);
    if (!name || name === mine) return;
    update({ savedReflexes: saved.filter((s) => s.name !== name).map((s) => (s.name === mine ? { ...s, name } : s)) });
  };
  const remove = () => {
    if (!mine || !window.confirm(t('confirmDeletePreset').replace('{name}', mine))) return;
    update({ savedReflexes: saved.filter((s) => s.name !== mine) });
  };
  return (
    <div className="toggle">
      <button type="button" className="secondary" disabled={!r.question} onClick={save}>{t('savePreset')}</button>
      {mine && <button type="button" className="secondary" onClick={rename}>{t('renamePreset')}</button>}
      {mine && <button type="button" className="secondary" onClick={remove}>{t('deletePreset')}</button>}
    </div>
  );
}

/** Its own text, so "0." can be typed on the way to "0.85". */
function ThresholdInput({ value, onChange }: { value: number; onChange(v: number): void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { if (Number(text) !== value) setText(String(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      aria-label={t('threshold')} type="number" min={0} max={1} step={0.05} value={text}
      onChange={(e) => {
        setText(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value !== '' && v >= 0 && v <= 1) onChange(v);
      }}
    />
  );
}

function QuestionForm({ question: q, onChange }: { question: ReflexQuestion; onChange(q: ReflexQuestion): void }) {
  const setOption = (i: number, o: ReflexOption) => onChange({ ...q, options: q.options.map((x, j) => (j === i ? o : x)) });
  return (
    <>
      <label>{t('questionName')}
        <input aria-label={t('questionName')} value={q.name} onChange={(e) => onChange({ ...q, name: e.target.value })} />
      </label>
      <label>{t('instructions')}
        <textarea aria-label={t('instructions')} rows={5} value={q.instructions}
          onChange={(e) => onChange({ ...q, instructions: e.target.value })} />
      </label>
      <table className="criteria">
        <thead><tr><th>{t('option')}</th><th>{t('description')}</th><th>{t('reflexActions')}</th><th /></tr></thead>
        <tbody>
          {q.options.map((o, i) => (
            <tr key={i}>
              <td><input aria-label={`${t('option')} ${i + 1}`} value={o.choice}
                onChange={(e) => setOption(i, { ...o, choice: e.target.value })} /></td>
              <td><input aria-label={`${t('description')} ${i + 1}`} value={o.description}
                onChange={(e) => setOption(i, { ...o, description: e.target.value })} /></td>
              <td><ActionList label={o.choice} actions={o.actions} onChange={(actions) => setOption(i, { ...o, actions })} /></td>
              <td><button type="button" className="icon" aria-label={`${t('removeOption')} ${o.choice}`}
                disabled={q.options.length <= 2}
                onClick={() => onChange({ ...q, options: q.options.filter((_, j) => j !== i) })}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="secondary"
        onClick={() => onChange({ ...q, options: [...q.options, { choice: freshChoice(q), description: '', actions: [] }] })}>
        {t('addOption')}
      </button>
    </>
  );
}

/** A starting call for each kind, so switching kind never leaves stale args. */
function fresh(name: ReflexCall['name']): ReflexCall {
  if (name === 'move') return { name, args: { steps: [{ drive: 'forward', steer: 'straight', duration_ms: 600 }] } };
  if (name === 'cruise') return { name, args: { drive: 'forward', steer: 'straight' } };
  if (name === 'stop') return { name, args: {} };
  return { name, args: { name: SOUNDS[0] } };
}

const KINDS: ReflexCall['name'][] = ['move', 'cruise', 'stop', 'play_sound'];

function ActionList({ label, actions, onChange }: { label: string; actions: ReflexCall[]; onChange(a: ReflexCall[]): void }) {
  const setAt = (i: number, a: ReflexCall) => onChange(actions.map((x, j) => (j === i ? a : x)));
  return (
    <div className="actions">
      {actions.length === 0 && <small>{t('toLlm')}</small>}
      {actions.map((a, i) => {
        const at = `${label} action ${i + 1}`;
        return (
          <div key={i} className="action">
            <select aria-label={at} value={a.name} onChange={(e) => setAt(i, fresh(e.target.value as ReflexCall['name']))}>
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <ActionArgs at={at} call={a} onChange={(c) => setAt(i, c)} />
            <button type="button" className="icon" aria-label={`${at} ${t('removeAction')}`}
              onClick={() => onChange(actions.filter((_, j) => j !== i))}>×</button>
          </div>
        );
      })}
      <button type="button" className="icon" aria-label={`${t('addAction')} ${label}`}
        onClick={() => onChange([...actions, fresh('move')])}>+</button>
    </div>
  );
}

function Pick({ at, field, values, value, onPick }:
  { at: string; field: string; values: readonly string[]; value: string; onPick(v: string): void }) {
  return (
    <select aria-label={`${at} ${field}`} value={value} onChange={(e) => onPick(e.target.value)}>
      {values.map((v) => <option key={v} value={v}>{v}</option>)}
    </select>
  );
}

/** One step per move here; a preset or pasted move with more keeps the rest. */
function ActionArgs({ at, call, onChange }: { at: string; call: ReflexCall; onChange(c: ReflexCall): void }) {
  const a = call.args;
  if (call.name === 'move') {
    const [first = { drive: 'forward', steer: 'straight', duration_ms: 600 }, ...rest] = a.steps ?? [];
    const step = (p: object) => onChange({ ...call, args: { ...a, steps: [{ ...first, ...p }, ...rest] } });
    return (
      <>
        <Pick at={at} field="drive" values={DRIVES} value={first.drive} onPick={(drive) => step({ drive })} />
        <Pick at={at} field="steer" values={STEERS} value={first.steer} onPick={(steer) => step({ steer })} />
        <input aria-label={`${at} duration_ms`} type="number" min={MIN_DURATION_MS} step={100} value={first.duration_ms}
          onChange={(e) => { const v = e.target.valueAsNumber; if (Number.isInteger(v)) step({ duration_ms: v }); }} />
        <small>ms</small>
      </>
    );
  }
  if (call.name === 'cruise') {
    return (
      <>
        <Pick at={at} field="drive" values={DRIVES} value={a.drive} onPick={(drive) => onChange({ ...call, args: { ...a, drive } })} />
        <Pick at={at} field="steer" values={STEERS} value={a.steer} onPick={(steer) => onChange({ ...call, args: { ...a, steer } })} />
      </>
    );
  }
  if (call.name === 'play_sound') {
    return <Pick at={at} field="sound" values={SOUNDS} value={a.name} onPick={(name) => onChange({ ...call, args: { name } })} />;
  }
  return null;
}

function QuestionJson({ question, onChange }: { question: ReflexQuestion; onChange(q: ReflexQuestion): void }) {
  // Actions are kept from the question as it was on opening (see fromUnsloth).
  const [base] = useState(question);
  const [text, setText] = useState(() => toUnsloth(question));
  const [error, setError] = useState<Key | null>(null);
  return (
    <label>{t('questionJson')}
      <textarea
        aria-label={t('questionJson')} rows={16} spellCheck={false} value={text}
        onChange={(e) => {
          setText(e.target.value);
          const r = fromUnsloth(e.target.value, base);
          if ('error' in r) { setError(r.error); return; }
          setError(null);
          onChange(r.question);
        }}
      />
      {error && <p role="alert" className="error">{t(error)}</p>}
    </label>
  );
}

/** The page's names for what reflexMissing() reports, in its order. */
const NEEDS: Record<ReturnType<typeof reflexMissing>[number], Key> =
  { baseURL: 'provider', apiKey: 'key', model: 'model', question: 'aQuestion' };
const missingNames = (r: ReflexConfig) => reflexMissing(r).map((k) => t(NEEDS[k]));

/**
 * Above the provider, because it switches the whole layer. Says what the brain
 * will actually do: on and complete, off, or on but still missing something —
 * the last two used to look the same.
 */
export function ReflexSwitch({ reflex: r, update }: { reflex: ReflexConfig; update(p: Patch): void }) {
  const on = r.enabled !== false;
  const missing = missingNames(r);
  const set = (enabled: boolean) => update({ config: { reflex: { enabled } } });
  return (
    <div className="fields switch">
      <div className="toggle" role="group" aria-label={t('reflexSwitch')}>
        <button type="button" aria-pressed={on} onClick={() => set(true)}>{t('switchOn')}</button>
        <button type="button" aria-pressed={!on} onClick={() => set(false)}>{t('switchOff')}</button>
      </div>
      <p className="hint">
        {!on ? t('reflexOff') : missing.length ? t('reflexIncomplete') + missing.join(', ') : t('reflexRunning')}
      </p>
    </div>
  );
}

function TryBox({ config, tryIt }: { config: Config; tryIt: TryFn }) {
  const [heard, setHeard] = useState('');
  const [robot, setRobot] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="test">
      <label>{t('personSaid')}
        <input aria-label={t('personSaid')} value={heard} onChange={(e) => setHeard(e.target.value)} />
      </label>
      <label>{t('robotSaid')}
        <input aria-label={t('robotSaid')} value={robot} onChange={(e) => setRobot(e.target.value)} />
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          // Clickable while incomplete, so it can say what is missing — all of
          // it at once, by the same rule the brain uses (switched off or not).
          const missing = missingNames(config.reflex);
          if (!heard.trim()) missing.push(t('personSaid'));
          if (missing.length) { setResult({ ok: false, text: t('stillNeeded') + missing.join(', ') }); return; }
          setBusy(true);
          setResult(null);
          try {
            setResult({ ok: true, text: await tryIt(config, heard.trim(), robot.trim()) });
          } catch (err) {
            setResult({ ok: false, text: (err as Error).message });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? t('testing') : t('tryIt')}
      </button>
      {result && <p role="status" className={result.ok ? 'result ok' : 'result bad'}>{result.text}</p>}
    </div>
  );
}
