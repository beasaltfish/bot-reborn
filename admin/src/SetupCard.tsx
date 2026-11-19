import { t, type Key } from './i18n';
import type { Step, StepId, StepSource } from './setup';

const copy: Record<StepId, [title: Key, note: Key]> = {
  character: ['setupCharacter', 'setupCharacterNote'],
  keys: ['setupKeys', 'setupKeysNote'],
  'body-screen': ['setupBody', 'setupBodyNote'],
  board: ['setupBoard', 'setupBoardNote'],
  'first-words': ['setupFirstWords', 'setupFirstWordsNote'],
};

const source: Record<StepSource, Key> = {
  brain: 'setupSourceBrain',
  browser: 'setupSourceBrowser',
  none: 'setupSourceNone',
};

export function SetupCard({ steps, next }: { steps: Step[]; next: Step | null }) {
  const required = steps.filter((step) => !step.optionalFor);
  const done = required.filter((step) => step.done).length;
  const allDone = done === required.length;
  const current = next && !next.optionalFor ? next : null;
  const phone = steps.some((step) => step.optionalFor === 'phone');
  const checklist = (
    <>
      <ol className="setup-steps">
        {steps.map((step) => {
          const skipped = step.optionalFor === 'phone';
          const [title, defaultNote] = copy[step.id];
          const note = skipped ? 'setupBoardSkipped' : step.id === 'body-screen' && phone ? 'setupPhoneNote' : defaultNote;
          return (
            <li key={step.id} data-step={step.id} data-done={!skipped && step.done}
              aria-current={current?.id === step.id ? 'step' : undefined}>
              <div className="setup-row">
                <strong>{t(title)}</strong>
                <span className="setup-meta">
                  <span className="setup-state">{t(skipped ? 'setupSkipped' : step.done ? 'setupDone' : 'setupTodo')}</span>
                  <span className="setup-source">{t(source[step.source])}</span>
                </span>
              </div>
              <p>{t(note)}</p>
            </li>
          );
        })}
      </ol>
      <p className="setup-caveat">{t('setupRestart')}</p>
    </>
  );

  return (
    <section className="setup" aria-label={t('setupTitle')}>
      {allDone ? (
        <details>
          <summary>{t('setupAllDone')}</summary>
          {checklist}
        </details>
      ) : (
        <>
          <header>
            <h2>{t('setupTitle')}</h2>
            <span>{t('setupProgress').replace('{done}', String(done)).replace('{total}', String(required.length))}</span>
          </header>
          {checklist}
        </>
      )}
      <p role="status" className={current ? 'setup-next' : 'sr-only'}>
        {allDone ? t('setupAllDone') : current && t('setupNext').replace('{step}', t(copy[current.id][0]))}
      </p>
    </section>
  );
}
