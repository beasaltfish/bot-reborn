import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRobot, tarotLang } from '../../server/robot.js';
import { renderEarcons } from '../../server/audio/render.js';
import { TEMPLATES, registerPlugins } from '../../core/bodies.js';
import { readyConfig, fakeFetch, until } from './helpers.js';
import { PRESSED_ACTION, isPressedCommand, pluginBody, pointCommand, readResources } from '../fixtures/plugin.js';

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

function rig(/** @type {Parameters<typeof fakeFetch>[0]} */ fetchOpts = {},
  /** @type {string | Record<string, any>} */ body = 'toy',
  /** @type {Record<string, any>} */ overrides = {}) {
  const c = fakeConn();
  const e = fakeEars();
  const { fetch: customFetch, ...deps } = overrides;
  const fetch = fakeFetch(fetchOpts);
  /** @type {string[]} */ const logged = [];
  /** @type {number[]} */ const spoken = [];
  const config = readyConfig();
  // An id, or the whole patch: the tests that ask "does the id decide this?"
  // need a body whose name and template disagree.
  config.body = typeof body === 'string' ? { id: /** @type {any} */ (body) } : /** @type {any} */ ({ ...body });
  const sfx = new Map([[/** @type {const} */ ('bark'), new Int16Array(1600).fill(1200)]]);
  const robot = startRobot(c.conn, {
    config, fetch: customFetch ?? fetch, ears: e.ears, sfx, earcons: renderEarcons(),
    log: (l) => logged.push(l), slackMs: 0,
    ...deps,
    onSpoke: () => spoken.push(1),
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
  return { ...c, fetch, robot, speak, logged, spoken };
}

const states = (/** @type {any[]} */ sent) => sent.filter((m) => m.type === 'state').map((m) => m.state);

/** The turn reached SPEAKING and then left it again. */
const spokeAndFinished = (/** @type {any[]} */ sent) => {
  const s = states(sent);
  const speaking = s.indexOf('SPEAKING');
  return speaking >= 0 && s.slice(speaking + 1).includes('LISTENING');
};

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

test('a real audible reply is reported once, and the wake beep is not one', async () => {
  const r = rig();
  assert.deepEqual(r.spoken, [], 'the wake earcon reached the body before anyone spoke');
  await r.speak();
  await until(() => states(r.sent).includes('SPEAKING'));
  await until(() => r.spoken.length > 0, 3000, () => `states ${JSON.stringify(states(r.sent))}, audio ${r.audio.length}`);
  await until(() => spokeAndFinished(r.sent));
  assert.equal(r.spoken.length, 1);
  r.robot.stop();
});

test('an audible STT apology is not an audible reply', async () => {
  const base = fakeFetch();
  const fetch = /** @type {any} */ ((/** @type {string} */ url, /** @type {RequestInit} */ init) =>
    url.endsWith('/audio/transcriptions') ? Promise.reject(new Error('stt down')) : base(url, init));
  const r = rig({}, 'toy', { fetch });
  const before = r.audio.length;
  await r.speak();
  await until(() => spokeAndFinished(r.sent), 3000, () => `states ${JSON.stringify(states(r.sent))}`);
  assert.ok(r.audio.length > before, 'the apology really went out');
  assert.deepEqual(r.spoken, []);
  r.robot.stop();
});

test('an LLM apology does not count, and the next real answer does', async () => {
  const base = fakeFetch();
  let first = true;
  const fetch = /** @type {any} */ ((/** @type {string} */ url, /** @type {RequestInit} */ init) => {
    if (url.endsWith('/chat/completions') && first) {
      first = false;
      return Promise.reject(new Error('llm down'));
    }
    return base(url, init);
  });
  const r = rig({}, 'toy', { fetch });
  const before = r.audio.length;
  await r.speak();
  await until(() => spokeAndFinished(r.sent), 3000, () => `states ${JSON.stringify(states(r.sent))}`);
  assert.ok(r.audio.length > before, 'the apology really went out');
  assert.deepEqual(r.spoken, [], 'the apology was audible but is not the answer');
  await r.speak();
  await until(() => r.spoken.length > 0, 3000, () => `states ${JSON.stringify(states(r.sent))}, audio ${r.audio.length}`);
  assert.equal(r.spoken.length, 1);
  r.robot.stop();
});

test('an empty reply clip is not something the brain said', async () => {
  const r = rig({ tts: new Int16Array(0) });
  await r.speak();
  await until(() => spokeAndFinished(r.sent));
  assert.deepEqual(r.spoken, []);
  r.robot.stop();
});

test('audio the body never received is not something the brain said', async () => {
  const r = rig();
  r.conn.open = false;
  await r.speak();
  await until(() => spokeAndFinished(r.sent));
  assert.deepEqual(r.spoken, []);
  r.robot.stop();
});

test('a pet’s bark is an audible reply, and the wake beep is still not one', async () => {
  const r = rig({ tool: { name: 'play_sound', args: { name: 'bark' } } }, 'pet', { petFrames: fakePetFrames() });
  assert.deepEqual(r.spoken, [], 'the wake earcon reached the body before the dog answered');
  await r.speak();
  await until(() => r.spoken.length > 0, 3000, () => `states ${JSON.stringify(states(r.sent))}, audio ${r.audio.length}`);
  assert.equal(r.spoken.length, 1);
  assert.ok(r.audio.length > 0);
  r.robot.stop();
});

test('a sound effect is not the reply when a talking body’s voice is empty', async () => {
  const r = rig({ tool: { name: 'play_sound', args: { name: 'bark' } }, tts: new Int16Array(0) });
  await r.speak();
  await until(() => spokeAndFinished(r.sent));
  assert.deepEqual(r.spoken, []);
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

test('a body with a connection sends; one with none only logs', async () => {
  // The toy's own actions, but the dry run's way of being reached: what decides
  // is whether anything is listening, not what the body is called.
  const idle = rig({}, { id: 'toy', template: 'dry-run' });
  await idle.speak();
  await until(() => idle.logged.some((l) => l.startsWith('dry-run: move')));
  assert.ok(!idle.sent.some((m) => m.type === 'move'), 'a body nobody is listening to received a move');
  idle.robot.stop();

  // And the other way round: a body called dry-run that has a board sends.
  const live = rig({}, { id: 'dry-run', template: 'toy' });
  await live.speak();
  await until(() => live.sent.some((m) => m.type === 'move'));
  assert.ok(!live.logged.some((l) => l.startsWith('dry-run')));
  live.robot.stop();
});

test('a body with no connection logs the screen verbs too, and draws nothing', async () => {
  /** @type {string[]} */ const shown = [];
  const r = rig({ tool: { name: 'pose', args: { name: 'sit' } } },
    { id: 'toy', template: 'dry-run', actions: [templateAction('pet', 'pose')] },
    { petFrames: fakePetFrames(), screen: (/** @type {any} */ pick) => shown.push(String(pick('320x240'))) });
  await r.speak();
  await until(() => r.logged.includes('dry-run: pose sit'));
  assert.deepEqual(shown, [], 'a body nobody can reach has no screen either');
  assert.ok(!r.sent.some((m) => m.type === 'move'));
  r.robot.stop();
});

test('a body that can drive and pose does both: the order is sent and the face is drawn', async () => {
  const both = {
    id: 'both', template: 'toy',
    actions: [templateAction('toy', 'move'), templateAction('pet', 'pose')],
  };

  // The motors' half is still reachable: a move goes over the link.
  /** @type {string[]} */ const moved = [];
  const drive = rig({}, both, {
    petFrames: fakePetFrames(), screen: (/** @type {any} */ pick) => moved.push(String(pick('320x240'))),
  });
  await drive.speak();
  await until(() => drive.sent.some((m) => m.type === 'move'));
  assert.ok(!moved.includes('t0'), 'a move is not a pose');
  drive.robot.stop();

  // And the screen's half: the same body draws the sit transition.
  /** @type {string[]} */ const shown = [];
  const pose = rig({ tool: { name: 'pose', args: { name: 'sit' } } }, both, {
    petFrames: fakePetFrames(), screen: (/** @type {any} */ pick) => shown.push(String(pick('320x240'))),
  });
  await pose.speak();
  await until(() => shown.includes('t0'), 3000, () => `shown ${JSON.stringify(shown)}`);
  assert.ok(!pose.sent.some((m) => m.type === 'move'), 'a pose does not drive');
  pose.robot.stop();
});

test('a body that can only halt still hears stop', async () => {
  const r = rig({ tool: { name: 'stop', args: {} } },
    { id: 'stopper', template: 'toy', actions: [templateAction('toy', 'stop')] });
  await r.speak();
  await until(() => r.sent.some((m) => m.type === 'stop'), 3000,
    () => `sent ${JSON.stringify(r.sent)}`);
  r.robot.stop();
});

test('a pose body with no frames still sends the halt it was given', async () => {
  // No petFrames, so there is no screen carrier — but the motors' carrier is
  // not the screen's, and a halt must not be swallowed with it.
  const r = rig({ tool: { name: 'stop', args: {} } },
    {
      id: 'still-face', template: 'toy',
      actions: [templateAction('pet', 'pose'), templateAction('toy', 'stop')],
    });
  await r.speak();
  await until(() => r.sent.some((m) => m.type === 'stop'), 3000,
    () => `sent ${JSON.stringify(r.sent)}`);
  r.robot.stop();
});

test('the reply is decided by whether the body answers in clips, not by its id', async () => {
  const bark = { tool: { name: 'play_sound', args: { name: 'bark' } }, tts: new Int16Array(0) };
  // Called `pet`, but following the voice-only template: the bark is a sound
  // beside a spoken answer, so an empty TTS voice means nothing was said.
  const words = rig(bark, { id: 'pet', template: 'none' }, { petFrames: fakePetFrames() });
  await words.speak();
  await until(() => spokeAndFinished(words.sent));
  assert.deepEqual(words.spoken, []);
  words.robot.stop();

  // Called anything, but answering in clips: the bark IS the reply.
  const clips = rig(bark, { id: 'screen-dog', template: 'pet' }, { petFrames: fakePetFrames() });
  await clips.speak();
  await until(() => clips.spoken.length > 0, 3000, () => `states ${JSON.stringify(states(clips.sent))}`);
  assert.equal(clips.spoken.length, 1);
  clips.robot.stop();
});

/** One template action by name, for a body that needs two carriers at once. */
function templateAction(/** @type {import('../../core/bodies.js').BodyId} */ id, /** @type {string} */ name) {
  const action = TEMPLATES[id].actions.find((candidate) => candidate.name === name);
  assert.ok(action, `${id} has ${name}`);
  return action;
}

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
  config.body.id = 'pet';
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

test('animators are built from the actions, not the id', () => {
  /** @param {Record<string, any>} body */
  const shownFor = (body) => {
    const c = fakeConn();
    const e = fakeEars();
    /** @type {string[]} */ const shown = [];
    const config = readyConfig();
    config.body = /** @type {any} */ ({ ...body });
    const robot = startRobot(c.conn, {
      config, fetch: fakeFetch(), ears: e.ears, sfx: new Map(), earcons: renderEarcons(),
      log: () => {}, slackMs: 0,
      petFrames: fakePetFrames(), tarotFrames: fakeTarotFrames(),
      screen: (pick) => shown.push(String(pick('320x240'))),
    });
    robot.stop();
    return shown;
  };

  const pose = TEMPLATES.pet.actions.find((a) => a.name === 'pose') ?? TEMPLATES.pet.actions[0];
  const sound = TEMPLATES.pet.actions.find((a) => a.name === 'play_sound') ?? TEMPLATES.pet.actions[0];

  // A body called `pet` whose actions were replaced with a sound alone has
  // nothing to animate, so no face is ever drawn.
  assert.deepEqual(shownFor({ id: 'pet', actions: [sound] }), [], 'pose was taken away');
  // A body called anything that can pose gets the pet's screen.
  assert.deepEqual(shownFor({ id: 'toy', actions: [pose] }), ['i0']);
  // And a draw gets the deck, whatever the body is called.
  const draw = TEMPLATES.tarot.actions.find((a) => a.name === 'draw_card') ?? TEMPLATES.tarot.actions[0];
  assert.deepEqual(shownFor({ id: 'toy', actions: [draw] }), ['back']);
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
  config.body.id = 'tarot';
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
    config.body.id = motion;
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
  config.body.id = 'tarot';
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
  const r = rig({}, 'toy');
  assert.equal(r.robot.drawCard(), false);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(r.fetch.calls.filter((c) => c.url.endsWith('/chat/completions')).length, 0);
  r.robot.stop();
});

test('a shake message from a tarot body draws a card; a second one while busy adds none', async () => {
  const r = rig({}, 'tarot');
  r.message({ type: 'shake' });
  r.message({ type: 'shake' });
  await until(() => r.fetch.calls.some((c) => c.url.endsWith('/audio/speech')));
  assert.equal(r.fetch.calls.filter((c) => c.url.endsWith('/chat/completions')).length, 1);
  r.robot.stop();
});

test('a shake draws on any body whose actions draw, whatever it is called', async () => {
  const r = rig({}, { id: 'cards', template: 'tarot' });
  assert.equal(r.robot.drawCard(), true);
  await until(() => r.fetch.calls.some((c) => c.url.endsWith('/audio/speech')));
  assert.equal(r.fetch.calls.filter((c) => c.url.endsWith('/chat/completions')).length, 1);
  r.robot.stop();
});

test('a shake takes no turn on a body whose draw trigger was emptied', async () => {
  const r = rig({}, { id: 'cards', template: 'tarot', triggers: [] });
  await until(() => states(r.sent).includes('LISTENING'));
  const before = states(r.sent).length;

  assert.equal(r.robot.drawCard(), false, 'the draw action is there, but no shake reaches it');
  r.message({ type: 'shake' });
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.ok(!states(r.sent).includes('THINKING'), 'the session was not taken for a turn it would refuse');
  assert.equal(states(r.sent).length, before, 'and it stayed in the state it was in');
  assert.equal(r.fetch.calls.filter((c) => c.url.endsWith('/chat/completions')).length, 0);
  r.robot.stop();
});

test('a shake message to a car does nothing', async () => {
  const r = rig({}, 'toy');
  r.message({ type: 'shake' });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(r.fetch.calls.filter((c) => c.url.endsWith('/chat/completions')).length, 0);
  r.robot.stop();
});

test('a body’s result message answers an IO op and is not a turn', async (t) => {
  registerPlugins({ 'my-servo': pluginBody({ id: 'my-servo', commands: [pointCommand] }) });
  t.after(() => registerPlugins({}));
  const r = rig({}, 'my-servo');
  await until(() => states(r.sent).includes('LISTENING'));
  const before = states(r.sent).length;

  // Nothing was asked for, so this id is unknown: ignored in silence, and the
  // session is not taken for a turn by it.
  r.message({ type: 'result', id: 1, ok: true, value: 1 });
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(states(r.sent).length, before, 'a result changed the state');
  assert.equal(r.fetch.calls.filter((c) => c.url.endsWith('/chat/completions')).length, 0);
  assert.ok(!r.sent.some((m) => m.type === 'cmd'), 'no op was ever called for');
  r.robot.stop();
});

test('a plugin read round-trips through the robot: cmd out, result back, reply spoken', async (t) => {
  // The one path nothing else covers end to end: the brain expands the command,
  // the robot puts a `cmd` on the wire, the body answers, and the model's NEXT
  // request carries the value — then it speaks.
  const slowEnough = { ...isPressedCommand, timeoutMs: 1000 };
  registerPlugins({
    'my-reader': pluginBody({ id: 'my-reader', commands: [slowEnough], resources: readResources }),
  });
  t.after(() => registerPlugins({}));
  const r = rig(
    { tool: { name: 'pressed', args: {} }, once: true, reply: 'The button is pressed.' },
    { id: 'my-reader', actions: [structuredClone(PRESSED_ACTION)] },
  );

  await r.speak();
  await until(() => r.sent.some((m) => m.type === 'cmd'), 3000, () => `sent ${JSON.stringify(r.sent)}`);
  const cmd = r.sent.find((m) => m.type === 'cmd');
  assert.equal(cmd.op, 'pin.read');
  assert.deepEqual(cmd.args, { pin: 4 });
  assert.equal(cmd.timeoutMs, 1000, 'the read is bounded by its command');

  r.message({ type: 'result', id: cmd.id, ok: true, value: 1 });
  await until(() => r.fetch.calls.filter((c) => c.url.endsWith('/chat/completions')).length === 2, 3000,
    () => `chats ${r.fetch.calls.filter((c) => c.url.endsWith('/chat/completions')).length}`);
  const second = r.fetch.calls.filter((c) => c.url.endsWith('/chat/completions'))[1];
  const tool = second.body.messages.find((/** @type {any} */ m) => m.role === 'tool');
  assert.equal(tool.content, '1', 'the read value reached the model');
  await until(() => states(r.sent).includes('SPEAKING'), 3000, () => `states ${JSON.stringify(states(r.sent))}`);
  assert.equal(
    r.fetch.calls.find((c) => c.url.endsWith('/audio/speech'))?.body.input,
    'The button is pressed.',
  );
  r.robot.stop();
});

