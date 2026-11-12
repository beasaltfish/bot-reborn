/** @type {import('./schema.js').Lesson} */
export const BME280_LESSON = {
  id: 'bme280-i2c-basics-v1', part: 'bme280-i2c', version: 1,
  titleKey: 'lesson.bme.title', projectId: 'bme280-readings',
  stages: [
    { id: 'recognize', kind: 'recognize', titleKey: 'lesson.bme.recognize.title', bodyKey: 'lesson.bme.recognize.body', focusPoints: [], controls: [], completion: { events: [{ type: 'acknowledge' }] } },
    { id: 'pins', kind: 'pins', titleKey: 'lesson.bme.pins.title', bodyKey: 'lesson.bme.pins.body', focusPoints: ['VIN', 'GND', 'SDI', 'SCK', 'SDO'], controls: ['address'], completion: { events: [{ type: 'select-pin', value: 'VIN' }, { type: 'select-pin', value: 'GND' }, { type: 'select-pin', value: 'SDI' }, { type: 'select-pin', value: 'SCK' }, { type: 'select-pin', value: 'SDO' }, { type: 'control-change', value: 'address' }] } },
    { id: 'wire', kind: 'wire', titleKey: 'lesson.bme.wire.title', bodyKey: 'lesson.bme.wire.body', focusPoints: ['VIN', 'GND', 'SDI', 'SCK'], controls: [], completion: { events: [{ type: 'wire-complete' }] } },
    { id: 'try', kind: 'try', titleKey: 'lesson.bme.try.title', bodyKey: 'lesson.bme.try.body', focusPoints: [], controls: ['temperatureC', 'humidityPct', 'pressureHpa'], completion: { events: [{ type: 'control-change', value: 'temperatureC' }, { type: 'control-change', value: 'humidityPct' }, { type: 'control-change', value: 'pressureHpa' }] } },
    { id: 'fault', kind: 'fault', titleKey: 'lesson.bme.fault.title', bodyKey: 'lesson.bme.fault.body', focusPoints: ['SDI', 'SCK', 'SDO'], controls: ['swapped', 'conflict'], completion: { events: [{ type: 'fault-observed', value: 'i2c-sda-scl-swapped' }, { type: 'fault-observed', value: 'i2c-address-conflict' }] } },
  ],
};
