// The reflex tab below the provider fields (configurable reflex spec §4):
// which question, what each answer does, when it fires, and a sentence to try.
import { useEffect, useState } from 'react';
import { SOUNDS } from '../../core/audio/sfx.js';
import { MIN_DURATION_MS } from '../../core/motion.js';
import {
  DRIVES, STEERS, blankQuestion, freshChoice, fromUnsloth, presetIdOf, presetPatch, toUnsloth, unsupported,
} from './reflexEdit';
import { t, type Key } from './i18n';
import type { TryFn } from './checks';
import type { Config, Patch, ReflexCall, ReflexConfig, ReflexOption, ReflexQuestion } from './types';

export function ReflexTab({ config, update, tryIt }: { config: Config; update(p: Patch): void; tryIt: TryFn }) {
  const r = config.reflex;
  const set = (p: Partial<ReflexConfig>) => update({ config: { reflex: p } });
  const setQuestion = (question: ReflexQuestion | null) => set({ question });
  const [view, setView] = useState<'form' | 'json'>('form');
  const preset = presetIdOf(r);
  const ignored = unsupported(r, config.body.motion);

  return (
    <div className="fields">
      <label>{t('reflexPreset')}
        <select aria-label={t('reflexPreset')} value={preset} onChange={(e) => set(presetPatch(e.target.value))}>
          <option value="none">{t('presetNone')}</option>
          <option value="bark">{t('presetBark')}</option>
          <option value="commands">{t('presetCommands')}</option>
          {preset === 'custom' && <option value="custom">{t('presetCustom')}</option>}
        </select>
      </label>
      {r.question ? (
        <>
          <div className="toggle" role="group" aria-label={t('questionView')}>
            <button type="button" aria-pressed={view === 'form'} onClick={() => setView('form')}>{t('viewForm')}</button>
            <button type="button" aria-pressed={view === 'json'} onClick={() => setView('json')}>JSON</button>
          </div>
          {view === 'form'
            ? <QuestionForm question={r.question} onChange={setQuestion} />
            : <QuestionJson question={r.question} onChange={setQuestion} />}
        </>
      ) : (
        <button type="button" className="secondary" onClick={() => setQuestion(blankQuestion())}>{t('newQuestion')}</button>
      )}
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
        disabled={busy || !heard.trim() || !config.reflex.question}
        onClick={async () => {
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
