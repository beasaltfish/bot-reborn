import assert from 'node:assert/strict';
import test from 'node:test';
import { IO_OPS, commandProblem, expandCommand } from '../core/io-program.js';

const resources = [
  { kind: 'gpio', name: 'sig', gpio: 5, direction: 'output', safe: 0 },
  { kind: 'gpio', name: 'button', gpio: 4, direction: 'input' },
];
const point = {
  name: 'point', timeoutMs: 500,
  args: { type: 'object', required: ['angle'], properties: { angle: { type: 'integer', minimum: 0, maximum: 180 } } },
  run: [{ op: 'pwm', args: { pin: 'sig', value: '$angle', map: { from: [0, 180], to: [500, 2400] } } }],
};

test('the six ops are the closed set', () => {
  assert.deepEqual([...IO_OPS].sort(),
    ['adc.read','i2c.read','i2c.write','pin.read','pin.write','pwm']);
});

test('a command expands to bounded ops with a safe value', () => {
  const { ops, drop } = expandCommand({ ...point, run: [{ op: 'pin.write', args: { pin: 'sig', level: '$level' } }] }, { level: 1 }, resources);
  assert.equal(drop, undefined);
  assert.deepEqual(ops, [{ op: 'pin.write', args: { pin: 5, level: 1 }, safe: 0, timeoutMs: 500 }]);
});

test('a linear map turns an angle into pulse width', () => {
  assert.deepEqual(expandCommand(point, { angle: 90 }, resources).ops,
    [{ op: 'pwm', args: { pin: 5, us: 1450 }, safe: 0, timeoutMs: 500 }]);
});

test('unknown ops, missing pins and non-linear maps are refused with a phrase', () => {
  assert.match(commandProblem({ ...point, run: [{ op: 'servo', args: {} }] }, resources) ?? '',
    /op "servo" is not one of the IO ops/);
  assert.match(commandProblem({ ...point, run: [{ op: 'pin.write', args: { pin: 'nope', level: 1 } }] }, resources) ?? '', /pin "nope" is not declared/);
  assert.match(commandProblem({ ...point, run: [{ op: 'pin.write', args: { pin: 'button', level: 1 } }] }, resources) ?? '', /output "button" has no safe value/);
  assert.match(commandProblem({ ...point, run: [{ op: 'pwm', args: { pin: 'sig', value: '$angle', map: { from: [0,180], to: [0,1,2] } } }] }, resources) ?? '', /map/);
  assert.match(commandProblem({ ...point, timeoutMs: 0 }, resources) ?? '', /timeoutMs must be 1\.\.5000/);
});

test('reads carry no safe and no timeout', () => {
  const read = { ...point, run: [{ op: 'pin.read', args: { pin: 'button' } }] };
  assert.equal(commandProblem(read, resources), null);
  assert.deepEqual(expandCommand(read, {}, resources).ops,
    [{ op: 'pin.read', args: { pin: 4 } }]);
});

test('a map keeps the pin and drops value and map', () => {
  const { ops } = expandCommand(point, { angle: 0 }, resources);
  assert.deepEqual(ops[0].args, { pin: 5, us: 500 });
});

test('a map with a single input point is not a span', () => {
  const flat = { ...point, run: [{ op: 'pwm', args: { pin: 'sig', value: '$angle', map: { from: [90, 90], to: [500, 2400] } } }] };
  assert.equal(commandProblem(flat, resources), null);
  assert.deepEqual(expandCommand(flat, { angle: 90 }, resources).ops[0].args, { pin: 5, us: 500 });
});

test('an unresolved argument is refused, not sent as undefined', () => {
  const { ops, drop } = expandCommand(point, {}, resources);
  assert.deepEqual(ops, []);
  assert.match(drop ?? '', /argument "angle" is missing/);
});

test('a bad command expands to nothing, with the phrase', () => {
  const { ops, drop } = expandCommand({ ...point, run: [{ op: 'servo', args: {} }] }, {}, resources);
  assert.deepEqual(ops, []);
  assert.match(drop ?? '', /not one of the IO ops/);
});
