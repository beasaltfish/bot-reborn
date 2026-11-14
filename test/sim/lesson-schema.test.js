import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLesson, initialLessonState, reduceLesson, lessonStateProgress } from '../../sim/lessons/schema.js';
import { lessonByPart } from '../../sim/lessons/index.js';
import { DEVICES } from '../../sim/devices/catalog.js';
import { PROJECTS } from '../../sim/projects.js';

/** @returns {import('../../sim/lessons/schema.js').Lesson} */
function fixture() {
  return {
    id: 'fixture-led', part: 'led-5mm', version: 1, titleKey: 'name.led-5mm', projectId: PROJECTS[0].id,
    stages: ['recognize', 'pins', 'wire', 'try', 'fault'].map(kind => ({
      id: kind, kind, titleKey: 'name.led-5mm', bodyKey: 'summary.led-5mm', focusPoints: kind === 'pins' ? ['A', 'K'] : [],
      controls: [], completion: { events: kind === 'pins' ? [{ type: 'select-pin', value: 'A' }, { type: 'select-pin', value: 'K' }] : [{ type: 'acknowledge' }] },
    })),
  };
}

test('unknown parts have no lesson instead of a fake placeholder', () => {
  assert.equal(lessonByPart('missing'), null);
});

test('valid lesson has five ordered stages and validated pins, actions and bilingual keys', () => {
  const lesson = fixture();
  assert.deepEqual(validateLesson(lesson, DEVICES, PROJECTS), []);
  lesson.stages[1].focusPoints.push('missing');
  lesson.stages[1].completion.events[0].type = 'invented';
  lesson.stages[2].bodyKey = 'missing.translation';
  const errors = validateLesson(lesson, DEVICES, PROJECTS).join(' ');
  assert.match(errors, /focusPoints/);
  assert.match(errors, /completion/);
  assert.match(errors, /bodyKey/);
});

test('unknown fields, duplicate stages, wrong order and missing projects are rejected', () => {
  const lesson = fixture();
  lesson.stages[1].id = 'recognize';
  lesson.stages[0].kind = 'wire';
  lesson.projectId = 'missing';
  Object.assign(lesson, { extra: true });
  const errors = validateLesson(lesson, DEVICES, PROJECTS).join(' ');
  assert.match(errors, /extra/);
  assert.match(errors, /id/);
  assert.match(errors, /kind/);
  assert.match(errors, /projectId/);
});

test('invalid or sparse lesson data is rejected without throwing', () => {
  const lesson = fixture();
  lesson.part = '__proto__';
  assert.doesNotThrow(() => validateLesson(lesson, DEVICES, PROJECTS));
  assert.ok(validateLesson(lesson, DEVICES, PROJECTS).some(error => error.includes('part')));
  lesson.part = 'led-5mm';
  delete /** @type {any} */ (lesson.stages)[2];
  assert.ok(validateLesson(lesson, DEVICES, PROJECTS).some(error => error.includes('stages[2]')));
  const sparse = fixture();
  sparse.stages[1].focusPoints = Array(1);
  sparse.stages[1].controls = Array(1);
  const errors = validateLesson(sparse, DEVICES, PROJECTS).join(' ');
  assert.match(errors, /focusPoints/);
  assert.match(errors, /controls/);
});

test('source polarity pins can be completion targets', () => {
  const lesson = fixture();
  lesson.part = 'dc-source';
  lesson.stages[1].focusPoints = ['+', '-'];
  lesson.stages[1].completion.events = [{ type: 'select-pin', value: '+' }, { type: 'select-pin', value: '-' }];
  assert.deepEqual(validateLesson(lesson, DEVICES, PROJECTS), []);
});

test('stage ids that match inherited object properties are safe', () => {
  const lesson = fixture();
  lesson.stages[1].id = 'constructor';
  let state = initialLessonState(lesson);
  state = reduceLesson(state, { type: 'go', stageId: 'constructor' });
  assert.doesNotThrow(() => reduceLesson(state, { type: 'observe', action: { type: 'select-pin', value: 'A' } }));
});

test('navigation never gates stages and completion needs all required observations', () => {
  const lesson = fixture();
  let state = initialLessonState(lesson);
  state = reduceLesson(state, { type: 'go', stageId: 'pins' });
  state = reduceLesson(state, { type: 'observe', action: { type: 'select-pin', value: 'A' } });
  assert.deepEqual(state.completedStageIds, []);
  state = reduceLesson(state, { type: 'next' });
  assert.equal(state.stageId, 'wire');
  state = reduceLesson(state, { type: 'back' });
  state = reduceLesson(state, { type: 'observe', action: { type: 'select-pin', value: 'K' } });
  assert.deepEqual(state.completedStageIds, ['pins']);
  state = reduceLesson(state, { type: 'go', stageId: 'fault' });
  assert.equal(state.stageId, 'fault');
  assert.deepEqual(lessonStateProgress(state), { lessonVersion: 1, completedStageIds: ['pins'], lastStageId: 'fault' });
});

test('saved state restores matching versions and ignores unknown stages or versions', () => {
  const lesson = fixture();
  /** @type {import('../../sim/lessons/progress.js').Progress} */
  const progress = { version: 1, lessons: { 'fixture-led': { lessonVersion: 1, completedStageIds: ['pins', 'removed'], lastStageId: 'try' } } };
  const state = initialLessonState(lesson, progress);
  assert.equal(state.stageId, 'try');
  assert.deepEqual(state.completedStageIds, ['pins']);
  lesson.version = 2;
  const reset = initialLessonState(lesson, progress);
  assert.equal(reset.stageId, 'recognize');
  assert.deepEqual(reset.completedStageIds, []);
});
