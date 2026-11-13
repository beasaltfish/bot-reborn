/** Structured content only: the workbench project is the circuit authority. */
/** @type {import('./schema.js').Lesson} */
export const TB6612_LESSON = {
  id: 'tb6612-basics-v1', part: 'tb6612fng', version: 1,
  titleKey: 'lesson.tb6612.title', projectId: 'motor-driver-basics',
  stages: [
    { id: 'recognize', kind: 'recognize', titleKey: 'lesson.tb6612.recognize.title', bodyKey: 'lesson.tb6612.recognize.body', focusPoints: [], controls: [], completion: { events: [{ type: 'acknowledge' }] } },
    { id: 'pins', kind: 'pins', titleKey: 'lesson.tb6612.pins.title', bodyKey: 'lesson.tb6612.pins.body', focusPoints: ['VM', 'VCC', 'GND', 'STBY'], controls: [], completion: { events: [{ type: 'select-pin', value: 'VM' }, { type: 'select-pin', value: 'VCC' }, { type: 'select-pin', value: 'GND' }, { type: 'select-pin', value: 'STBY' }] } },
    { id: 'wire', kind: 'wire', titleKey: 'lesson.tb6612.wire.title', bodyKey: 'lesson.tb6612.wire.body', focusPoints: ['VM', 'VCC', 'GND', 'STBY', 'AIN1', 'AIN2', 'PWMA'], controls: [], completion: { events: [{ type: 'wire-complete' }] } },
    { id: 'try', kind: 'try', titleKey: 'lesson.tb6612.try.title', bodyKey: 'lesson.tb6612.try.body', focusPoints: ['AIN1', 'AIN2', 'PWMA'], controls: ['direction', 'speed'], completion: { events: [{ type: 'control-change', value: 'direction' }, { type: 'control-change', value: 'speed' }] } },
    { id: 'fault', kind: 'fault', titleKey: 'lesson.tb6612.fault.title', bodyKey: 'lesson.tb6612.fault.body', focusPoints: ['STBY', 'AIN1', 'AIN2'], controls: ['direction'], completion: { events: [{ type: 'fault-observed', value: 'motor-standby' }, { type: 'fault-observed', value: 'motor-bridge-shorted' }] } },
  ],
};
