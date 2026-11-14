/** Structured content only: the workbench project is the circuit authority. */
/** @type {import('./schema.js').Lesson} */
export const BUTTON_LESSON = {
  id: 'button-module-basics-v1', part: 'button-module', version: 1,
  titleKey: 'lesson.button.title', projectId: 'button-led',
  stages: [
    { id: 'recognize', kind: 'recognize', titleKey: 'lesson.button.recognize.title', bodyKey: 'lesson.button.recognize.body', focusPoints: [], controls: [], completion: { events: [{ type: 'acknowledge' }] } },
    { id: 'pins', kind: 'pins', titleKey: 'lesson.button.pins.title', bodyKey: 'lesson.button.pins.body', focusPoints: ['S', 'VCC', 'GND'], controls: [], completion: { events: [{ type: 'select-pin', value: 'S' }, { type: 'select-pin', value: 'VCC' }, { type: 'select-pin', value: 'GND' }] } },
    { id: 'wire', kind: 'wire', titleKey: 'lesson.button.wire.title', bodyKey: 'lesson.button.wire.body', focusPoints: ['S', 'VCC', 'GND'], controls: [], completion: { events: [{ type: 'wire-complete' }] } },
    { id: 'try', kind: 'try', titleKey: 'lesson.button.try.title', bodyKey: 'lesson.button.try.body', focusPoints: ['S'], controls: ['pressed'], completion: { events: [{ type: 'control-change', value: 'pressed' }] } },
    { id: 'fault', kind: 'fault', titleKey: 'lesson.button.fault.title', bodyKey: 'lesson.button.fault.body', focusPoints: ['S', 'VCC'], controls: ['pressed'], completion: { events: [{ type: 'fault-observed', value: 'logic-level-incompatible' }, { type: 'fault-observed', value: 'floating-input' }] } },
  ],
};
