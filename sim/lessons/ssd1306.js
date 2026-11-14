/** Structured content only: the workbench project is the circuit authority. */
/** @type {import('./schema.js').Lesson} */
export const SSD1306_LESSON = {
  id: 'ssd1306-basics-v1', part: 'ssd1306', version: 1,
  titleKey: 'lesson.oled.title', projectId: 'environment-display',
  stages: [
    { id: 'recognize', kind: 'recognize', titleKey: 'lesson.oled.recognize.title', bodyKey: 'lesson.oled.recognize.body', focusPoints: [], controls: [], completion: { events: [{ type: 'acknowledge' }] } },
    { id: 'pins', kind: 'pins', titleKey: 'lesson.oled.pins.title', bodyKey: 'lesson.oled.pins.body', focusPoints: ['GND', 'VCC', 'SCL', 'SDA'], controls: [], completion: { events: [{ type: 'select-pin', value: 'GND' }, { type: 'select-pin', value: 'VCC' }, { type: 'select-pin', value: 'SCL' }, { type: 'select-pin', value: 'SDA' }] } },
    { id: 'wire', kind: 'wire', titleKey: 'lesson.oled.wire.title', bodyKey: 'lesson.oled.wire.body', focusPoints: ['GND', 'VCC', 'SCL', 'SDA'], controls: [], completion: { events: [{ type: 'wire-complete' }] } },
    { id: 'try', kind: 'try', titleKey: 'lesson.oled.try.title', bodyKey: 'lesson.oled.try.body', focusPoints: [], controls: ['temperature', 'humidity', 'pressure'], completion: { events: [{ type: 'control-change', value: 'temperature' }, { type: 'control-change', value: 'humidity' }, { type: 'control-change', value: 'pressure' }] } },
    { id: 'fault', kind: 'fault', titleKey: 'lesson.oled.fault.title', bodyKey: 'lesson.oled.fault.body', focusPoints: ['SCL', 'SDA'], controls: ['temperature'], completion: { events: [{ type: 'fault-observed', value: 'i2c-sda-scl-swapped' }, { type: 'fault-observed', value: 'i2c-address-conflict' }] } },
  ],
};
