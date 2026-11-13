import { LED_LESSON } from './led.js';
import { BME280_LESSON } from './bme280.js';
import { POWER_LESSON } from './power.js';
import { BUTTON_LESSON } from './button.js';
import { HC_SR04_LESSON } from './hc-sr04.js';
import { SSD1306_LESSON } from './ssd1306.js';
import { SG90_LESSON } from './sg90.js';
import { TB6612_LESSON } from './tb6612.js';
import { DC_MOTOR_LESSON } from './dc-motor.js';
import { WS2812_LESSON } from './ws2812.js';

// Content registration does not imply that its laboratory UI is available.
/** @type {import('./schema.js').Lesson[]} */
export const LESSONS = [LED_LESSON, BME280_LESSON, POWER_LESSON, BUTTON_LESSON, HC_SR04_LESSON, SSD1306_LESSON, SG90_LESSON, TB6612_LESSON, DC_MOTOR_LESSON, WS2812_LESSON];

/** Parts taught inside a related family lesson. */
const ALIASES = /** @type {Record<string,string>} */ ({
  'usb-5v-source': 'battery-4xaa', 'bench-supply': 'battery-4xaa', 'breadboard-regulator': 'battery-4xaa',
  resistor: 'led-5mm', 'push-button': 'button-module',
});

/** @param {string} partId @returns {import('./schema.js').Lesson|null} */
export function lessonByPart(partId) {
  const id = ALIASES[partId] ?? partId;
  return LESSONS.find(lesson => lesson.part === id) ?? null;
}
