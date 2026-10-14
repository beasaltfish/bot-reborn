import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { connectFakeBody } from '../../server/fake-body.js';
import { until } from './helpers.js';

/** A brain that welcomes and then never says another word. */
async function mute() {
  const http = createServer();
  const wss = new WebSocketServer({ server: http, path: '/body' });
  wss.on('connection', (ws) => ws.once('message', () => ws.send(JSON.stringify({ type: 'welcome' }))));
  await new Promise((r) => http.listen(0, () => r(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (http.address()).port;
  return { url: `ws://127.0.0.1:${port}/body`, wss, close: () => { wss.close(); http.close(); } };
}

test('a body that hears nothing for the watchdog period halts by itself', async () => {
  const brain = await mute();
  const start = Date.now();
  const body = await connectFakeBody(brain.url, { watchdogMs: 300 });
  await until(() => body.halted !== null, 2000);
  assert.equal(body.halted?.why, 'watchdog');
  assert.ok(Date.now() - start < 700);
  body.close(); brain.close();
});

test('a body whose brain hangs up halts at once', async () => {
  const brain = await mute();
  const body = await connectFakeBody(brain.url);
  for (const ws of brain.wss.clients) ws.terminate();
  await until(() => body.halted !== null, 500);
  assert.equal(body.halted?.why, 'closed');
  brain.close();
});

test('a new move replaces the one in progress rather than queueing behind it', async () => {
  // The brain renews a cruise LEAD_MS early with only what is left; a body
  // that queued instead would drive 300 ms extra per renewal.
  const brain = await mute();
  const body = await connectFakeBody(brain.url);
  const [ws] = brain.wss.clients;
  ws.send(JSON.stringify({ type: 'move', drive: 'forward', steer: 'straight', ms: 1000 }));
  await until(() => body.driving !== null);
  ws.send(JSON.stringify({ type: 'move', drive: 'backward', steer: 'left', ms: 100 }));
  await until(() => body.driving?.drive === 'backward');
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(body.driving, null);
  ws.send(JSON.stringify({ type: 'move', drive: 'forward', steer: 'straight', ms: 1000 }));
  await until(() => body.driving !== null);
  ws.send(JSON.stringify({ type: 'stop' }));
  await until(() => body.driving === null, 200);
  body.close(); brain.close();
});
