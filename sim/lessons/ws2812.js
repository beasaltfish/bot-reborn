/** Structured content only: the workbench project is the circuit authority. */
/** @type {import('./schema.js').Lesson} */
export const WS2812_LESSON = {
  id: 'ws2812-basics-v1', part: 'ws2812-strip', version: 1,
  titleKey: 'lesson.strip.title', projectId: 'status-light-strip',
  stages: [
    { id: 'recognize', kind: 'recognize', titleKey: 'lesson.strip.recognize.title', bodyKey: 'lesson.strip.recognize.body', focusPoints: [], controls: [], completion: { events: [{ type: 'acknowledge' }] } },
    { id: 'pins', kind: 'pins', titleKey: 'lesson.strip.pins.title', bodyKey: 'lesson.strip.pins.body', focusPoints: ['5V', 'DIN', 'GND'], controls: [], completion: { events: [{ type: 'select-pin', value: '5V' }, { type: 'select-pin', value: 'DIN' }, { type: 'select-pin', value: 'GND' }] } },
    { id: 'wire', kind: 'wire', titleKey: 'lesson.strip.wire.title', bodyKey: 'lesson.strip.wire.body', focusPoints: ['5V', 'DIN', 'GND'], controls: [], completion: { events: [{ type: 'wire-complete' }] } },
    { id: 'try', kind: 'try', titleKey: 'lesson.strip.try.title', bodyKey: 'lesson.strip.try.body', focusPoints: [], controls: ['pixels', 'color'], completion: { events: [{ type: 'control-change', value: 'pixels' }, { type: 'control-change', value: 'color' }] } },
    { id: 'fault', kind: 'fault', titleKey: 'lesson.strip.fault.title', bodyKey: 'lesson.strip.fault.body', focusPoints: ['5V', 'DIN'], controls: ['pixels'], completion: { events: [{ type: 'fault-observed', value: 'logic-level-incompatible' }, { type: 'fault-observed', value: 'onewire-data-direction' }] } },
  ],
};
