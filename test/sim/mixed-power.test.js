import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench, addPart, addWire, setPartProperty } from '../../sim/bench.js';
import { PROFILES } from '../../sim/devices/profiles.js';
import { evaluateDevices } from '../../sim/devices/evaluate.js';

const tolerant = { ...PROFILES[0], gpioVoltage: 5 };
/** @param {string[]} devices */
function weakBench(devices) {
  let b = addPart(emptyBench(), 'bench-supply', { x: -40, z: 0 }).bench;
  b = setPartProperty(b, 'bench', 'currentLimitMa', 250);
  b = addWire(b, 'bench:-', 'esp:GND', 'black');
  if (devices.includes('servo')) {
    b = addPart(b, 'sg90', { x: 0, z: 0 }).bench;
    b = addWire(b, 'servo:VCC', 'bench:+', 'red');
    b = addWire(b, 'servo:GND', 'esp:GND', 'black');
    b = addWire(b, 'servo:SIG', 'esp:GPIO6', 'yellow');
  }
  if (devices.includes('motor')) {
    b = addPart(b, 'tb6612fng', { x: 20, z: 0 }).bench;
    b = addPart(b, 'dc-motor-small', { x: 40, z: 0 }).bench;
    b = addWire(b, 'drv:VM', 'bench:+', 'red');
    b = addWire(b, 'drv:VCC', 'esp:3V3', 'red');
    b = addWire(b, 'drv:GND2', 'esp:GND', 'black');
    b = addWire(b, 'drv:STBY', 'esp:3V3', 'yellow');
    b = addWire(b, 'drv:AIN1', 'esp:GPIO4', 'yellow');
    b = addWire(b, 'drv:AIN2', 'esp:GPIO5', 'yellow');
    b = addWire(b, 'drv:PWMA', 'esp:GPIO7', 'yellow');
    b = addWire(b, 'motor:+', 'drv:AO1', 'orange');
    b = addWire(b, 'motor:-', 'drv:AO2', 'orange');
  }
  if (devices.includes('strip')) {
    b = addPart(b, 'ws2812-strip', { x: 60, z: 0 }).bench;
    b = addWire(b, 'strip:5V', 'bench:+', 'red');
    b = addWire(b, 'strip:GND', 'esp:GND', 'black');
    b = addWire(b, 'strip:DIN', 'esp:GPIO8', 'green');
  }
  return { ...b, usb: true };
}
const stimuli = {
  servo: { servo: { angle: 90 } },
  motor: { drv: { direction: 'forward', speed: 0.5 } },
  strip: { strip: { pixels: [[255, 255, 255]] } },
};
/** @param {any} result */
const hasBrownout = result => result.faults.some((/** @type {any} */ fault) => fault.code === 'rail-brownout');

test('each device alone stays within a 250 mA supply', () => {
  for (const device of ['servo', 'motor', 'strip']) {
    const result = evaluateDevices(weakBench([device]), { profile: tolerant, stimuli });
    assert.equal(hasBrownout(result), false, device);
  }
});
test('servo, motor and strip starting together brown out a weak shared supply', () => {
  const result = evaluateDevices(weakBench(['servo', 'motor', 'strip']), { profile: tolerant, stimuli });
  assert.ok(hasBrownout(result));
  const rail = Object.values(result.electrical.rails).find(item => item.sourceInstances.includes('bench'));
  assert.equal(rail?.status, 'limited');
  assert.ok((rail?.requestedCurrentMa ?? 0) > 250);
});
