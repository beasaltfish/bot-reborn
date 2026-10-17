import test from 'node:test';
import assert from 'node:assert/strict';
import { connectBody } from '../phone/body-link.js';
import { PROTOCOL } from '../core/protocol.js';

class FakeSocket {
  /** @type {FakeSocket[]} */ static all = [];
  /** @param {string} url */
  constructor(url) {
    this.url = url;
    /** @type {any[]} */ this.sent = [];
    this.readyState = 0;
    this.binaryType = 'blob';
    /** @type {any} */ this.onopen = null;
    /** @type {any} */ this.onmessage = null;
    /** @type {any} */ this.onclose = null;
    this.silentClose = false;
    FakeSocket.all.push(this);
  }
  /** @param {any} data */
  send(data) { this.sent.push(data); }
  close() {
    // A real browser waits for the peer to answer the close; a peer that is
    // gone never does, and onclose can be a minute away.
    if (this.silentClose) { this.readyState = 2; return; }
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({});
  }
  // The brain's side.
  open() { this.readyState = 1; this.onopen?.({}); }
  /** @param {object} msg */
  text(msg) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  /** @param {ArrayBuffer} buf */
  binary(buf) { this.onmessage?.({ data: buf }); }
  get texts() { return this.sent.filter((d) => typeof d === 'string').map((d) => JSON.parse(d)); }
}

const wait = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
/** Timers run late on a loaded machine: wait for the condition, not a fixed time. */
async function until(/** @type {() => boolean} */ pred, ms = 2000) {
  const end = Date.now() + ms;
  while (!pred() && Date.now() < end) await wait(10);
}

/** @param {Partial<Parameters<typeof connectBody>[0]>} [over] */
function rig(over = {}) {
  FakeSocket.all = [];
  /** @type {string[]} */ const events = [];
  const link = connectBody({
    url: 'ws://brain/body', token: 'ab'.repeat(16),
    WebSocket: /** @type {any} */ (FakeSocket),
    onWelcome: (name) => events.push(`welcome ${name}`),
    onMessage: (msg) => events.push(`msg ${msg.type}`),
    onAudio: (b) => events.push(`audio ${b.byteLength}`),
    onLost: () => events.push('lost'),
    onReject: (why) => events.push(`reject ${why}`),
    watchdogMs: 120, heartbeatMs: 40, retryMs: [30],
    ...over,
  });
  return { link, events, socket: (/** @type {number} */ i = 0) => FakeSocket.all[i] };
}

test('it says hello first, with its token, and is welcomed by name', () => {
  const r = rig();
  r.socket().open();
  assert.deepEqual(r.socket().texts[0], { type: 'hello', protocol: PROTOCOL, token: 'ab'.repeat(16) });
  assert.equal(r.socket().binaryType, 'arraybuffer');
  r.socket().text({ type: 'welcome', name: 'Rex' });
  assert.deepEqual(r.events, ['welcome Rex']);
  assert.equal(r.link.welcomed, true);
  r.link.close();
});

test('no audio goes up before the welcome (spec §3)', () => {
  const r = rig();
  r.socket().open();
  r.link.sendAudio(new Int16Array(1600));
  assert.equal(r.socket().sent.length, 1);   // the hello, nothing else
  r.socket().text({ type: 'welcome', name: 'Rex' });
  r.link.sendAudio(new Int16Array(1600));
  assert.equal(r.socket().sent.at(-1).byteLength, 3200);
  r.link.close();
});

test('pings are answered and never reach the caller; orders and audio do', () => {
  const r = rig();
  r.socket().open();
  r.socket().text({ type: 'welcome', name: 'Rex' });
  r.socket().text({ type: 'ping' });
  assert.deepEqual(r.socket().texts.at(-1), { type: 'pong' });
  r.socket().text({ type: 'move', drive: 'forward', steer: 'left', ms: 500 });
  r.socket().text({ type: 'move', drive: 'sideways', steer: 'left', ms: 500 });   // malformed: dropped
  r.socket().binary(new ArrayBuffer(320));
  assert.deepEqual(r.events, ['welcome Rex', 'msg move', 'audio 320']);
  r.link.close();
});

test('a silent brain is dropped within the watchdog, and the link comes back by itself', async () => {
  const r = rig();
  r.socket().open();
  r.socket().text({ type: 'welcome', name: 'Rex' });
  await until(() => FakeSocket.all.length >= 2);
  assert.ok(r.events.includes('lost'), 'never noticed the silence');
  assert.equal(r.socket().readyState, 3);
  assert.ok(FakeSocket.all.length >= 2, 'never tried again');
  r.socket(1).open();
  r.socket(1).text({ type: 'welcome', name: 'Rex' });
  assert.equal(r.link.welcomed, true);
  r.link.close();
});

test('it pings the brain while it waits, so the brain does not drop it either', async () => {
  const r = rig();
  r.socket().open();
  r.socket().text({ type: 'welcome', name: 'Rex' });
  await wait(100);
  assert.ok(r.socket().texts.some((m) => m.type === 'ping'));
  r.link.close();
});

test('a brain that is not there yet is tried again', async () => {
  const r = rig();
  r.socket().close();   // refused before it ever opened
  await wait(60);
  assert.ok(FakeSocket.all.length >= 2);
  r.link.close();
});

test('told no, it stops: no retry after a reject (a replaced token, a second phone)', async () => {
  for (const reason of ['token', 'busy']) {
    const r = rig();
    r.socket().open();
    r.socket().text({ type: 'reject', reason });
    await wait(100);
    assert.deepEqual(r.events, [`reject ${reason}`]);
    assert.equal(FakeSocket.all.length, 1);
  }
});

test('kicked, then refused on the way back: one lost, one reject, and silence after', async () => {
  const r = rig();
  r.socket().open();
  r.socket().text({ type: 'welcome', name: 'Rex' });
  r.socket().close();                      // the admin page replaced the token
  await wait(60);
  r.socket(1).open();
  r.socket(1).text({ type: 'reject', reason: 'token' });
  await wait(100);
  assert.deepEqual(r.events, ['welcome Rex', 'lost', 'reject token']);
  assert.equal(FakeSocket.all.length, 2);
});

test('close() is final', async () => {
  const r = rig();
  r.socket().open();
  r.socket().text({ type: 'welcome', name: 'Rex' });
  r.link.close();
  await wait(100);
  assert.equal(FakeSocket.all.length, 1);
  assert.ok(!r.events.includes('lost'), 'a stop the user asked for is not a lost link');
});

test('the watchdog does not wait for a dead brain to answer the close', async () => {
  const r = rig();
  r.socket().open();
  r.socket().silentClose = true;
  r.socket().text({ type: 'welcome', name: 'Rex' });
  await until(() => FakeSocket.all.length >= 2);
  assert.ok(r.events.includes('lost'), 'the lost link was only reported once the socket finished closing');
  assert.ok(FakeSocket.all.length >= 2, 'it waited for the dead socket before trying again');
  // The dead socket finishing its close later is not a second loss.
  const lost = r.events.filter((e) => e === 'lost').length;
  r.socket(0).onclose?.({});
  assert.equal(r.events.filter((e) => e === 'lost').length, lost);
  r.link.close();
});
