import { LED_LESSON } from './led.js';
import { BME280_LESSON } from './bme280.js';

// Content registration does not imply that its laboratory UI is available.
/** @type {import('./schema.js').Lesson[]} */
export const LESSONS = [LED_LESSON, BME280_LESSON];

/** @param {string} partId @returns {import('./schema.js').Lesson|null} */
export function lessonByPart(partId) {
  return LESSONS.find(lesson => lesson.part === partId) ?? null;
}
