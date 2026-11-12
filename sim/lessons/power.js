/** Structured content only: the workbench project is the circuit authority. */
/** @type {import('./schema.js').Lesson} */
export const POWER_LESSON = {
  id: 'power-basics-v1', part: 'battery-4xaa', version: 1,
  titleKey: 'lesson.power.title', projectId: 'power-a-rail',
  stages: [
    { id: 'recognize', kind: 'recognize', titleKey: 'lesson.power.recognize.title', bodyKey: 'lesson.power.recognize.body', focusPoints: [], controls: [], completion: { events: [{ type: 'acknowledge' }] } },
    { id: 'pins', kind: 'pins', titleKey: 'lesson.power.pins.title', bodyKey: 'lesson.power.pins.body', focusPoints: ['+', '-'], controls: [], completion: { events: [{ type: 'select-pin', value: '+' }, { type: 'select-pin', value: '-' }] } },
    { id: 'wire', kind: 'wire', titleKey: 'lesson.power.wire.title', bodyKey: 'lesson.power.wire.body', focusPoints: ['+', '-'], controls: [], completion: { events: [{ type: 'wire-complete' }] } },
    { id: 'try', kind: 'try', titleKey: 'lesson.power.try.title', bodyKey: 'lesson.power.try.body', focusPoints: [], controls: ['chemistry', 'charge'], completion: { events: [{ type: 'control-change', value: 'chemistry' }, { type: 'control-change', value: 'charge' }] } },
    { id: 'fault', kind: 'fault', titleKey: 'lesson.power.fault.title', bodyKey: 'lesson.power.fault.body', focusPoints: ['+', '-'], controls: ['chemistry', 'charge'], completion: { events: [{ type: 'fault-observed', value: 'source-contention' }, { type: 'fault-observed', value: 'regulator-dropout' }] } },
  ],
};
