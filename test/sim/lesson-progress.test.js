import test from 'node:test';
import assert from 'node:assert/strict';
import { readLessonProgress, writeLessonProgress, progressForLesson, LESSON_PROGRESS_KEY } from '../../sim/lessons/progress.js';

/** @param {Record<string,string>} initial */
function memoryStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (/** @type {string} */ key) => data.get(key) ?? null, setItem: (/** @type {string} */ key, /** @type {string} */ value) => data.set(key, value) };
}
const empty = () => ({ version: 1, lessons: {} });
const lesson = { id: 'led-basics', version: 2, stages: [{ id: 'recognize' }, { id: 'pins' }, { id: 'try' }] };

test('lesson progress round-trips independently of the bench', () => {
  const bench = '{"v":3,"placed":[{"id":"saved"}]}';
  const store = memoryStore({ 'botreborn.sim.bench': bench });
  const progress = { version: 1, lessons: { 'led-basics': { lessonVersion: 2, completedStageIds: ['recognize', 'pins'], lastStageId: 'pins' } } };
  assert.equal(writeLessonProgress(store, progress), true);
  assert.deepEqual(readLessonProgress(store), progress);
  assert.equal(store.getItem('botreborn.sim.bench'), bench);
});

test('bad lesson progress cannot reset the bench, and invalid records are isolated', () => {
  const bench = '{"v":3,"placed":[]}';
  const store = memoryStore({ 'botreborn.sim.bench': bench, [LESSON_PROGRESS_KEY]: '{broken' });
  assert.deepEqual(readLessonProgress(store), empty());
  assert.equal(store.getItem('botreborn.sim.bench'), bench);
  store.setItem(LESSON_PROGRESS_KEY, JSON.stringify({ version: 1, lessons: {
    good: { lessonVersion: 1, completedStageIds: ['a'], lastStageId: 'a' },
    broken: { lessonVersion: 1, completedStageIds: [null], lastStageId: 'b' },
  } }));
  assert.deepEqual(Object.keys(readLessonProgress(store).lessons), ['good']);
});

test('unavailable storage and future versions are harmless and never overwritten', () => {
  const unavailable = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } };
  assert.deepEqual(readLessonProgress(unavailable), empty());
  assert.equal(writeLessonProgress(unavailable, empty()), false);
  const future = JSON.stringify({ version: 2, lessons: { newer: {} } });
  const store = memoryStore({ [LESSON_PROGRESS_KEY]: future });
  assert.deepEqual(readLessonProgress(store), empty());
  assert.equal(writeLessonProgress(store, empty()), false);
  assert.equal(store.getItem(LESSON_PROGRESS_KEY), future);
});

test('saving older lesson data does not overwrite a newer lesson version', () => {
  const newer = { version: 1, lessons: { 'led-basics': { lessonVersion: 3, completedStageIds: ['new-stage'], lastStageId: 'new-stage' } } };
  const store = memoryStore({ [LESSON_PROGRESS_KEY]: JSON.stringify(newer) });
  const older = { version: 1, lessons: { 'led-basics': { lessonVersion: 2, completedStageIds: ['pins'], lastStageId: 'pins' } } };
  assert.equal(writeLessonProgress(store, older), true);
  assert.deepEqual(readLessonProgress(store), newer);
});

test('lesson versions and removed stage ids are reconciled without gating access', () => {
  /** @type {import('../../sim/lessons/progress.js').Progress} */
  const stale = { version: 1, lessons: { 'led-basics': { lessonVersion: 1, completedStageIds: ['recognize'], lastStageId: 'recognize' } } };
  assert.deepEqual(progressForLesson(stale, lesson), { lessonVersion: 2, completedStageIds: [], lastStageId: null });
  /** @type {import('../../sim/lessons/progress.js').Progress} */
  const current = { version: 1, lessons: { 'led-basics': { lessonVersion: 2, completedStageIds: ['pins', 'removed', 'pins'], lastStageId: 'removed' } } };
  assert.deepEqual(progressForLesson(current, lesson), { lessonVersion: 2, completedStageIds: ['pins'], lastStageId: null });
});
