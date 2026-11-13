import { initialLessonState, lessonStateProgress, reduceLesson } from '../lessons/schema.js';
import { readLessonProgress, writeLessonProgress } from '../lessons/progress.js';
import { projectById } from '../projects.js';
import { simText } from './strings.js';

/** @typedef {{kind:'range',min:number,max:number,step:number,value:number,unit?:string} | {kind:'select',options:string[],value:string} | {kind:'toggle'} | {kind:'button'}} ControlDef */
/** @type {Record<string, ControlDef>} */
const CONTROLS = {
  chemistry: { kind: 'select', options: ['alkaline', 'nimh'], value: 'alkaline' },
  charge: { kind: 'range', min: 0, max: 100, step: 1, value: 100, unit: '%' },
  pressed: { kind: 'toggle' },
  distanceCm: { kind: 'range', min: 2, max: 400, step: 1, value: 100, unit: 'cm' },
  measure: { kind: 'button' },
  temperature: { kind: 'range', min: -10, max: 50, step: 0.1, value: 25, unit: '°C' },
  humidity: { kind: 'range', min: 0, max: 100, step: 1, value: 50, unit: '%' },
  pressure: { kind: 'range', min: 800, max: 1200, step: 1, value: 1013, unit: 'hPa' },
  angle: { kind: 'range', min: 0, max: 180, step: 1, value: 90, unit: '°' },
  direction: { kind: 'select', options: ['forward', 'reverse', 'coast', 'brake'], value: 'forward' },
  speed: { kind: 'range', min: 0, max: 1, step: 0.05, value: 0.5 },
  pixels: { kind: 'range', min: 1, max: 60, step: 1, value: 8, unit: 'px' },
  color: { kind: 'select', options: ['off', 'red', 'green', 'blue', 'white'], value: 'white' },
  load: { kind: 'select', options: ['idle', 'load', 'stall'], value: 'idle' },
};

/** A generic five-stage panel for lessons without a bespoke circuit panel. */
export function createLessonPanel(/** @type {{lesson: import('../lessons/schema.js').Lesson, store: import('../lessons/progress.js').Store|null, lang: string, onControl?: (name: string, value: string) => void}} */ opts) {
  const element = document.createElement('section');
  element.className = 'lesson-panel';
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
  const lesson = opts.lesson;
  const project = projectById(lesson.projectId);
  let lang = opts.lang;
  let state = initialLessonState(lesson, readLessonProgress(opts.store));
  let saved = opts.store !== null;
  /** @type {Set<number>} */ const wired = new Set();
  /** @type {Record<string, string>} */ const controlValues = {};
  const text = (/** @type {string} */ key) => simText(lang, key);
  function persist() {
    saved = writeLessonProgress(opts.store, { version: 1, lessons: { [lesson.id]: lessonStateProgress(state) } });
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
  /** @param {string} name @param {string} value */
  function controlChanged(name, value) {
    controlValues[name] = value;
    opts.onControl?.(name, value);
    dispatch({ type: 'observe', action: { type: 'control-change', value: name } });
  }
  function renderControl(/** @type {string} */ name) {
    const definition = CONTROLS[name] ?? { kind: 'button' };
    const label = document.createElement('label');
    const caption = document.createElement('span');
    caption.textContent = text(`lesson.control.${name}`);
    label.append(caption);
    if (definition.kind === 'range') {
      const input = document.createElement('input');
      input.type = 'range'; input.min = String(definition.min); input.max = String(definition.max); input.step = String(definition.step);
      input.value = controlValues[name] ?? String(definition.value);
      input.dataset.control = name;
      const output = document.createElement('output'); output.textContent = `${input.value}${definition.unit ? ` ${definition.unit}` : ''}`;
      input.addEventListener('input', () => {
        output.textContent = `${input.value}${definition.unit ? ` ${definition.unit}` : ''}`;
        controlChanged(name, input.value);
      });
      label.append(input, output);
    } else if (definition.kind === 'select') {
      const select = document.createElement('select');
      select.dataset.control = name;
      for (const option of definition.options) {
        const item = document.createElement('option'); item.value = option;
        item.textContent = text(`lesson.value.${option}`);
        select.append(item);
      }
      select.value = controlValues[name] ?? definition.value;
      select.addEventListener('change', () => controlChanged(name, select.value));
      label.append(select);
    } else if (definition.kind === 'toggle') {
      const input = document.createElement('input'); input.type = 'checkbox'; input.dataset.control = name;
      input.checked = controlValues[name] === 'true';
      input.addEventListener('change', () => controlChanged(name, String(input.checked)));
      label.append(input);
    } else {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.control = name;
      button.textContent = text('lesson.trigger');
      button.addEventListener('click', () => controlChanged(name, 'true'));
      label.append(button);
    }
    return label;
  }
  function render() {
    const index = lesson.stages.findIndex(stage => stage.id === state.stageId);
    const stage = lesson.stages[index];
    element.setAttribute('aria-label', text(lesson.titleKey));
    heading.textContent = `${index + 1}/${lesson.stages.length} · ${text(stage.titleKey)}`;
    body.textContent = text(stage.bodyKey);
    completion.textContent = text(state.completedStageIds.includes(stage.id) ? 'lesson.completed' : 'lesson.inProgress');
    previous.textContent = text('lesson.back'); previous.disabled = index === 0;
    next.textContent = text('lesson.next'); next.disabled = index === lesson.stages.length - 1;
    navigation.setAttribute('aria-label', text('lesson.navigation'));
    storageMessage.textContent = saved ? '' : text('lesson.notSaved');
    activity.replaceChildren();
    if (stage.kind === 'recognize') {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.action = 'acknowledge';
      button.textContent = text('lesson.reviewed');
      button.addEventListener('click', () => dispatch({ type: 'observe', action: { type: 'acknowledge' } }));
      activity.append(button);
    } else if (stage.kind === 'pins') {
      for (const pin of stage.focusPoints) {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.pin = pin;
        button.textContent = `${text('lesson.pin')} ${pin}`;
        button.addEventListener('click', () => dispatch({ type: 'observe', action: { type: 'select-pin', value: pin } }));
        activity.append(button);
      }
    } else if (stage.kind === 'wire') {
      const note = document.createElement('p'); note.textContent = text('lesson.practiceLocal'); activity.append(note);
      if (project) {
        const list = document.createElement('ol');
        project.links.forEach((link, i) => {
          const row = document.createElement('li');
          const description = document.createElement('span'); description.textContent = `${link.a} → ${link.b}`;
          const button = document.createElement('button'); button.type = 'button'; button.dataset.wire = String(i);
          button.textContent = text(wired.has(i) ? 'lesson.connected' : 'lesson.connect');
          button.disabled = wired.has(i);
          button.setAttribute('aria-label', `${button.textContent}: ${link.a} → ${link.b}`);
          button.addEventListener('click', () => {
            wired.add(i);
            if (wired.size === project.links.length) dispatch({ type: 'observe', action: { type: 'wire-complete' } });
            else render();
          });
          row.append(description, button); list.append(row);
        });
        activity.append(list);
      } else {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.action = 'wire-complete';
        button.textContent = text('lesson.markComplete');
        button.addEventListener('click', () => dispatch({ type: 'observe', action: { type: 'wire-complete' } }));
        activity.append(button);
      }
    } else if (stage.kind === 'try') {
      for (const control of stage.controls) activity.append(renderControl(control));
    } else if (stage.kind === 'fault') {
      for (const event of stage.completion.events.filter(item => item.type === 'fault-observed')) {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.fault = String(event.value);
        button.textContent = text(`lesson.fault.${event.value}`);
        button.addEventListener('click', () => dispatch({ type: 'observe', action: { type: 'fault-observed', value: String(event.value) } }));
        activity.append(button);
      }
    }
  }
  previous.addEventListener('click', () => dispatch({ type: 'back' }));
  next.addEventListener('click', () => dispatch({ type: 'next' }));
  render();
  return {
    element,
    setLanguage(/** @type {string} */ value) { lang = value; render(); },
  };
}
