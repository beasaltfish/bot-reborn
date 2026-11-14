import test from 'node:test';
import assert from 'node:assert/strict';
import { addPart, addWire, emptyBench, setPartProperty } from '../../sim/bench.js';
import { evaluateGpio } from '../../sim/electrical/gpio.js';
import { PROFILES } from '../../sim/devices/profiles.js';

/** @param {import('../../sim/bench.js').Bench} bench @param {import('../../sim/electrical/gpio.js').Declaration[]} declarations @param {boolean} [powered] */
const evaluate = (bench, declarations, powered = true) => evaluateGpio(bench, PROFILES[0], declarations, { controllerPowered: powered });
/** @param {'up'|'down'|'none'} pull */
const input = pull => /** @type {import('../../sim/electrical/gpio.js').Declaration} */ ({ point: 'esp:GPIO4', direction: 'input', pull });

test('raw button input follows explicit pull-up and closed contact without assuming firmware configuration', () => {
  let bench = addPart(emptyBench(), 'push-button', { x: 0, z: 0 }).bench;
  bench = addWire(addWire(bench, 'esp:GPIO4', 'button:1', 'yellow'), 'button:2', 'esp:GND', 'black');
  assert.equal(evaluate(bench, [input('up')]).states['esp:GPIO4'], 'high');
  assert.equal(evaluate(bench, [input('none')]).states['esp:GPIO4'], 'floating');
  bench = setPartProperty(bench, 'button', 'pressed', true);
  assert.equal(evaluate(bench, [input('up')]).states['esp:GPIO4'], 'low');
  assert.equal(evaluate(bench, [input('up')], false).states['esp:GPIO4'], 'off');
});

test('conflicting GPIO outputs and direct 5 V input are diagnosed without calculating damage', () => {
  let bench = addWire(emptyBench(), 'esp:GPIO4', 'esp:GPIO5', 'yellow');
  const high = /** @type {import('../../sim/electrical/gpio.js').Declaration} */ ({ point: 'esp:GPIO4', direction: 'output', level: 'high' });
  const low = /** @type {import('../../sim/electrical/gpio.js').Declaration} */ ({ point: 'esp:GPIO5', direction: 'output', level: 'low' });
  const conflict = evaluate(bench, [high, low]);
  assert.equal(conflict.states['esp:GPIO4'], 'contended');
  assert.ok(conflict.faults.some(fault => fault.code === 'gpio-contention'));
  bench = addWire(emptyBench(), 'esp:GPIO4', 'esp:5V', 'red');
  const level = evaluate(bench, [input('none')]);
  assert.equal(level.states['esp:GPIO4'], 'unsupported-voltage');
  assert.ok(level.faults.some(fault => fault.code === 'logic-level-incompatible'));
});

test('logic compatibility uses profile voltage and refuses unknown rails', () => {
  const bench = addWire(emptyBench(), 'esp:GPIO4', 'esp:5V', 'red');
  const tolerant = evaluateGpio(bench, { ...PROFILES[0], gpioVoltage: 5 }, [input('none')], { controllerPowered: true });
  assert.equal(tolerant.states['esp:GPIO4'], 'high');
  const unknown = evaluateGpio(bench, { ...PROFILES[0], gpioVoltage: NaN }, [input('none')], { controllerPowered: true });
  assert.equal(unknown.states['esp:GPIO4'], 'unsupported');
  assert.ok(unknown.faults.some(fault => fault.code === 'unsupported-electrical-network'));
});

test('explicit powered external output drives GPIO and reports 5 V incompatibility', () => {
  let bench = addPart(emptyBench(), 'mpu6050', { x: 0, z: 0 }).bench;
  bench = addWire(addWire(bench, 'imu:SDA', 'esp:GPIO4', 'yellow'), 'imu:GND', 'esp:GND', 'black');
  const driver = { point: 'imu:SDA', ground: 'imu:GND', powered: true, level: /** @type {'high'|'low'|'high-z'} */ ('high'), highVoltage: 3.3 };
  let result = evaluateGpio(bench, PROFILES[0], [input('none')], { controllerPowered: true, drivers: [driver] });
  assert.equal(result.states['esp:GPIO4'], 'high');
  driver.level = 'low';
  assert.equal(evaluateGpio(bench, PROFILES[0], [input('up')], { controllerPowered: true, drivers: [driver] }).states['esp:GPIO4'], 'low');
  driver.level = 'high'; driver.highVoltage = 5;
  result = evaluateGpio(bench, PROFILES[0], [input('none')], { controllerPowered: true, drivers: [driver] });
  assert.equal(result.states['esp:GPIO4'], 'unsupported-voltage');
  assert.ok(result.faults.some(fault => fault.code === 'logic-level-incompatible' && fault.instances.includes('imu')));
});

test('unpowered or unreferenced external drivers never produce a guessed logic level', () => {
  let bench = addPart(emptyBench(), 'mpu6050', { x: 0, z: 0 }).bench;
  bench = addWire(bench, 'imu:SDA', 'esp:GPIO4', 'yellow');
  const driver = { point: 'imu:SDA', ground: 'imu:GND', powered: true, level: /** @type {'high'|'low'|'high-z'} */ ('high'), highVoltage: 3.3 };
  assert.equal(evaluateGpio(bench, PROFILES[0], [input('up')], { controllerPowered: true, drivers: [driver] }).states['esp:GPIO4'], 'unsupported');
  bench = addWire(bench, 'imu:GND', 'esp:GND', 'black');
  driver.powered = false;
  assert.equal(evaluateGpio(bench, PROFILES[0], [input('up')], { controllerPowered: true, drivers: [driver] }).states['esp:GPIO4'], 'unsupported');
  driver.powered = true; driver.level = 'high-z';
  assert.equal(evaluateGpio(bench, PROFILES[0], [input('up')], { controllerPowered: true, drivers: [driver] }).states['esp:GPIO4'], 'high');
});

test('a powered external output on an unpowered controller is not presented as electrically safe', () => {
  let bench = addPart(emptyBench(), 'mpu6050', { x: 0, z: 0 }).bench;
  bench = addWire(addWire(bench, 'imu:SDA', 'esp:GPIO4', 'yellow'), 'imu:GND', 'esp:GND', 'black');
  const driver = { point: 'imu:SDA', ground: 'imu:GND', powered: true, level: /** @type {const} */ ('high'), highVoltage: 3.3 };
  const result = evaluateGpio(bench, PROFILES[0], [input('none')], { controllerPowered: false, drivers: [driver] });
  assert.equal(result.states['esp:GPIO4'], 'off');
  assert.ok(result.faults.some(fault => fault.code === 'unsupported-electrical-network' && fault.points.includes('imu:SDA')));
});

test('external and controller outputs driving opposite levels report all affected pins', () => {
  let bench = addPart(emptyBench(), 'mpu6050', { x: 0, z: 0 }).bench;
  bench = addWire(addWire(bench, 'imu:SDA', 'esp:GPIO4', 'yellow'), 'imu:GND', 'esp:GND', 'black');
  const driver = { point: 'imu:SDA', ground: 'imu:GND', powered: true, level: /** @type {const} */ ('high'), highVoltage: 3.3 };
  const output = /** @type {import('../../sim/electrical/gpio.js').Declaration} */ ({ point: 'esp:GPIO4', direction: 'output', level: 'low' });
  const result = evaluateGpio(bench, PROFILES[0], [output], { controllerPowered: true, drivers: [driver] });
  const fault = result.faults.find(item => item.code === 'gpio-contention');
  assert.equal(result.states['esp:GPIO4'], 'contended');
  assert.ok(fault?.points.includes('imu:SDA'));
  assert.deepEqual(fault?.instances, ['esp', 'imu']);
});

test('an explicitly powered 5 V HC-SR04 echo cannot be read directly by 3.3 V GPIO', () => {
  let bench = addPart(emptyBench(), 'hc-sr04', { x: 0, z: 0 }).bench;
  for (const [a, b] of [['sonar:VCC', 'esp:5V'], ['sonar:GND', 'esp:GND'], ['sonar:ECHO', 'esp:GPIO4']]) bench = addWire(bench, a, b, 'yellow');
  const driver = { point: 'sonar:ECHO', ground: 'sonar:GND', powered: true, level: /** @type {const} */ ('high'), highVoltage: 5 };
  const result = evaluateGpio(bench, PROFILES[0], [input('none')], { controllerPowered: true, drivers: [driver] });
  assert.equal(result.states['esp:GPIO4'], 'unsupported-voltage');
  assert.ok(result.faults.some(fault => fault.code === 'logic-level-incompatible' && fault.points.includes('sonar:ECHO')));
});

test('opposed external drivers report both devices and their GPIO connection', () => {
  let bench = addPart(addPart(emptyBench(), 'mpu6050', { x: 0, z: 0 }).bench, 'mpu6050', { x: 10, z: 0 }).bench;
  for (const id of ['imu', 'imu2']) {
    bench = addWire(addWire(bench, `${id}:SDA`, 'esp:GPIO4', 'yellow'), `${id}:GND`, 'esp:GND', 'black');
  }
  const drivers = [
    { point: 'imu:SDA', ground: 'imu:GND', powered: true, level: /** @type {const} */ ('high'), highVoltage: 3.3 },
    { point: 'imu2:SDA', ground: 'imu2:GND', powered: true, level: /** @type {const} */ ('low'), highVoltage: 3.3 },
  ];
  const result = evaluateGpio(bench, PROFILES[0], [input('none')], { controllerPowered: true, drivers });
  const fault = result.faults.find(item => item.code === 'gpio-contention');
  assert.equal(result.states['esp:GPIO4'], 'contended');
  assert.deepEqual(fault?.instances, ['esp', 'imu', 'imu2']);
  assert.deepEqual(fault?.points, ['esp:GPIO4', 'imu2:SDA', 'imu:SDA'].sort());
});

test('unmodeled thresholds and a series resistor do not imply a valid external signal', () => {
  let bench = addPart(emptyBench(), 'mpu6050', { x: 0, z: 0 }).bench;
  bench = addWire(addWire(bench, 'imu:SDA', 'esp:GPIO4', 'yellow'), 'imu:GND', 'esp:GND', 'black');
  const driver = { point: 'imu:SDA', ground: 'imu:GND', powered: true, level: /** @type {const} */ ('high'), highVoltage: 2 };
  assert.equal(evaluateGpio(bench, PROFILES[0], [input('none')], { controllerPowered: true, drivers: [driver] }).states['esp:GPIO4'], 'unsupported');
  bench = addPart(emptyBench(), 'mpu6050', { x: 0, z: 0 }).bench;
  bench = addPart(bench, 'resistor', { x: 0, z: 0 }).bench;
  for (const [a, b] of [['imu:SDA', 'r:1'], ['r:2', 'esp:GPIO4'], ['imu:GND', 'esp:GND']]) bench = addWire(bench, a, b, 'yellow');
  assert.equal(evaluateGpio(bench, PROFILES[0], [input('none')], { controllerPowered: true, drivers: [driver] }).states['esp:GPIO4'], 'unsupported');
});

test('resistor networks and undeclared external connections remain unsupported', () => {
  let bench = addPart(emptyBench(), 'resistor', { x: 0, z: 0 }).bench;
  bench = addWire(addWire(bench, 'esp:GPIO4', 'r:1', 'yellow'), 'r:2', 'esp:3V3', 'red');
  assert.equal(evaluate(bench, [input('none')]).states['esp:GPIO4'], 'unsupported');
  let unknown = addPart(emptyBench(), 'bme280-i2c', { x: 0, z: 0 }).bench;
  unknown = addWire(unknown, 'esp:GPIO4', 'env:SDI', 'yellow');
  assert.equal(evaluate(unknown, [input('up')]).states['esp:GPIO4'], 'unsupported');
});
