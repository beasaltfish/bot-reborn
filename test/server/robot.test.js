import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRobot, tarotLang } from '../../server/robot.js';
import { renderEarcons } from '../../server/audio/render.js';
import { readyConfig, fakeFetch, until } from './helpers.js';

function fakeConn() {
  /** @type {any[]} */ const sent = [];
  /** @type {Uint8Array[]} */ const audio = [];
  /** @type {Record<string, Function[]>} */ const h = { audio: [], msg: [], close: [] };
  return {
    sent, audio,
    conn: /** @type {any} */ ({
      open: true,
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

function rig(/** @type {Parameters<typeof fakeFetch>[0]} */ fetchOpts = {}, motion = 'car') {
  const c = fakeConn();
  const e = fakeEars();
  const fetch = fakeFetch(fetchOpts);
  /** @type {string[]} */ const logged = [];
  const config = readyConfig();
  config.body.motion = /** @type {any} */ (motion);
  const robot = startRobot(c.conn, {
    config, fetch, ears: e.ears, sfx: new Map(), earcons: renderEarcons(),
    log: (l) => logged.push(l), slackMs: 0,
  });
  /**
   * One utterance: queue a segment, then keep feeding frames until the
   * session drains it. A single frame after a fixed wait was flaky: on a
   * cold first run the wake earcon's gate was still shut and dropped it.
   */
  const speak = async () => {
    e.say();
    await until(() => { c.feed(); return states(c.sent).includes('THINKING'); }, 3000,
      () => `no THINKING; states ${JSON.stringify(states(c.sent))}`);
  };
  return { ...c, fetch, robot, speak, logged };
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

test('the body leaving mid-turn cancels the turn and nothing moves afterwards', async () => {
  const r = rig({ llmHangs: true });
  await r.speak();
  await until(() => r.fetch.calls.some((c) => c.url.endsWith('/chat/completions')), 3000,
    () => `no LLM call; fetches ${JSON.stringify(r.fetch.calls.map((c) => c.url))}, states ${JSON.stringify(states(r.sent))}`);
  r.robot.stop();
  const llm = r.fetch.calls.find((c) => c.url.endsWith('/chat/completions'));
  assert.equal(llm?.signal?.aborted, true);
  await new Promise((res) => setTimeout(res, 200));
  assert.ok(!r.sent.some((m) => m.type === 'move'));
});

test('dry-run: the move is written down and never reaches the body', async () => {
  const r = rig({}, 'dry-run');
  await r.speak();
  await until(() => r.logged.some((l) => l.startsWith('dry-run: move')));
  assert.ok(r.logged.includes('dry-run: move forward/straight 600ms'));
  await until(() => states(r.sent).includes('SPEAKING'));
  assert.ok(!r.sent.some((m) => m.type === 'move'));
  r.robot.stop();
});

test('none: nothing reaches the body, and the LLM was not offered moving', async () => {
  const r = rig({}, 'none');
  await r.speak();
  await until(() => r.fetch.calls.some((c) => c.url.endsWith('/audio/speech')));
  const llm = r.fetch.calls.find((c) => c.url.endsWith('/chat/completions'));
  assert.ok(!llm?.body.tools.some((/** @type {any} */ t) => t.function.name === 'move'));
  assert.ok(!r.sent.some((m) => m.type === 'move'));
  assert.ok(!r.logged.some((l) => l.startsWith('dry-run')));
  r.robot.stop();
});

/** Idle 2 frames at 10 fps; one trick with a single frame. One size is enough. */
function fakePetFrames() {
  /** @param {string[]} frames */
  const art = (frames) => ({ bySize: new Map([['320x240', frames.map((f) => Buffer.from(f))]]) });
  return new Map([
    ['rest-lie', { fps: 10, loop: true, count: 2, ...art(['i0', 'i1']) }],
    ['lie-sit', { fps: 10, loop: false, count: 1, ...art(['t0']) }],
    ['rest-sit', { fps: 10, loop: true, count: 1, ...art(['s0']) }],
  ]);
}

test('a pet streams its lying rest at once, and stops when the robot stops', async () => {
  const c = fakeConn();
  const e = fakeEars();
  /** @type {string[]} */ const shown = [];
  const config = readyConfig();
  config.body.motion = 'pet';
  const robot = startRobot(c.conn, {
    config, fetch: fakeFetch(), ears: e.ears, sfx: new Map(), earcons: renderEarcons(),
    log: () => {}, slackMs: 0,
    petFrames: fakePetFrames(),
    screen: (pick) => shown.push(String(pick('320x240'))),
  });
  assert.deepEqual(shown, ['i0'], 'the first frame is shown without waiting for a tick');
  robot.stop();
  const stopped = shown.length;
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(shown.length, stopped, 'nothing arrives after stop()');
});

test('a car never asks for a screen', async () => {
  const c = fakeConn();
  const e = fakeEars();
  /** @type {string[]} */ const shown = [];
  const robot = startRobot(c.conn, {
    config: readyConfig(), fetch: fakeFetch(), ears: e.ears, sfx: new Map(), earcons: renderEarcons(),
    log: () => {}, slackMs: 0,
    petFrames: fakePetFrames(),
    screen: (pick) => shown.push(String(pick('320x240'))),
  });
  await new Promise((r) => setTimeout(r, 150));
  robot.stop();
  assert.deepEqual(shown, []);
});

/** Tarot frames whose bytes say what they are; one size is enough. */
function fakeTarotFrames() {
  /** @type {any} */
  const frames = {
    sizes: ['320x240'], fps: 10, shuffleCount: 2,
    back: (/** @type {string} */ size) => (size === '320x240' ? Buffer.from('back') : undefined),
    backNarrow: () => Buffer.from('narrow'),
    shuffle: () => [Buffer.from('s0'), Buffer.from('s1')],
    card: () => Buffer.from('card'),
  };
  return frames;
}

test('a tarot reader shows the card back at once, and stops when the robot stops', async () => {
  const c = fakeConn();
  const e = fakeEars();
  /** @type {string[]} */ const shown = [];
  const config = readyConfig();
  config.body.motion = 'tarot';
  const robot = startRobot(c.conn, {
    config, fetch: fakeFetch(), ears: e.ears, sfx: new Map(), earcons: renderEarcons(),
    log: () => {}, slackMs: 0,
    tarotFrames: fakeTarotFrames(),
    screen: (pick) => shown.push(String(pick('320x240'))),
  });
  assert.deepEqual(shown, ['back']);
  robot.stop();
  const stopped = shown.length;
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(shown.length, stopped, 'nothing arrives after stop()');
});

test('a pet never builds the tarot screen, and a tarot reader never builds the pet one', async () => {
  for (const [motion, expected] of /** @type {const} */ ([['pet', ['i0']], ['tarot', ['back']]])) {
    const c = fakeConn();
    const e = fakeEars();
    /** @type {string[]} */ const shown = [];
    const config = readyConfig();
    config.body.motion = motion;
    const robot = startRobot(c.conn, {
      config, fetch: fakeFetch(), ears: e.ears, sfx: new Map(), earcons: renderEarcons(),
      log: () => {}, slackMs: 0,
      petFrames: fakePetFrames(), tarotFrames: fakeTarotFrames(),
      screen: (pick) => shown.push(String(pick('320x240'))),
    });
    robot.stop();
    assert.deepEqual(shown, expected, motion);
  }
});

test('a tarot reader with no frames still connects: a blank screen, and it can be stopped', () => {
  const c = fakeConn();
  const e = fakeEars();
  /** @type {string[]} */ const shown = [];
  const config = readyConfig();
  config.body.motion = 'tarot';
  const robot = startRobot(c.conn, {
    config, fetch: fakeFetch(), ears: e.ears, sfx: new Map(), earcons: renderEarcons(),
    log: () => {}, slackMs: 0,
    screen: (pick) => shown.push(String(pick('320x240'))),
  });
  assert.deepEqual(shown, []);
  assert.doesNotThrow(() => robot.stop());
});

test('the card name is written in the reply language, else the interface language, else English', () => {
  assert.equal(tarotLang({ replyLang: 'zh', lang: 'en' }), 'zh');
  assert.equal(tarotLang({ replyLang: 'en', lang: 'zh' }), 'en');
  assert.equal(tarotLang({ replyLang: null, lang: 'zh' }), 'zh');
  assert.equal(tarotLang({ replyLang: null, lang: 'en' }), 'en');
  assert.equal(tarotLang({ replyLang: null }), 'en');
});

test('drawCard on a tarot reader starts a turn that asks the model once, with no tools; while busy it is refused', async () => {
  const r = rig({}, 'tarot');
  assert.equal(r.robot.drawCard(), true);
  assert.equal(r.robot.drawCard(), false, 'the first draw is still THINKING');
  await until(() => r.fetch.calls.some((c) => c.url.endsWith('/audio/speech')));
  const chats = r.fetch.calls.filter((c) => c.url.endsWith('/chat/completions'));
  assert.equal(chats.length, 1);
  assert.ok(!chats[0].body.tools?.length, 'a card already drawn is read with no tools');
  assert.match(JSON.stringify(chats[0].body.messages), /shook the wand/);
  r.robot.stop();
});

test('drawCard on any other body does nothing', async () => {
  const r = rig({}, 'car');
  assert.equal(r.robot.drawCard(), false);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(r.fetch.calls.filter((c) => c.url.endsWith('/chat/completions')).length, 0);
  r.robot.stop();
});
