/** Structured content only: the workbench project is the circuit authority. */
/** @type {import('./schema.js').Lesson} */
export const DC_MOTOR_LESSON = {
  id: 'dc-motor-basics-v1', part: 'dc-motor-small', version: 1,
  titleKey: 'lesson.motor.title', projectId: 'motor-driver-basics',
  stages: [
    { id: 'recognize', kind: 'recognize', titleKey: 'lesson.motor.recognize.title', bodyKey: 'lesson.motor.recognize.body', focusPoints: [], controls: [], completion: { events: [{ type: 'acknowledge' }] } },
    { id: 'pins', kind: 'pins', titleKey: 'lesson.motor.pins.title', bodyKey: 'lesson.motor.pins.body', focusPoints: ['+', '-'], controls: [], completion: { events: [{ type: 'select-pin', value: '+' }, { type: 'select-pin', value: '-' }] } },
    { id: 'wire', kind: 'wire', titleKey: 'lesson.motor.wire.title', bodyKey: 'lesson.motor.wire.body', focusPoints: ['+', '-'], controls: [], completion: { events: [{ type: 'wire-complete' }] } },
    { id: 'try', kind: 'try', titleKey: 'lesson.motor.try.title', bodyKey: 'lesson.motor.try.body', focusPoints: [], controls: ['direction', 'speed'], completion: { events: [{ type: 'control-change', value: 'direction' }, { type: 'control-change', value: 'speed' }] } },
    { id: 'fault', kind: 'fault', titleKey: 'lesson.motor.fault.title', bodyKey: 'lesson.motor.fault.body', focusPoints: ['+', '-'], controls: ['load'], completion: { events: [{ type: 'fault-observed', value: 'motor-stall-current' }] } },
  ],
};
