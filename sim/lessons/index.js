import { LED_LESSON } from './led.js';
import { BME280_LESSON } from './bme280.js';
import { POWER_LESSON } from './power.js';
import { BUTTON_LESSON } from './button.js';
import { HC_SR04_LESSON } from './hc-sr04.js';
import { SSD1306_LESSON } from './ssd1306.js';

// Content registration does not imply that its laboratory UI is available.
/** @type {import('./schema.js').Lesson[]} */
export const LESSONS = [LED_LESSON, BME280_LESSON, POWER_LESSON, BUTTON_LESSON, HC_SR04_LESSON, SSD1306_LESSON];

/** @param {string} partId @returns {import('./schema.js').Lesson|null} */
export function lessonByPart(partId) {
  return LESSONS.find(lesson => lesson.part === partId) ?? null;
}
