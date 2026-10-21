import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeBrain } from '../../server/tools/fake-brain.js';
import { connectFakeBody } from '../../server/fake-body.js';
import { until } from './helpers.js';

const TOKEN = '0123456789abcdef0123456789abcdef';

/** @param {Parameters<typeof startFakeBrain>[0]} [opts] */
async function rig(opts = {}) {
  const brain = await startFakeBrain({ port: 0, log: () => {}, ...opts });
  const body = await connectFakeBody(`ws://127.0.0.1:${brain.port}/body`, { token: TOKEN });
  return { brain, body, done: () => { body.close(); brain.close(); } };
}

test('a body that says hello is welcomed and told the robot is listening', async () => {
  const { body, done } = await rig();
  await body.waitFor((m) => m.type === 'state' && m.state === 'LISTENING');
  done();
});

test('move sends exactly the protocol message', async () => {
  const { brain, body, done } = await rig();
  assert.match(await brain.run('move forward left 600'), /^sent/);
  const move = await body.waitFor((m) => m.type === 'move');
  assert.deepEqual(move, { type: 'move', drive: 'forward', steer: 'left', ms: 600 });
  done();
});

test('a move the protocol would refuse is not sent', async () => {
  const { brain, body, done } = await rig();
  for (const bad of ['move forward up 600', 'move forward left 1001', 'move forward left']) {
    assert.match(await brain.run(bad), /^error:/, bad);
  }
  await brain.run('stop');
  await body.waitFor((m) => m.type === 'stop');
  assert.equal(body.messages.filter((m) => m.type === 'move').length, 0);
  done();
});

test('stop, hush and state reach the body', async () => {
  const { brain, body, done } = await rig();
  await brain.run('stop');
  await brain.run('hush');
  await brain.run('state THINKING');
  await body.waitFor((m) => m.type === 'state' && m.state === 'THINKING');
  assert.ok(body.messages.some((m) => m.type === 'stop'));
  assert.ok(body.messages.some((m) => m.type === 'hush'));
  done();
});

test('tone plays its length of 16 kHz PCM down to the body', async () => {
  const { brain, body, done } = await rig();
  await brain.run('tone 300');
  await until(() => body.audioBytes >= 9600, 3000);
  assert.equal(body.audioBytes, 9600);
  done();
});

test('a brain told to reject turns the body away with that reason', async () => {
  const brain = await startFakeBrain({ port: 0, log: () => {}, reject: 'busy' });
  await assert.rejects(
    () => connectFakeBody(`ws://127.0.0.1:${brain.port}/body`, { token: TOKEN }),
    /busy/,
  );
  brain.close();
});

test('a token that is not the one given is rejected', async () => {
  const brain = await startFakeBrain({ port: 0, log: () => {}, token: 'f'.repeat(32) });
  await assert.rejects(
    () => connectFakeBody(`ws://127.0.0.1:${brain.port}/body`, { token: TOKEN }),
    /token/,
  );
  brain.close();
});

test('status counts what the body sent up, and the level is logged', async () => {
  /** @type {string[]} */ const lines = [];
  const brain = await startFakeBrain({ port: 0, log: (l) => lines.push(l) });
  const body = await connectFakeBody(`ws://127.0.0.1:${brain.port}/body`, { token: TOKEN });
  const loud = new Int16Array(16000).map((_, i) => Math.round(8000 * Math.sin(i / 5)));
  await body.sendPcm(loud, { paceMs: 50 });
  // The level line comes once a second; by then every frame has arrived.
  await until(() => lines.some((l) => /^uplink \d+ B\/s, -?\d+ dBFS$/.test(l)), 3000);
  assert.match(await brain.run('status'), /connected, 32000 bytes up/);
  body.close();
  brain.close();
});

test('an unknown command says so', async () => {
  const brain = await startFakeBrain({ port: 0, log: () => {} });
  assert.match(await brain.run('dance'), /^error: unknown command/);
  assert.match(await brain.run('move forward left 600'), /^error: no body/);
  brain.close();
});
