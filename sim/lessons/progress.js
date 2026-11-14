// Lesson progress is intentionally separate from the bench and never gates use.
export const LESSON_PROGRESS_KEY = 'botreborn.sim.lesson-progress';

/** @typedef {{lessonVersion:number, completedStageIds:string[], lastStageId:string|null}} LessonProgress */
/** @typedef {{version:1, lessons:Record<string, LessonProgress>}} Progress */
/** @typedef {{getItem(key:string):string|null, setItem(key:string,value:string):void}} Store */
/** @returns {Progress} */
const emptyProgress = () => ({ version: 1, lessons: {} });
/** @param {unknown} value @returns {value is Record<string, any>} */
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
/** @param {unknown} value @returns {value is string} */
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 256;

/** Parse known progress only; one invalid lesson never discards its neighbours.
 * @param {unknown} value @returns {Progress|null}
 */
function normalize(value) {
  if (!object(value) || value.version !== 1 || !object(value.lessons)) return null;
  /** @type {[string, LessonProgress][]} */
  const lessons = [];
  for (const [id, item] of Object.entries(value.lessons)) {
    if (!identifier(id) || !object(item) || !Number.isSafeInteger(item.lessonVersion) || item.lessonVersion < 1
      || !Array.isArray(item.completedStageIds) || !item.completedStageIds.every(identifier)
      || (item.lastStageId !== null && !identifier(item.lastStageId))) continue;
    lessons.push([id, { lessonVersion: item.lessonVersion, completedStageIds: [...new Set(/** @type {string[]} */ (item.completedStageIds))], lastStageId: item.lastStageId }]);
  }
  return { version: 1, lessons: Object.fromEntries(lessons) };
}

/** @param {Store|null|undefined} store @returns {Progress} */
export function readLessonProgress(store) {
  try {
    const raw = store?.getItem(LESSON_PROGRESS_KEY);
    return raw ? normalize(JSON.parse(raw)) ?? emptyProgress() : emptyProgress();
  } catch { return emptyProgress(); }
}

/** Never overwrite progress written by a newer storage schema.
 * @param {Store|null|undefined} store @param {unknown} progress @returns {boolean}
 */
export function writeLessonProgress(store, progress) {
  const normalized = normalize(progress);
  if (!store || !normalized) return false;
  try {
    const raw = store.getItem(LESSON_PROGRESS_KEY);
    if (raw) {
      try {
        const existing = JSON.parse(raw);
        if (object(existing) && typeof existing.version === 'number' && existing.version > 1) return false;
        const saved = normalize(existing);
        if (saved) {
          const updates = Object.entries(normalized.lessons).filter(([id, item]) => !Object.hasOwn(saved.lessons, id) || saved.lessons[id].lessonVersion <= item.lessonVersion);
          normalized.lessons = Object.fromEntries([...Object.entries(saved.lessons), ...updates]);
        }
      } catch { /* Corrupt progress may be replaced; the bench is a separate key. */ }
    }
    store.setItem(LESSON_PROGRESS_KEY, JSON.stringify(normalized));
    return true;
  } catch { return false; }
}

/** Ignore progress from an incompatible lesson version and removed stages.
 * @param {Progress} progress @param {{id:string,version:number,stages:{id:string}[]}} lesson @returns {LessonProgress}
 */
export function progressForLesson(progress, lesson) {
  const fallback = { lessonVersion: lesson.version, completedStageIds: /** @type {string[]} */ ([]), lastStageId: null };
  const known = normalize(progress);
  const saved = known && Object.hasOwn(known.lessons, lesson.id) ? known.lessons[lesson.id] : null;
  if (!saved || saved.lessonVersion !== lesson.version) return fallback;
  const stageIds = new Set(lesson.stages.map(stage => stage.id));
  return { lessonVersion: lesson.version, completedStageIds: saved.completedStageIds.filter(id => stageIds.has(id)), lastStageId: saved.lastStageId && stageIds.has(saved.lastStageId) ? saved.lastStageId : null };
}
