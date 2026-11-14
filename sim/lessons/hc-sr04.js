/** Structured content only: the workbench project is the circuit authority. */
/** @type {import('./schema.js').Lesson} */
export const HC_SR04_LESSON = {
  id: 'hc-sr04-basics-v1', part: 'hc-sr04', version: 1,
  titleKey: 'lesson.sonar.title', projectId: 'distance-reader',
  stages: [
    { id: 'recognize', kind: 'recognize', titleKey: 'lesson.sonar.recognize.title', bodyKey: 'lesson.sonar.recognize.body', focusPoints: [], controls: [], completion: { events: [{ type: 'acknowledge' }] } },
    { id: 'pins', kind: 'pins', titleKey: 'lesson.sonar.pins.title', bodyKey: 'lesson.sonar.pins.body', focusPoints: ['VCC', 'TRIG', 'ECHO', 'GND'], controls: [], completion: { events: [{ type: 'select-pin', value: 'VCC' }, { type: 'select-pin', value: 'TRIG' }, { type: 'select-pin', value: 'ECHO' }, { type: 'select-pin', value: 'GND' }] } },
    { id: 'wire', kind: 'wire', titleKey: 'lesson.sonar.wire.title', bodyKey: 'lesson.sonar.wire.body', focusPoints: ['VCC', 'TRIG', 'ECHO', 'GND'], controls: [], completion: { events: [{ type: 'wire-complete' }] } },
    { id: 'try', kind: 'try', titleKey: 'lesson.sonar.try.title', bodyKey: 'lesson.sonar.try.body', focusPoints: [], controls: ['distanceCm', 'measure'], completion: { events: [{ type: 'control-change', value: 'distanceCm' }, { type: 'control-change', value: 'measure' }] } },
    { id: 'fault', kind: 'fault', titleKey: 'lesson.sonar.fault.title', bodyKey: 'lesson.sonar.fault.body', focusPoints: ['TRIG', 'ECHO'], controls: ['distanceCm'], completion: { events: [{ type: 'fault-observed', value: 'logic-level-incompatible' }, { type: 'fault-observed', value: 'hc-sr04-swapped' }] } },
  ],
};
