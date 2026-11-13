/** Structured content only: the workbench project is the circuit authority. */
/** @type {import('./schema.js').Lesson} */
export const SG90_LESSON = {
  id: 'sg90-basics-v1', part: 'sg90', version: 1,
  titleKey: 'lesson.servo.title', projectId: 'proximity-servo',
  stages: [
    { id: 'recognize', kind: 'recognize', titleKey: 'lesson.servo.recognize.title', bodyKey: 'lesson.servo.recognize.body', focusPoints: [], controls: [], completion: { events: [{ type: 'acknowledge' }] } },
    { id: 'pins', kind: 'pins', titleKey: 'lesson.servo.pins.title', bodyKey: 'lesson.servo.pins.body', focusPoints: ['GND', 'VCC', 'SIG'], controls: [], completion: { events: [{ type: 'select-pin', value: 'GND' }, { type: 'select-pin', value: 'VCC' }, { type: 'select-pin', value: 'SIG' }] } },
    { id: 'wire', kind: 'wire', titleKey: 'lesson.servo.wire.title', bodyKey: 'lesson.servo.wire.body', focusPoints: ['GND', 'VCC', 'SIG'], controls: [], completion: { events: [{ type: 'wire-complete' }] } },
    { id: 'try', kind: 'try', titleKey: 'lesson.servo.try.title', bodyKey: 'lesson.servo.try.body', focusPoints: [], controls: ['angle'], completion: { events: [{ type: 'control-change', value: 'angle' }] } },
    { id: 'fault', kind: 'fault', titleKey: 'lesson.servo.fault.title', bodyKey: 'lesson.servo.fault.body', focusPoints: ['VCC', 'SIG'], controls: ['angle'], completion: { events: [{ type: 'fault-observed', value: 'servo-gpio-power' }, { type: 'fault-observed', value: 'pwm-frequency-unsupported' }] } },
  ],
};
