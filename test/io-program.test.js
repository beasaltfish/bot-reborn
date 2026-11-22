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
  assert.match(commandProblem({ ...point, run: [{ op: 'pin.write', args: { pin: 'button', level: 1 } }] }, resources) ?? '', /cannot be written/);
  assert.match(commandProblem({ ...point, run: [{ op: 'pwm', args: { pin: 'sig', value: '$angle', map: { from: [0,180], to: [0,1,2] } } }] }, resources) ?? '', /map/);
  assert.match(commandProblem({ ...point, timeoutMs: 0 }, resources) ?? '', /timeoutMs must be 1\.\.5000/);
});

test('an output without a safe value is refused', () => {
  const led = { kind: 'gpio', name: 'led', gpio: 6, direction: 'output' };
  assert.match(
    commandProblem({ ...point, run: [{ op: 'pin.write', args: { pin: 'led', level: 1 } }] }, [...resources, led]) ?? '',
    /output "led" has no safe value/,
  );
});

test('an input cannot be written even when it carries a safe value', () => {
  const button = { kind: 'gpio', name: 'button', gpio: 4, direction: 'input', safe: 0 };
  assert.match(
    commandProblem({ ...point, run: [{ op: 'pin.write', args: { pin: 'button', level: 1 } }] }, [...resources, button]) ?? '',
    /input "button" cannot be written/,
  );
});

test('a non-gpio resource has no address and is refused', () => {
  const adc = { kind: 'adc', name: 'light', pin: 34, direction: 'input' };
  const nameless = { kind: 'gpio', name: 'spare', direction: 'output', safe: 0 };
  const all = [...resources, adc, nameless];

  assert.match(commandProblem({ ...point, run: [{ op: 'i2c.write', args: { pin: 'light', value: 1 } }] }, all) ?? '',
    /i2c\/adc resources are not defined yet/);
  assert.match(commandProblem({ ...point, run: [{ op: 'pin.write', args: { pin: 'spare', level: 1 } }] }, all) ?? '',
    /resource "spare" is not a gpio pin/);
});

test('i2c and adc ops fail closed, with no gpio stand-in', () => {
  for (const op of ['i2c.read', 'i2c.write', 'adc.read']) {
    const step = { op, args: { pin: 'button' } };
    assert.match(commandProblem({ ...point, run: [step] }, resources) ?? '',
      /i2c\/adc resources are not defined yet/, op);
    const { ops, drop } = expandCommand({ ...point, run: [step] }, {}, resources);
    assert.deepEqual(ops, [], op);
    assert.match(drop ?? '', /i2c\/adc resources are not defined yet/, op);
  }
});

test('pwm without a map is the raw pulse width', () => {
  const raw = { ...point, run: [{ op: 'pwm', args: { pin: 'sig', value: 90 } }] };
  assert.equal(commandProblem(raw, resources), null);
  assert.deepEqual(expandCommand(raw, {}, resources).ops,
    [{ op: 'pwm', args: { pin: 5, us: 90 }, safe: 0, timeoutMs: 500 }]);

  const fromArg = { ...point, run: [{ op: 'pwm', args: { pin: 'sig', value: '$angle' } }] };
  assert.deepEqual(expandCommand(fromArg, { angle: 1500 }, resources).ops,
    [{ op: 'pwm', args: { pin: 5, us: 1500 }, safe: 0, timeoutMs: 500 }]);
});

test('reads carry no safe and no timeout', () => {
  /** @type {import('../core/io-program.js').Command} */
  const read = { ...point, returns: true, run: [{ op: 'pin.read', args: { pin: 'button' } }] };
  assert.equal(commandProblem(read, resources), null);
  assert.deepEqual(expandCommand(read, {}, resources).ops,
    [{ op: 'pin.read', args: { pin: 4 } }]);
});

test('returns is exactly one read, and it is the last step', () => {
  // The one legal shape: work first, then the value that comes back.
  /** @type {import('../core/io-program.js').Command} */
  const ok = {
    ...point,
    returns: true,
    run: [
      { op: 'pin.write', args: { pin: 'sig', level: 1 } },
      { op: 'pin.read', args: { pin: 'button' } },
    ],
  };
  assert.equal(commandProblem(ok, resources), null);

  // `returns` with nothing to return.
  assert.match(
    commandProblem({ ...point, returns: true }, resources) ?? '',
    /returns needs exactly one read at the end/,
  );

  // Two reads cannot both be the value.
  assert.match(
    commandProblem({
      ...point,
      returns: true,
      run: [
        { op: 'pin.read', args: { pin: 'button' } },
        { op: 'pin.read', args: { pin: 'button' } },
      ],
    }, resources) ?? '',
    /returns needs exactly one read at the end/,
  );

  // A read that is not the last step runs for nothing.
  assert.match(
    commandProblem({
      ...point,
      returns: true,
      run: [
        { op: 'pin.read', args: { pin: 'button' } },
        { op: 'pin.write', args: { pin: 'sig', level: 1 } },
      ],
    }, resources) ?? '',
    /returns needs exactly one read at the end/,
  );

  // The reverse: a read nobody receives is a value silently swallowed.
  assert.match(
    commandProblem({ ...point, run: [{ op: 'pin.read', args: { pin: 'button' } }] }, resources) ?? '',
    /a trailing read needs returns/,
  );
});

test('a read must target a gpio input', () => {
  assert.match(
    commandProblem({ ...point, run: [{ op: 'pin.read', args: { pin: 'sig' } }] }, resources) ?? '',
    /resource "sig" is not a gpio input/,
  );
});

test('a pin is a static reference, not a data slot', () => {
  const swapped = { ...point, run: [{ op: 'pin.write', args: { pin: '$level', level: 1 } }] };
  assert.match(commandProblem(swapped, resources) ?? '', /pin "\$level" is not declared/);
  assert.match(expandCommand(swapped, { level: 'sig' }, resources).drop ?? '', /is not declared/);
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

test('map is refused on an op that does not map', () => {
  const unsafe = { ...point, run: [{ op: 'pin.write', args: { pin: 'sig', level: 1, map: { from: [0,1], to: [0,1] } } }] };
  assert.match(commandProblem(unsafe, resources) ?? '', /map is only for pwm/);
});

test('pwm without a value is refused, not expanded to NaN', () => {
  const faceless = { ...point, run: [{ op: 'pwm', args: { pin: 'sig', map: { from: [0, 180], to: [500, 2400] } } }] };
  assert.match(commandProblem(faceless, resources) ?? '', /pwm needs a value/);
  assert.equal(expandCommand(faceless, {}, resources).ops.length, 0);

  const { ops, drop } = expandCommand(point, { angle: 'hot' }, resources);
  assert.deepEqual(ops, []);
  assert.match(drop ?? '', /pwm value must be a finite number/);
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

test('malformed data is a phrase, never a throw', () => {
  // Every argument here is deliberately the wrong shape; the casts say "on
  // purpose", so the test still typechecks while asserting the runtime guard.
  assert.match(commandProblem(/** @type {any} */ ({ timeoutMs: 1, run: {} }), resources) ?? '', /run must be an array of steps/);
  assert.match(commandProblem(/** @type {any} */ (null), resources) ?? '', /command must be an object/);
  assert.match(commandProblem(point, /** @type {any} */ (null)) ?? '', /resources must be an array/);
  assert.equal(commandProblem(point, /** @type {any} */ ([null, ...resources])), null);
  assert.match(expandCommand(point, { angle: 90 }, /** @type {any} */ (null)).drop ?? '', /resources must be an array/);
  assert.match(expandCommand(/** @type {any} */ ({ timeoutMs: 1, run: {} }), {}, resources).drop ?? '', /run must be an array of steps/);
});

test('a __proto__ key is copied as data, not as a prototype', () => {
  const args = JSON.parse('{"pin":"sig","level":1,"__proto__":{"polluted":true}}');
  const { ops } = expandCommand({ ...point, run: [{ op: 'pin.write', args }] }, {}, resources);
  assert.deepEqual(ops[0].args.pin, 5);
  assert.equal(Object.getPrototypeOf(ops[0].args), Object.prototype);
  assert.equal(/** @type {any} */ ({}).polluted, undefined);
});
