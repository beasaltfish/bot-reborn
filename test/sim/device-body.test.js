// A device resource names a driver, not a pin; its command samples the driver.
// The BME280 lesson is the first body built this way.

import test from 'node:test';
import assert from 'node:assert/strict';
import manifest from '../../sim/bodies/bme280-readings/body.json' with { type: 'json' };
import { manifestProblem } from '../../core/plugin-manifest.js';
import { commandProblem, expandCommand } from '../../core/io-program.js';
import { loadBenchBodies } from '../../sim/bench-bodies.js';
import { createBenchIo } from '../../sim/bench-io.js';

test('the BME280 body loads with a device resource and a returning sample', () => {
  const { bodies, problems } = loadBenchBodies();
  assert.deepEqual(problems, []);
  const body = bodies['bme280-readings'];
  assert.ok(body);
  assert.equal(body.adoptable, false);
  assert.equal(body.firmware, null);
  const resources = body.resources ?? [];
  const command = /** @type {any} */ (body.commands?.[0]);
  assert.deepEqual(resources.map((resource) => [resource.kind, resource.driver, resource.address]), [['device', 'bme280', 119]]);
  assert.equal(commandProblem(command, resources), null);
  const { ops } = expandCommand(command, {}, resources);
  assert.deepEqual(ops, [{ op: 'device.sample', args: { device: 'env' }, timeoutMs: 1000 }]);
});

test('the HC-SR04 body measures on a timer and reads the distance', () => {
  const { bodies, problems } = loadBenchBodies();
  assert.deepEqual(problems, []);
  const body = bodies['distance-reader'];
  assert.ok(body);
  const commands = body.commands ?? [];
  assert.deepEqual(commands.map((command) => command.name), ['measure', 'distance']);
  assert.equal(commandProblem(/** @type {any} */ (commands[0]), body.resources ?? []), null);
  assert.equal(commandProblem(/** @type {any} */ (commands[1]), body.resources ?? []), null);
  assert.deepEqual(body.behaviors?.[0], { on: { everyMs: 1000 }, run: [{ command: 'measure' }] });
  const { ops } = expandCommand(/** @type {any} */ (commands[0]), {}, body.resources ?? []);
  assert.deepEqual(ops, [{ op: 'device.measure', args: { device: 'sonar' }, timeoutMs: 1000 }]);
});

test('a device needs a known driver and an i2c address', () => {
  const badDriver = structuredClone(manifest);
  badDriver.resources[0].driver = 'sht31';
  assert.match(manifestProblem(badDriver) ?? '', /driver/);
  const badAddress = structuredClone(manifest);
  const { address: _address, ...withoutAddress } = badAddress.resources[0];
  /** @type {any} */ (badAddress.resources)[0] = withoutAddress;
  assert.match(manifestProblem(badAddress) ?? '', /address/);
});

test('the composed servo and display bodies measure their drivers', () => {
  const { bodies, problems } = loadBenchBodies();
  assert.deepEqual(problems, []);
  for (const [id, driver] of [['proximity-servo', 'sonar-servo'], ['environment-display', 'bme280-display']]) {
    const body = bodies[id];
    assert.ok(body, id);
    assert.equal(body.resources?.[0]?.driver, driver);
    const command = /** @type {any} */ (body.commands?.[0]);
    assert.equal(commandProblem(command, body.resources ?? []), null);
    const { ops } = expandCommand(command, {}, body.resources ?? []);
    assert.deepEqual(ops.map((op) => op.op), ['device.measure']);
  }
});

test('the motor and strip bodies write through their drivers', () => {
  const { bodies, problems } = loadBenchBodies();
  assert.deepEqual(problems, []);
  for (const id of ['motor-driver-basics', 'status-light-strip']) {
    const body = bodies[id];
    assert.ok(body, id);
    const command = /** @type {any} */ (body.commands?.[0]);
    assert.equal(commandProblem(command, body.resources ?? []), null);
    const { ops } = expandCommand(command, {}, body.resources ?? []);
    assert.equal(ops[0].op, 'device.write');
    assert.equal(ops[0].args.device, id === 'motor-driver-basics' ? 'driver' : 'strip');
  }
});

test('the bench answers a device write through its model hook', async () => {
  /** @type {{ device: string, payload: Record<string, unknown> }[]} */
  const writes = [];
  const io = createBenchIo({
    pins: {},
    writeDevice: (device, payload) => writes.push({ device, payload }),
  });
  await io.run({ op: 'device.write', args: { device: 'strip', pixels: [[0, 1, 0]] } });
  assert.deepEqual(writes, [{ device: 'strip', payload: { pixels: [[0, 1, 0]] } }]);
});

test('the bench answers device.sample through its model hook', async () => {
  const io = createBenchIo({
    pins: {},
    sampleDevice: (device) => ({ device, temperatureC: 21.5 }),
  });
  const { ops } = expandCommand(/** @type {any} */ (manifest.commands[0]), {}, manifest.resources);
  assert.deepEqual(await io.run(ops[0]), { device: 'env', temperatureC: 21.5 });
});

test('a device step must name a declared device', () => {
  const resources = structuredClone(manifest.resources);
  assert.match(commandProblem(/** @type {any} */ ({ ...manifest.commands[0], run: [{ op: 'device.sample', args: { device: 'nope' } }] }), resources) ?? '', /nope/);
});
