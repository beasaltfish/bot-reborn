import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, wantedSubscriptions, IDLE_TO_SLEEP_MS } from '../web/audio/session.js';
import { defaultConfig } from '../web/config.js';

/**
 * A whole robot made of fakes.
 *
 * Everything Session touches is injected, including both clocks. That is the
 * only reason a state machine sitting between a microphone and a car can be
 * tested at all (§10).
 *
 * @param {Record<string, any>} [over]
 */
export function harness(over = {}) {
  let now = 1000;
  /** @type {{ ms: number, fn: () => void }[]} */ const timers = [];
  /** @type {any[][]} */ const calls = [];
  const rec = (/** @type {string} */ name) =>
    (/** @type {any[]} */ ...args) => void calls.push([name, ...args]);

  const pipeline = {
    /** @type {Map<string, (frame: Float32Array) => void>} */ subs: new Map(),
    /** @param {string} n @param {(frame: Float32Array) => void} fn */
    subscribe(n, fn) { this.subs.set(n, fn); },
    /** @param {string} n */
    unsubscribe(n) { this.subs.delete(n); },
  };
  // Declared outside the literals: a JSDoc type on a property inside an object
  // literal does not take, and both of these infer as never[] without it.
  /** @type {string[]} */ const hits = [];
  /** @type {Float32Array[]} */ const segments = [];
  const kws = { hits, accept: () => hits.splice(0) };
  const vad = {
    detected: false,
    segments,
    cleared: 0,
    accept: rec('vad.accept'),
    drain: () => segments.splice(0),
    clear() { vad.cleared++; },
  };
  const deps = {
    pipeline, kws, vad,
    stt: { transcribe: async () => 'hello' },
    tts: { speak: async () => {}, cancel: rec('tts.cancel') },
    executor: { stop: rec('executor.stop') },
    earcon: (/** @type {string} */ name) => { calls.push(['earcon', name]); return 80; },
    config: { ...defaultConfig('en') },
    now: () => now,
    after: (/** @type {number} */ ms, /** @type {() => void} */ fn) =>
      void timers.push({ ms, fn }),
    ...over,
  };
  const session = new Session(deps);
  const h = {
    session, deps, calls, pipeline, kws, vad,
    /** @param {number} [ms] */
    tick(ms = 0) { now += ms; timers.splice(0).forEach((t) => t.fn()); },
    // Frames only reach a subscriber. That is the point of the gate, so the
    // harness must not route around it.
    /** @param {string} name */
    feed(name) { pipeline.subs.get(name)?.(new Float32Array(1600)); },
    names() { return [...pipeline.subs.keys()].sort(); },
    /** @param {string} name */
    took(name) { return calls.filter((c) => c[0] === name).length; },
    /** wake() plays an earcon, and an earcon unsubscribes everything for its
     *  duration — so anything feeding frames afterwards has to wait it out. */
    wake() { session.wake(); h.tick(80); },
  };
  return h;
}

// --- §5.3, one assertion per row -------------------------------------------

test('the subscription table has the five rows spec §5.3 has', () => {
  assert.deepEqual(wantedSubscriptions('SLEEPING', true, false), { kws: true, vad: false });
  assert.deepEqual(wantedSubscriptions('LISTENING', true, false), { kws: true, vad: true });
  assert.deepEqual(wantedSubscriptions('CAPTURING', true, false), { kws: true, vad: true });
  assert.deepEqual(wantedSubscriptions('THINKING', true, false), { kws: true, vad: true });
  assert.deepEqual(wantedSubscriptions('SPEAKING', true, false), { kws: true, vad: true });
  assert.deepEqual(wantedSubscriptions('SPEAKING', false, false), { kws: true, vad: false });
});

test('an earcon gates everything, in every state', () => {
  for (const s of /** @type {const} */ (['SLEEPING', 'LISTENING', 'CAPTURING', 'THINKING', 'SPEAKING'])) {
    assert.deepEqual(wantedSubscriptions(s, true, true), { kws: false, vad: false },
      `${s} should be fully gated while an earcon plays`);
  }
});

test('the stop word is never gated out by a state — only by an earcon', () => {
  // §5.5: "all stop" is valid in all states, no exceptions. A false for kws may
  // only ever come from the earcon row.
  for (const s of /** @type {const} */ (['SLEEPING', 'LISTENING', 'CAPTURING', 'THINKING', 'SPEAKING'])) {
    for (const barge of [true, false]) {
      assert.equal(wantedSubscriptions(s, barge, false).kws, true);
    }
  }
});

// --- the machine -----------------------------------------------------------

test('it starts asleep, listening only for the wake word', () => {
  const h = harness();
  h.session.start();
  assert.equal(h.session.state, 'SLEEPING');
  assert.deepEqual(h.names(), ['kws']);
});

test('VAD frames are not even delivered while asleep', () => {
  const h = harness();
  h.session.start();
  h.feed('vad');
  assert.equal(h.took('vad.accept'), 0);
});

test('detected speech moves LISTENING to CAPTURING', () => {
  const h = harness();
  h.session.start();
  h.wake();
  assert.equal(h.session.state, 'LISTENING');
  h.vad.detected = true;
  h.feed('vad');
  assert.equal(h.session.state, 'CAPTURING');
});

test('the 30 s clock runs in LISTENING and nowhere else (§5.2)', () => {
  const h = harness();
  h.session.start();
  h.wake();
  h.tick(IDLE_TO_SLEEP_MS + 1);
  h.feed('vad');
  assert.equal(h.session.state, 'SLEEPING');
});

test('the clock is reset on entering LISTENING, not carried in from before', () => {
  // Without this, a turn that took longer than 30 s would drop straight through
  // to SLEEPING the moment it handed control back — the opposite of what §5.2
  // measures. It measures "it was ready and you said nothing".
  const h = harness();
  h.session.start();
  h.tick(IDLE_TO_SLEEP_MS * 2);
  h.wake();
  h.feed('vad');
  assert.equal(h.session.state, 'LISTENING');
});

test('speech keeps the session awake for as long as it keeps coming', () => {
  const h = harness();
  h.session.start();
  h.wake();
  for (let i = 0; i < 5; i++) {
    h.tick(IDLE_TO_SLEEP_MS - 1000);
    h.vad.detected = true;
    h.feed('vad');              // CAPTURING, and the clock is zeroed
    h.vad.detected = false;
    h.session.backToListeningForTest();
  }
  assert.equal(h.session.state, 'LISTENING');
});

test('the car is stopped BEFORE the session goes to sleep (§5.2)', () => {
  // Never let a running car into SLEEPING — a cruise especially, since nothing
  // else will ever end it.
  const h = harness();
  h.session.start();
  h.wake();
  h.tick(IDLE_TO_SLEEP_MS + 1);
  h.feed('vad');
  assert.equal(h.took('executor.stop'), 1);
  assert.deepEqual(
    h.calls.filter((c) => c[0] === 'earcon').map((c) => c[1]),
    ['wake', 'sleep'],
  );
});

test('an earcon unsubscribes the whole pipeline and puts it back', () => {
  const h = harness();
  h.session.start();
  h.session.wake();                 // plays `wake`, 80 ms
  assert.deepEqual(h.names(), []);  // gated
  h.tick(80);
  assert.deepEqual(h.names(), ['kws', 'vad']);
});

// --- §5.5, the two words ---------------------------------------------------

test('the wake word does NOT clear the VAD buffer', () => {
  // Said in one breath — "hey steven 往前走" — KWS reports tens to hundreds of
  // ms after `steven` ends, by which time 「往」 is already in the buffer.
  // Clearing throws it away and STT hears 「前走」. That failure makes no sound;
  // it just looks like STT being bad.
  const h = harness();
  h.session.start();
  h.kws.hits.push('hey_steven');
  h.feed('kws');
  assert.equal(h.session.state, 'LISTENING');
  assert.equal(h.vad.cleared, 0);
});

test('the stop word DOES discard what is in hand', () => {
  // Opposite meaning, opposite cleanup: "stop now, never mind the rest".
  const h = harness();
  h.session.start();
  h.wake();
  h.kws.hits.push('all_stop');
  h.feed('kws');
  assert.ok(h.vad.cleared > 0);
  assert.equal(h.session.state, 'SLEEPING');
  assert.equal(h.took('executor.stop'), 1);
});

test('both spellings of each word behave identically (§11.2)', () => {
  // The _zh lines are the same word spelled for a different mouth, not a
  // second keyword.
  const a = harness();
  a.session.start();
  a.kws.hits.push('hey_steven_zh');
  a.feed('kws');
  assert.equal(a.session.state, 'LISTENING');

  const b = harness();
  b.session.start();
  b.wake();
  b.kws.hits.push('all_stop_zh');
  b.feed('kws');
  assert.equal(b.session.state, 'SLEEPING');
  assert.equal(b.took('executor.stop'), 1);
});

test('a label no keyword file produces is ignored, not guessed at', () => {
  const h = harness();
  h.session.start();
  h.kws.hits.push('LIGHT_UP');
  h.feed('kws');
  assert.equal(h.session.state, 'SLEEPING');
});

test('a stop word heard DURING playback stops the car, not just the mouth', () => {
  // The defect spec §5.5 names: the natural way to write "a keyword during
  // playback cuts the TTS" puts both words in one branch, and the car keeps
  // going. It is a safety defect, and the spike still has it.
  const h = harness();
  h.session.start();
  h.wake();
  h.session.enterSpeakingForTest();
  h.kws.hits.push('all_stop');
  h.feed('kws');
  assert.ok(h.took('tts.cancel') > 0, 'the mouth is shut');
  assert.equal(h.took('executor.stop'), 1, 'AND the car is stopped');
  assert.equal(h.session.state, 'SLEEPING');
});

test('a wake word heard during playback is only an interruption', () => {
  const h = harness();
  h.session.start();
  h.wake();
  h.session.enterSpeakingForTest();
  h.kws.hits.push('hey_steven');
  h.feed('kws');
  assert.ok(h.took('tts.cancel') > 0);
  assert.equal(h.took('executor.stop'), 0, 'the car is not part of this');
  assert.equal(h.session.state, 'LISTENING');
});

test('the emergency button and the stop word take the same path (§4.1)', () => {
  const h = harness();
  h.session.start();
  h.wake();
  h.session.onEmergencyStop();
  assert.equal(h.took('executor.stop'), 1);
  assert.equal(h.session.state, 'SLEEPING');
});
