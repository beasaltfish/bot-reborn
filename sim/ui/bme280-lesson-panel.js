import { BME280_LESSON } from '../lessons/bme280.js';
import { BME280_PROJECT } from '../projects.js';
import { emptyBench, setPartProperty } from '../bench.js';
import { applyStep, startBench } from '../recipes.js';
import { evaluateBench } from '../devices/evaluate.js';
import { defaultStimuli } from '../stimuli.js';
import { initialLessonState, lessonStateProgress, reduceLesson } from '../lessons/schema.js';
import { readLessonProgress, writeLessonProgress } from '../lessons/progress.js';
import { projectReason } from './project-copy.js';
import { simText } from './strings.js';

/** @param {{store:import('../lessons/progress.js').Store|null,lang:string,example:ReturnType<typeof import('../lessons/bme280-example.js').createBme280LabExample>,changed():void}} opts */
export function createBme280LessonPanel(opts) {
  const element = document.createElement('section'); element.className = 'lesson-panel';
  const heading = document.createElement('h2'), body = document.createElement('p'), completion = document.createElement('p');
  completion.setAttribute('role', 'status');
  const activity = document.createElement('div'), storageMessage = document.createElement('p'); storageMessage.setAttribute('role', 'status');
  const previous = document.createElement('button'); previous.type = 'button'; previous.dataset.action = 'back';
  const next = document.createElement('button'); next.type = 'button'; next.dataset.action = 'next';
  const navigation = document.createElement('nav'); navigation.append(previous, next);
  element.append(heading, body, completion, activity, navigation, storageMessage);
  let lang = opts.lang;
  let state = initialLessonState(BME280_LESSON, readLessonProgress(opts.store));
  let saved = opts.store !== null;
  /** @type {'0x76'|'0x77'} */ let address = '0x77';
  let bench = BME280_PROJECT.steps.filter(step => step.kind !== 'wire').reduce(applyStep, startBench(emptyBench()));
  const wires = BME280_PROJECT.steps.filter(step => step.kind === 'wire');
  /** @type {Set<number>} */ const connected = new Set();
  const text = (/** @type {string} */ key) => simText(lang, key);
  /** @param {import('../lessons/schema.js').LessonEvent} event */
  function dispatch(event) {
    const updated = reduceLesson(state, event);
    if (updated === state) return;
    const changed = updated.stageId !== state.stageId || updated.completedStageIds !== state.completedStageIds;
    state = updated;
    if (changed) saved = writeLessonProgress(opts.store, { version: 1, lessons: { [BME280_LESSON.id]: lessonStateProgress(state) } });
    render();
  }
  function render() {
    const index = BME280_LESSON.stages.findIndex(stage => stage.id === state.stageId);
    const stage = BME280_LESSON.stages[index];
    element.setAttribute('aria-label', text('lesson.bme.title'));
    heading.textContent = `${index + 1}/${BME280_LESSON.stages.length} · ${text(stage.titleKey)}`;
    body.textContent = text(stage.bodyKey);
    completion.textContent = text(state.completedStageIds.includes(stage.id) ? 'lesson.completed' : 'lesson.inProgress');
    previous.textContent = text('lesson.back'); previous.disabled = index === 0;
    next.textContent = text('lesson.next'); next.disabled = index === BME280_LESSON.stages.length - 1;
    navigation.setAttribute('aria-label', text('lesson.navigation'));
    storageMessage.textContent = saved ? '' : text('lesson.notSaved');
    activity.replaceChildren();
    if (stage.kind === 'recognize') {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.action = 'acknowledge'; button.textContent = text('lesson.bme.reviewed');
      button.addEventListener('click', () => dispatch({ type: 'observe', action: { type: 'acknowledge' } })); activity.append(button);
    }
    if (stage.kind === 'pins') {
      const label = document.createElement('label'); label.textContent = `${text('lesson.bme.address')} `;
      const select = document.createElement('select'); select.dataset.control = 'address';
      for (const value of ['0x77', '0x76']) { const option = document.createElement('option'); option.value = value; option.textContent = value; select.append(option); }
      select.value = address;
      select.addEventListener('change', () => {
        address = select.value === '0x76' ? '0x76' : '0x77';
        bench = setPartProperty(bench, 'env', 'address', address);
        opts.example.setAddress(address); opts.changed();
        dispatch({ type: 'observe', action: { type: 'control-change', value: 'address' } });
        /** @type {HTMLSelectElement|null} */ (activity.querySelector('[data-control="address"]'))?.focus();
      });
      label.append(select); activity.append(label);
    }
    if (stage.kind === 'wire') {
      const note = document.createElement('p'); note.textContent = text('lesson.practiceLocal'); activity.append(note);
      const list = document.createElement('ol');
      BME280_PROJECT.links.forEach((link, i) => {
        const row = document.createElement('li'), description = document.createElement('span');
        description.textContent = `${link.a} → ${link.b}: ${projectReason(lang, link.why)}`;
        const button = document.createElement('button'); button.type = 'button'; button.dataset.connect = String(i); button.disabled = connected.has(i);
        button.textContent = text(connected.has(i) ? 'lesson.connected' : 'lesson.connect');
        button.setAttribute('aria-label', `${button.textContent}: ${link.a} → ${link.b}`);
        button.addEventListener('click', () => {
          if (!connected.has(i)) { bench = applyStep(bench, wires[i]); connected.add(i); }
          if (connected.size === wires.length && evaluateBench({ ...bench, usb: true }).engineering.bme280.env?.state === 'ready') dispatch({ type: 'observe', action: { type: 'wire-complete' } });
          else render();
          (/** @type {HTMLButtonElement|null} */ (activity.querySelector('button:not(:disabled)')) ?? next).focus();
        });
        row.append(description, button); list.append(row);
      });
      activity.append(list);
    }
    if (stage.kind === 'fault') {
      for (const scenario of /** @type {const} */ (['swapped', 'conflict', 'normal'])) {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.scenario = scenario; button.textContent = text(`lesson.bme.${scenario}`);
        button.addEventListener('click', () => {
          opts.example.setScenario(scenario); opts.changed();
          const outcome = opts.example.evaluate(defaultStimuli()).state;
          if (outcome === 'swapped') dispatch({ type: 'observe', action: { type: 'fault-observed', value: 'i2c-sda-scl-swapped' } });
          if (outcome === 'address-conflict') dispatch({ type: 'observe', action: { type: 'fault-observed', value: 'i2c-address-conflict' } });
          /** @type {HTMLButtonElement|null} */ (activity.querySelector(`[data-scenario="${scenario}"]`))?.focus();
        });
        activity.append(button);
      }
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
  };
}
