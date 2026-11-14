import { LED_LESSON } from '../lessons/led.js';
import { LED_PROJECT } from '../projects.js';
import { createLedLabCircuit } from '../lessons/led-circuit.js';
import { initialLessonState, lessonStateProgress, reduceLesson } from '../lessons/schema.js';
import { readLessonProgress, writeLessonProgress } from '../lessons/progress.js';
import { connectionProgress } from '../project-progress.js';
import { DEFAULT_LED_FORWARD_VOLTAGE } from '../electrical/led.js';
import { projectReason } from './project-copy.js';
import { simText } from './strings.js';

/** @param {{store:import('../lessons/progress.js').Store|null,lang:string}} opts */
export function createLedLessonPanel(opts) {
  const element = document.createElement('section');
  element.className = 'lesson-panel';
  element.setAttribute('aria-label', simText(opts.lang, 'lesson.led.title'));
  const heading = document.createElement('h2');
  const body = document.createElement('p');
  const completion = document.createElement('p');
  completion.setAttribute('role', 'status');
  const activity = document.createElement('div');
  const storageMessage = document.createElement('p');
  storageMessage.setAttribute('role', 'status');
  const previous = document.createElement('button'); previous.type = 'button'; previous.dataset.action = 'back';
  const next = document.createElement('button'); next.type = 'button'; next.dataset.action = 'next';
  const navigation = document.createElement('nav'); navigation.append(previous, next);
  element.append(heading, body, completion, activity, navigation, storageMessage);
  let lang = opts.lang;
  let state = initialLessonState(LED_LESSON, readLessonProgress(opts.store));
  let saved = opts.store !== null;
  const circuit = createLedLabCircuit();
  const text = (/** @type {string} */ key) => simText(lang, key);
  function persist() {
    saved = writeLessonProgress(opts.store, { version: 1, lessons: { [LED_LESSON.id]: lessonStateProgress(state) } });
  }
  /** @param {import('../lessons/schema.js').LessonEvent} event */
  function dispatch(event) {
    const updated = reduceLesson(state, event);
    if (updated === state) return;
    const changed = updated.stageId !== state.stageId || updated.completedStageIds !== state.completedStageIds;
    state = updated;
    if (changed) persist();
    render();
  }
  function render() {
    const index = LED_LESSON.stages.findIndex(stage => stage.id === state.stageId);
    const stage = LED_LESSON.stages[index];
    element.setAttribute('aria-label', text('lesson.led.title'));
    heading.textContent = `${index + 1}/${LED_LESSON.stages.length} · ${text(stage.titleKey)}`;
    body.textContent = text(stage.bodyKey);
    completion.textContent = text(state.completedStageIds.includes(stage.id) ? 'lesson.completed' : 'lesson.inProgress');
    previous.textContent = text('lesson.back'); previous.disabled = index === 0;
    next.textContent = text('lesson.next'); next.disabled = index === LED_LESSON.stages.length - 1;
    navigation.setAttribute('aria-label', text('lesson.navigation'));
    storageMessage.textContent = saved ? '' : text('lesson.notSaved');
    activity.replaceChildren();
    if (stage.kind === 'recognize') {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.action = 'acknowledge'; button.textContent = text('lesson.reviewed');
      button.addEventListener('click', () => dispatch({ type: 'observe', action: { type: 'acknowledge' } }));
      activity.append(button);
    }
    if (stage.kind === 'wire') {
      const note = document.createElement('p'); note.textContent = text('lesson.practiceLocal'); activity.append(note);
      const list = document.createElement('ol');
      for (const [i, link] of connectionProgress(circuit.bench(), LED_PROJECT).entries()) {
        const row = document.createElement('li');
        const description = document.createElement('span');
        description.textContent = `${link.a} → ${link.b}: ${projectReason(lang, LED_PROJECT.links[i].why)}`;
        const button = document.createElement('button'); button.type = 'button'; button.dataset.connect = String(i);
        button.textContent = text(link.status === 'complete' ? 'lesson.connected' : 'lesson.connect');
        button.disabled = link.status === 'complete';
        button.setAttribute('aria-label', `${button.textContent}: ${link.a} → ${link.b}`);
        button.addEventListener('click', () => {
          circuit.connect(i);
          if (circuit.complete()) dispatch({ type: 'observe', action: { type: 'wire-complete' } });
          else render();
          const remaining = /** @type {HTMLButtonElement|null} */ (activity.querySelector('button:not(:disabled)'));
          (remaining ?? next).focus();
        });
        row.append(description, button); list.append(row);
      }
      activity.append(list);
    }
  }
  previous.addEventListener('click', () => { dispatch({ type: 'back' }); if (previous.disabled) next.focus(); });
  next.addEventListener('click', () => { dispatch({ type: 'next' }); if (next.disabled) previous.focus(); });
  render();
  return {
    element,
    setLanguage(/** @type {string} */ value) { lang = value; render(); },
    selectPin(/** @type {string} */ pin) { dispatch({ type: 'observe', action: { type: 'select-pin', value: pin } }); },
    controlChanged(/** @type {string} */ control) { dispatch({ type: 'observe', action: { type: 'control-change', value: control } }); },
    /** @param {{reversed:boolean,voltage:number,resistance:number,state:string}} result */
    experiment(result) {
      if (result.reversed && result.voltage > DEFAULT_LED_FORWARD_VOLTAGE && result.state === 'reversed') dispatch({ type: 'observe', action: { type: 'fault-observed', value: 'led-reversed' } });
      if (!result.reversed && result.resistance === 0 && result.state === 'overcurrent') dispatch({ type: 'observe', action: { type: 'fault-observed', value: 'led-overcurrent' } });
    },
  };
}
