import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRobot } from '../../server/robot.js';
import { renderEarcons } from '../../server/audio/render.js';
import { t } from '../../web/strings.js';
import { readyConfig, fakeFetch, until } from './helpers.js';

function fakeConn(caps = { motors: true }) {
  /** @type {any[]} */ const sent = [];
  /** @type {Uint8Array[]} */ const audio = [];
  /** @type {Record<string, Function[]>} */ const h = { audio: [], msg: [], close: [] };
  return {
    sent, audio,
    conn: /** @type {any} */ ({
      caps, open: true,
      send: (/** @type {any} */ m) => sent.push(m),
      sendAudio: (/** @type {Uint8Array} */ b) => audio.push(b),
      onAudio: (/** @type {Function} */ f) => h.audio.push(f),
      onMessage: (/** @type {Function} */ f) => h.msg.push(f),
      onClose: (/** @type {Function} */ f) => h.close.push(f),
      close() {},
    }),
    message: (/** @type {any} */ m) => h.msg.forEach((f) => f(m)),
    feed: () => h.audio.forEach((f) => f(new Uint8Array(3200))),
  };
}

/** A VAD the test hands segments to; the next frame drains them into a turn. */
function fakeEars() {
  /** @type {Float32Array[]} */ let queue = [];
  return {
    say() { queue.push(new Float32Array(16000).map((_, i) => 0.3 * Math.sin(i / 5))); },
    ears: {
      kws: { accept: () => [] },
      vad: { accept() {}, detected: false, drain() { const q = queue; queue = []; return q; }, clear() { queue = []; } },
    },
  };
}

function rig(/** @type {Parameters<typeof fakeFetch>[0]} */ fetchOpts, caps = { motors: true }) {
  const c = fakeConn(caps);
  const e = fakeEars();
  const fetch = fakeFetch(fetchOpts);
  const robot = startRobot(c.conn, {
    config: readyConfig(), fetch, ears: e.ears, sfx: new Map(), earcons: renderEarcons(),
    log: () => {}, slackMs: 0,
  });
  /**
   * One utterance: queue a segment, then keep feeding frames until the
   * session drains it. A single frame after a fixed wait was flaky: on a
   * cold first run the wake earcon's gate was still shut and dropped it.
   */
  const speak = async () => {
    e.say();
    await until(() => { c.feed(); return states(c.sent).includes('THINKING'); });
  };
  return { ...c, fetch, robot, speak };
}

const states = (/** @type {any[]} */ sent) => sent.filter((m) => m.type === 'state').map((m) => m.state);

test('the body is told the state, and wakes straight into listening', async () => {
  const r = rig();
  await until(() => states(r.sent).includes('LISTENING'));
  assert.equal(states(r.sent)[0], 'SLEEPING');
  r.robot.stop();
});

test('one utterance becomes a bounded move and a spoken reply', async () => {
  const r = rig();
  await r.speak();
  await until(() => r.sent.some((m) => m.type === 'move'));
  assert.deepEqual(r.sent.find((m) => m.type === 'move'),
    { type: 'move', drive: 'forward', steer: 'straight', ms: 600 });
  await until(() => states(r.sent).includes('SPEAKING'));
  assert.ok(r.audio.length > 0);
  assert.equal(r.fetch.calls.find((c) => c.url.endsWith('/audio/speech'))?.body.input, 'Going!');
  r.robot.stop();
});

test('a body without motors is told so instead of the LLM being asked', async () => {
  const r = rig({}, { motors: false });
  await r.speak();
  await until(() => r.fetch.calls.some((c) => c.url.endsWith('/audio/speech')));
  assert.equal(r.fetch.calls.find((c) => c.url.endsWith('/audio/speech'))?.body.input,
    t('en', 'usbNotConnected'));
  assert.ok(!r.fetch.calls.some((c) => c.url.endsWith('/chat/completions')));
  r.robot.stop();
});

test('motors going away mid-session stops the car', async () => {
  const r = rig();
  await until(() => states(r.sent).includes('LISTENING'));
  r.message({ type: 'motors', connected: false });
  assert.ok(r.sent.some((m) => m.type === 'stop'));
  r.robot.stop();
});

test('the body leaving mid-turn cancels the turn and nothing moves afterwards', async () => {
  const r = rig({ llmHangs: true });
  await r.speak();
  await until(() => r.fetch.calls.some((c) => c.url.endsWith('/chat/completions')));
  r.robot.stop();
  const llm = r.fetch.calls.find((c) => c.url.endsWith('/chat/completions'));
  assert.equal(llm?.signal?.aborted, true);
  await new Promise((res) => setTimeout(res, 200));
  assert.ok(!r.sent.some((m) => m.type === 'move'));
});
