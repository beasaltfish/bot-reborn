import { PARTS } from '../parts.js';
import { hasSimText } from '../ui/strings.js';
import { progressForLesson } from './progress.js';

/** @typedef {{type:string, value?:string}} LessonAction */
/** @typedef {{id:string, kind:string, titleKey:string, bodyKey:string, focusPoints:string[], completion:{events:LessonAction[]}, controls:string[]}} LessonStage */
/** @typedef {{id:string, part:string, version:number, titleKey:string, stages:LessonStage[], projectId:string}} Lesson */
/** @typedef {{lesson:Lesson, stageId:string, completedStageIds:string[], evidence:Record<string,number[]>}} LessonState */
/** @typedef {{type:'next'|'back'}|{type:'go',stageId:string}|{type:'observe',action:LessonAction}} LessonEvent */
const KINDS = ['recognize', 'pins', 'wire', 'try', 'fault'];
const ACTIONS = new Set(['acknowledge', 'select-pin', 'wire-complete', 'control-change', 'fault-observed']);
/** @param {unknown} value @returns {value is Record<string, any>} */
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
/** @param {unknown} value @returns {value is string} */
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);

/** Validate untrusted structured lesson data against device pins and known projects.
 * @param {unknown} lesson @param {Record<string, unknown>} devices @param {{id:string}[]} projects @returns {string[]}
 */
export function validateLesson(lesson, devices, projects) {
  if (!object(lesson)) return ['lesson: expected object'];
  /** @type {string[]} */ const errors = [];
  const issue = (/** @type {string} */ field) => errors.push(`${field}: invalid`);
  for (const key of Object.keys(lesson)) if (!['id', 'part', 'version', 'titleKey', 'stages', 'projectId'].includes(key)) issue(key);
  if (!identifier(lesson.id)) issue('id');
  if (!identifier(lesson.part) || !Object.hasOwn(devices, lesson.part) || !Object.hasOwn(PARTS, lesson.part)) issue('part');
  if (!Number.isSafeInteger(lesson.version) || lesson.version < 1) issue('version');
  /** @param {unknown} key */
  const translated = key => typeof key === 'string' && hasSimText('en', key) && hasSimText('zh', key);
  if (!translated(lesson.titleKey)) issue('titleKey');
  if (!identifier(lesson.projectId) || !projects.some(project => project.id === lesson.projectId)) issue('projectId');
  if (!Array.isArray(lesson.stages) || lesson.stages.length !== KINDS.length) { issue('stages'); return errors; }
  const part = Object.hasOwn(PARTS, lesson.part) ? PARTS[lesson.part] : undefined;
  const validPins = new Set(part?.pins.map(pin => pin.name) ?? []);
  const ids = new Set();
  Array.from(lesson.stages).forEach((stage, i) => {
    const path = `stages[${i}]`;
    if (!object(stage)) { issue(path); return; }
    for (const key of Object.keys(stage)) if (!['id', 'kind', 'titleKey', 'bodyKey', 'focusPoints', 'completion', 'controls'].includes(key)) issue(`${path}.${key}`);
    if (!identifier(stage.id) || ids.has(stage.id)) issue(`${path}.id`); else ids.add(stage.id);
    if (stage.kind !== KINDS[i]) issue(`${path}.kind`);
    if (!translated(stage.titleKey)) issue(`${path}.titleKey`);
    if (!translated(stage.bodyKey)) issue(`${path}.bodyKey`);
    if (!Array.isArray(stage.focusPoints) || Array.from(stage.focusPoints).some((/** @type {unknown} */ pin) => typeof pin !== 'string' || !validPins.has(pin))) issue(`${path}.focusPoints`);
    if (!Array.isArray(stage.controls) || Array.from(stage.controls).some((/** @type {unknown} */ control) => !identifier(control)) || new Set(stage.controls).size !== stage.controls.length) issue(`${path}.controls`);
    if (!object(stage.completion) || !Array.isArray(stage.completion.events) || !stage.completion.events.length) { issue(`${path}.completion`); return; }
    const seen = new Set();
    for (const event of stage.completion.events) {
      if (!object(event) || Object.keys(event).some(key => !['type', 'value'].includes(key)) || !ACTIONS.has(event.type)
        || (event.type !== 'select-pin' && event.value !== undefined && !identifier(event.value))
        || (event.type === 'select-pin' && !validPins.has(event.value))
        || (event.type === 'control-change' && (!Array.isArray(stage.controls) || !stage.controls.includes(event.value)))
        || (event.type === 'fault-observed' && !identifier(event.value))) { issue(`${path}.completion`); continue; }
      const key = JSON.stringify([event.type, event.value ?? null]);
      if (seen.has(key)) issue(`${path}.completion`); else seen.add(key);
    }
  });
  return errors;
}

/** @param {Lesson} lesson @param {import('./progress.js').Progress} [progress] @returns {LessonState} */
export function initialLessonState(lesson, progress = { version: 1, lessons: {} }) {
  const saved = progressForLesson(progress, lesson);
  return { lesson, stageId: saved.lastStageId ?? lesson.stages[0].id, completedStageIds: saved.completedStageIds, evidence: {} };
}

/** @param {LessonState} state @param {LessonEvent} event @returns {LessonState} */
export function reduceLesson(state, event) {
  const index = state.lesson.stages.findIndex(stage => stage.id === state.stageId);
  if (index < 0) return state;
  if (event.type === 'go') return state.lesson.stages.some(stage => stage.id === event.stageId) ? { ...state, stageId: event.stageId } : state;
  if (event.type === 'next' || event.type === 'back') {
    const next = Math.max(0, Math.min(state.lesson.stages.length - 1, index + (event.type === 'next' ? 1 : -1)));
    return next === index ? state : { ...state, stageId: state.lesson.stages[next].id };
  }
  if (event.type !== 'observe') return state;
  const stage = state.lesson.stages[index];
  const match = stage.completion.events.findIndex(expected => expected.type === event.action.type && (expected.value === undefined || expected.value === event.action.value));
  if (match < 0) return state;
  const previous = Object.hasOwn(state.evidence, stage.id) ? state.evidence[stage.id] : [];
  const observed = [...new Set([...previous, match])];
  const completedStageIds = observed.length === stage.completion.events.length && !state.completedStageIds.includes(stage.id)
    ? [...state.completedStageIds, stage.id] : state.completedStageIds;
  return { ...state, evidence: { ...state.evidence, [stage.id]: observed }, completedStageIds };
}

/** @param {LessonState} state @returns {import('./progress.js').LessonProgress} */
export function lessonStateProgress(state) {
  return { lessonVersion: state.lesson.version, completedStageIds: [...state.completedStageIds], lastStageId: state.stageId };
}
