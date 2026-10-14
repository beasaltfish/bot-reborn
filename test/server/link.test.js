import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { createLink } from '../../server/link.js';
import { PROTOCOL } from '../../web/protocol.js';

/** @param {Partial<Parameters<typeof createLink>[0]>} [opts] */
async function rig(opts = {}) {
  const http = createServer();
  /** @type {import('../../server/link.js').BodyConn[]} */ const bodies = [];
  const link = createLink({ server: http, onBody: (c) => bodies.push(c), log: () => {}, ...opts });
  await new Promise((r) => http.listen(0, () => r(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (http.address()).port;
  return {
    bodies,
    url: `ws://127.0.0.1:${port}/body`,
    close: () => { link.close(); http.close(); },
  };
}

/** Connect, say hello, resolve with the first reply and the socket. */
async function hello(/** @type {string} */ url, protocol = PROTOCOL) {
  const ws = new WebSocket(url);
  /** @type {any[]} */ const msgs = [];
  ws.on('message', (d, bin) => { if (!bin) msgs.push(JSON.parse(String(d))); });
  await new Promise((r) => ws.once('open', r));
  ws.send(JSON.stringify({ type: 'hello', protocol, caps: { motors: true } }));
  await until(() => msgs.length > 0);
  return { ws, msgs };
}

async function until(/** @type {() => boolean} */ pred, ms = 2000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('hello is answered with welcome and the body is handed over with its caps', async () => {
  const r = await rig();
  const { ws, msgs } = await hello(r.url);
  assert.deepEqual(msgs[0], { type: 'welcome' });
  assert.deepEqual(r.bodies[0].caps, { motors: true });
  ws.close(); r.close();
});

test('a wrong protocol version is rejected with the reason', async () => {
  const r = await rig();
  const { ws, msgs } = await hello(r.url, PROTOCOL + 1);
  assert.deepEqual(msgs[0], { type: 'reject', reason: 'protocol' });
  // Polled, not awaited as an event: the rejection can close the socket
  // before this line runs, and a missed 'close' event waits forever.
  await until(() => ws.readyState === WebSocket.CLOSED);
  assert.equal(r.bodies.length, 0);
  r.close();
});

test('a second body is turned away and the first keeps working', async () => {
  const r = await rig({ heartbeatMs: 50 });
  const first = await hello(r.url);
  const second = await hello(r.url);
  assert.deepEqual(second.msgs[0], { type: 'reject', reason: 'busy' });
  /** @type {Uint8Array[]} */ const got = [];
  r.bodies[0].onAudio((b) => got.push(b));
  first.ws.send(new Uint8Array([1, 2, 3, 4]));
  await until(() => got.length === 1);
  await until(() => first.msgs.some((m) => m.type === 'ping'));
  assert.equal(r.bodies.length, 1);
  first.ws.close(); r.close();
});

test('the body\'s ping is answered with pong', async () => {
  const r = await rig();
  const { ws, msgs } = await hello(r.url);
  ws.send(JSON.stringify({ type: 'ping' }));
  await until(() => msgs.some((m) => m.type === 'pong'));
  ws.close(); r.close();
});

test('a body that goes silent is dropped after the watchdog and the slot frees', async () => {
  const r = await rig({ heartbeatMs: 50, watchdogMs: 200 });
  const { ws } = await hello(r.url);
  let closed = false;
  r.bodies[0].onClose(() => { closed = true; });
  // The ws client answers protocol-level pings, but not ours: nothing is sent back.
  await until(() => closed, 1000);
  assert.equal(r.bodies[0].open, false);
  r.bodies[0].send({ type: 'stop' });          // must not throw
  r.bodies[0].sendAudio(new Uint8Array(2));    // must not throw
  const again = await hello(r.url);
  assert.deepEqual(again.msgs[0], { type: 'welcome' });
  ws.close(); again.ws.close(); r.close();
});

test('motors messages reach the robot', async () => {
  const r = await rig();
  const { ws } = await hello(r.url);
  /** @type {any[]} */ const got = [];
  r.bodies[0].onMessage((m) => got.push(m));
  ws.send(JSON.stringify({ type: 'motors', connected: false }));
  await until(() => got.length === 1);
  assert.deepEqual(got[0], { type: 'motors', connected: false });
  ws.close(); r.close();
});
