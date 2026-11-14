/** Structured content only: the workbench project is the circuit authority. */
/** @type {import('./schema.js').Lesson} */
export const LED_LESSON = {
  id: 'led-5mm-basics-v1', part: 'led-5mm', version: 1,
  titleKey: 'lesson.led.title', projectId: 'led-basics',
  stages: [
    { id: 'recognize', kind: 'recognize', titleKey: 'lesson.led.recognize.title', bodyKey: 'lesson.led.recognize.body', focusPoints: [], controls: [], completion: { events: [{ type: 'acknowledge' }] } },
    { id: 'pins', kind: 'pins', titleKey: 'lesson.led.pins.title', bodyKey: 'lesson.led.pins.body', focusPoints: ['A', 'K'], controls: [], completion: { events: [{ type: 'select-pin', value: 'A' }, { type: 'select-pin', value: 'K' }] } },
    { id: 'wire', kind: 'wire', titleKey: 'lesson.led.wire.title', bodyKey: 'lesson.led.wire.body', focusPoints: ['A', 'K'], controls: [], completion: { events: [{ type: 'wire-complete' }] } },
    { id: 'try', kind: 'try', titleKey: 'lesson.led.try.title', bodyKey: 'lesson.led.try.body', focusPoints: [], controls: ['voltage', 'resistance'], completion: { events: [{ type: 'control-change', value: 'voltage' }, { type: 'control-change', value: 'resistance' }] } },
    { id: 'fault', kind: 'fault', titleKey: 'lesson.led.fault.title', bodyKey: 'lesson.led.fault.body', focusPoints: ['A', 'K'], controls: ['reversed', 'resistance'], completion: { events: [{ type: 'fault-observed', value: 'led-reversed' }, { type: 'fault-observed', value: 'led-overcurrent' }] } },
  ],
};
