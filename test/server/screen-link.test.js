import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { createScreenLink } from '../../server/screen-link.js';
import { PROTOCOL, SCREEN_PATH } from '../../core/protocol.js';

/** @param {Partial<Parameters<typeof createScreenLink>[0]>} [opts] */
async function rig(opts = {}) {
  const http = createServer();
  /** @type {string[]} */ const logged = [];
  const link = createScreenLink({
    server: http,
    admit: (/** @type {string} */ t) => (t === 'bad' ? 'token' : { id: t, name: `n-${t}` }),
    log: (line) => logged.push(line),
    pingMs: 50,
    ...opts,
  });
  await new Promise((r) => http.listen(0, () => r(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (http.address()).port;
  return {
    link, logged,
    url: `ws://127.0.0.1:${port}${SCREEN_PATH}`,
    close: () => { link.close(); http.close(); },
  };
}

/** Connect, say hello, resolve with the first reply (welcome or reject). */
async function hello(/** @type {string} */ url, protocol = PROTOCOL, token = 'a') {
  const ws = new WebSocket(url);
  /** @type {any[]} */ const texts = [];
  /** @type {Buffer[]} */ const frames = [];
  ws.on('message', (d, bin) => { if (bin) frames.push(/** @type {Buffer} */ (d)); else texts.push(JSON.parse(String(d))); });
  await new Promise((r) => ws.once('open', r));
  ws.send(JSON.stringify({ type: 'hello', protocol, token }));
  await until(() => texts.length > 0);
  return { ws, texts, frames };
}

async function until(/** @type {() => boolean} */ pred, ms = 2000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

test('a screen with a token is welcomed, then gets frames as binary', async () => {
  const r = await rig();
  const s = await hello(r.url);
  assert.deepEqual(s.texts[0], { type: 'welcome', name: 'n-a' });
  r.link.show('a', () => Buffer.from('jpg'));
  await until(() => s.frames.length === 1);
  assert.equal(s.frames[0].toString(), 'jpg');
  s.ws.close();
  r.close();
});

test('a bad token, a wrong protocol and a stranger origin are refused', async () => {
  const r = await rig({ allowedOrigins: ['http://ok.test'] });
  const badToken = await hello(r.url, PROTOCOL, 'bad');
  assert.deepEqual(badToken.texts[0], { type: 'reject', reason: 'token' });
  const badProtocol = await hello(r.url, PROTOCOL + 1);
  assert.deepEqual(badProtocol.texts[0], { type: 'reject', reason: 'protocol' });
  const stranger = new WebSocket(r.url, { origin: 'http://evil.test' });
  /** @type {any[]} */ const strangerMsgs = [];
  stranger.on('message', (d, bin) => { if (!bin) strangerMsgs.push(JSON.parse(String(d))); });
  await new Promise((res) => stranger.once('open', res));
  stranger.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL, token: 'a' }));
  await until(() => strangerMsgs.length > 0);
  assert.deepEqual(strangerMsgs[0], { type: 'reject', reason: 'origin' });
  for (const ws of [badToken.ws, badProtocol.ws, stranger]) ws.close();
  r.close();
});

test('several screens on one character all get the frame', async () => {
  const r = await rig();
  const one = await hello(r.url);
  const two = await hello(r.url);
  assert.equal(r.link.count('a'), 2);
  r.link.show('a', () => Buffer.from('x'));
  await until(() => one.frames.length === 1 && two.frames.length === 1);
  one.ws.close(); two.ws.close();
  r.close();
});

test('a frame for a character with no screen is a no-op', async () => {
  const r = await rig();
  assert.equal(r.link.count('nobody'), 0);
  r.link.show('nobody', () => Buffer.from('x'));
  r.close();
});

test('a frame is skipped when the socket is over its buffer, never queued', async () => {
  // A socket that is genuinely backed up cannot be built from the client side
  // without private APIs: ws reports the kernel's bufferedAmount, which drains
  // as fast as localhost can take 64 kB. So the threshold itself is the lever:
  // with maxBuffered below any possible bufferedAmount, every frame must be
  // skipped rather than queued. The behaviour under a real stall is the same
  // line of code — spec §5 wants frames dropped, not latency accumulated.
  const r = await rig({ maxBuffered: -1 });
  const s = await hello(r.url);
  try {
    assert.deepEqual(s.texts[0], { type: 'welcome', name: 'n-a' });
    for (let i = 0; i < 5; i++) r.link.show('a', () => Buffer.alloc(1024, i));
    await new Promise((res) => setTimeout(res, 100));
    assert.equal(s.frames.length, 0, 'nothing was queued');
  } finally {
    s.ws.close();
    r.close();
  }
});

test('a closed screen is forgotten', async () => {
  const r = await rig();
  const s = await hello(r.url);
  assert.equal(r.link.count('a'), 1);
  s.ws.close();
  await until(() => r.link.count('a') === 0);
  r.close();
});
