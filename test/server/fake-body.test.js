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
