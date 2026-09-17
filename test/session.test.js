import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, wantedSubscriptions, IDLE_TO_SLEEP_MS } from '../web/audio/session.js';
import { defaultConfig } from '../web/config.js';

/**
 * A segment or frame at the level real speech arrives at — −20 dBFS, the
 * middle of the −20…−25 measured on 2026-09-17. session.js refuses anything
 * under −40 now, so silence is a test case in its own right rather than the
 * default filler it used to be.
 *
 * @param {number} n
 */
export const loud = (n) => new Float32Array(n).fill(0.1);

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
  // The TTS is controllable rather than overridable: a test that replaces it
  // wholesale loses the call recording, and half of what these tests assert is
  // exactly which of speak/cancel ran.
  /** @type {(() => Promise<void>) | null} */ let speakImpl = null;
  /** @type {(() => void) | null} */ let onCancel = null;
  const tts = {
    /** @param {string} text */
    speak: (text) => {
      calls.push(['tts.speak', text]);
      return speakImpl?.() ?? Promise.resolve();
    },
    cancel: () => { calls.push(['tts.cancel']); onCancel?.(); },
  };
  const deps = {
    pipeline, kws, vad, tts,
    stt: { transcribeDetailed: async () => ({ text: 'hello', logprob: null }) },
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
    /** @param {string} name @param {number} [amplitude] */
    feed(name, amplitude = 0.1) {
      pipeline.subs.get(name)?.(new Float32Array(1600).fill(amplitude));
    },
    names() { return [...pipeline.subs.keys()].sort(); },
    /** @param {string} name */
    took(name) { return calls.filter((c) => c[0] === name).length; },
    /** wake() plays an earcon, and an earcon unsubscribes everything for its
     *  duration — so anything feeding frames afterwards has to wait it out. */
    wake() { session.wake(); h.tick(80); },
    /** Playback that ends only when something cancels it — which is what the
     *  real WebAudioTts does: cancel() fades out and lets speak() resolve. A
     *  stall that never resolves would hide everything speak()'s tail does. */
    stallSpeak() {
      speakImpl = () => new Promise((resolve) => { onCancel = () => resolve(); });
    },
    /** @param {string} why */
    failSpeak(why) { speakImpl = () => Promise.reject(new Error(why)); },
    /** @param {string} name */
    spoken(name = 'tts.speak') {
      return calls.filter((c) => c[0] === name).map((c) => c[1]);
    },
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

test('a conversation that keeps going never times out', async () => {
  // Spec §5.2: every detected voice zeroes the clock, so the user talking is
  // what keeps the car available. Five full turns, each starting 29 s after the
  // last one ended.
  const h = harness();
  h.session.attach({ handle: async () => {}, cancel() {}, resetHistory() {} });
  h.session.start();
  h.wake();
  for (let i = 0; i < 5; i++) {
    h.tick(IDLE_TO_SLEEP_MS - 1000);
    h.vad.segments.push(loud(16));
    h.feed('vad');
    await settle();
    assert.equal(h.session.state, 'LISTENING', `turn ${i} should have come back`);
  }
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

test('a stop word heard DURING playback stops the car, not just the mouth', async () => {
  // The defect spec §5.5 names: the natural way to write "a keyword during
  // playback cuts the TTS" puts both words in one branch, and the car keeps
  // going. It is a safety defect, and the spike still has it.
  const h = await speakingSession();
  h.kws.hits.push('all_stop');
  h.feed('kws');
  assert.ok(h.took('tts.cancel') > 0, 'the mouth is shut');
  assert.equal(h.took('executor.stop'), 1, 'AND the car is stopped');
  assert.equal(h.session.state, 'SLEEPING');
});

test('a wake word heard during playback is only an interruption', async () => {
  const h = await speakingSession();
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

// --- one turn --------------------------------------------------------------

/**
 * A Brain whose handle() can be held open, so a turn can be preempted
 * mid-flight the way a real one is.
 * @param {any} session @param {any[][]} calls
 */
function fakeBrain(session, calls) {
  /** @type {(() => void) | null} */ let release = null;
  return {
    /** @type {string[]} */ seen: [],
    resetHistory() { calls.push(['brain.resetHistory']); },
    cancel() { calls.push(['brain.cancel']); release?.(); },
    /** @param {string} text */
    async handle(text) {
      this.seen.push(text);
      await new Promise((r) => { release = () => r(undefined); });
      // A real Brain speaks through the wrapper it was constructed with.
      await session.speakingTts.speak('ok');
    },
    finish() { release?.(); },
  };
}

const settle = () => new Promise((r) => setImmediate(r));

/** A session driven through a real turn until the reply is playing. There is no
 *  shortcut into SPEAKING: it is a state the turn puts you in, and a test entry
 *  point for it would be testing a path the product does not have. */
async function speakingSession() {
  const h = harness();
  const brain = fakeBrain(h.session, h.calls);
  h.session.attach(brain);
  h.session.start();
  h.wake();
  h.stallSpeak();
  h.vad.segments.push(loud(16));
  h.feed('vad');
  await settle();
  brain.finish();
  await settle();
  assert.equal(h.session.state, 'SPEAKING');
  return h;
}

test('a segment runs STT and hands the text to the brain', async () => {
  const h = harness();
  const brain = fakeBrain(h.session, h.calls);
  h.session.attach(brain);
  h.session.start();
  h.wake();
  h.vad.segments.push(loud(16000));
  h.feed('vad');
  assert.equal(h.session.state, 'THINKING');
  await settle();
  assert.deepEqual(brain.seen, ['hello']);
});

test('STT gets Int16 at 16 kHz, and a signal it can be cancelled with', async () => {
  /** @type {any} */ let seen = null;
  const h = harness({
    stt: {
      /** @param {Int16Array} pcm @param {number} rate @param {any} opts */
      transcribeDetailed: async (pcm, rate, opts) => {
        seen = { pcm, rate, signal: opts?.signal };
        return { text: 'hi', logprob: null };
      },
    },
  });
  h.session.attach(fakeBrain(h.session, h.calls));
  h.session.start();
  h.wake();
  h.vad.segments.push(new Float32Array([0, 1, -1]));
  h.feed('vad');
  await settle();
  assert.ok(seen.pcm instanceof Int16Array);
  assert.deepEqual([...seen.pcm], [0, 32767, -32767]);
  assert.equal(seen.rate, 16000);
  assert.ok(seen.signal instanceof AbortSignal);
});

test('an empty transcript is a `huh` and never reaches the LLM (§6.7)', async () => {
  const h = harness({ stt: { transcribeDetailed: async () => ({ text: '   ', logprob: null }) } });
  const brain = fakeBrain(h.session, h.calls);
  h.session.attach(brain);
  h.session.start();
  h.wake();
  h.vad.segments.push(loud(16));
  h.feed('vad');
  await settle();
  assert.deepEqual(brain.seen, []);
  assert.ok(h.calls.some((c) => c[0] === 'earcon' && c[1] === 'huh'));
  assert.equal(h.session.state, 'LISTENING');
});

test('a failed STT is an `error` plus the fixed line (§6.7)', async () => {
  const h = harness({
    stt: { transcribeDetailed: async () => { throw new Error('502'); } },
  });
  h.session.attach(fakeBrain(h.session, h.calls));
  h.session.start();
  h.wake();
  h.vad.segments.push(loud(16));
  h.feed('vad');
  await settle();
  assert.ok(h.calls.some((c) => c[0] === 'earcon' && c[1] === 'error'));
  assert.deepEqual(h.spoken(), ['I could not reach the server.']);
});

test('a TTS that also fails does not get retried (§6.7)', async () => {
  // Retrying is asking the path just proven dead to report that it is dead.
  // One `error` earcon, and stop.
  const h = harness({
    stt: { transcribeDetailed: async () => { throw new Error('502'); } },
  });
  h.session.attach(fakeBrain(h.session, h.calls));
  h.session.start();
  h.wake();
  h.failSpeak('timeout');
  h.vad.segments.push(loud(16));
  h.feed('vad');
  await settle();
  assert.equal(h.took('tts.speak'), 1, 'exactly one attempt, never a retry');
  assert.equal(h.session.state, 'LISTENING');
});

test('SPEAKING brackets exactly the playback, not the whole turn', async () => {
  const h = harness();
  const brain = fakeBrain(h.session, h.calls);
  h.session.attach(brain);
  h.session.start();
  h.wake();
  h.vad.segments.push(loud(16));
  h.feed('vad');
  await settle();
  assert.equal(h.session.state, 'THINKING', 'the LLM is not the mouth');
  brain.finish();
  await settle();
  assert.equal(h.session.state, 'LISTENING');
});

test('a stop word mid-reply leaves the session ASLEEP, not listening', async () => {
  // The spike's second bug: speak()'s tail did an unconditional
  // setState('LISTENING'), which put back the SLEEPING that `all stop` had just
  // set. §4.5's generation counter is exactly what covers this.
  const h = harness();
  const brain = fakeBrain(h.session, h.calls);
  h.session.attach(brain);
  h.session.start();
  h.wake();
  h.stallSpeak();
  h.vad.segments.push(loud(16));
  h.feed('vad');
  await settle();
  brain.finish();                       // the brain reaches speakingTts.speak()
  await settle();
  assert.equal(h.session.state, 'SPEAKING');
  h.kws.hits.push('all_stop');
  h.feed('kws');
  assert.equal(h.session.state, 'SLEEPING');
  await settle();
  assert.equal(h.session.state, 'SLEEPING', 'the tail of speak() must not undo it');
});

test('a wake word during THINKING cancels the turn in flight (§8.1)', async () => {
  const h = harness();
  const brain = fakeBrain(h.session, h.calls);
  h.session.attach(brain);
  h.session.start();
  h.wake();
  h.vad.segments.push(loud(16));
  h.feed('vad');
  await settle();
  h.kws.hits.push('hey_steven');
  h.feed('kws');
  assert.ok(h.calls.some((c) => c[0] === 'brain.cancel'));
  assert.equal(h.session.state, 'LISTENING');
});

test('a cancelled turn never gets to speak its reply', async () => {
  // brain.handle() can resume after cancel() and run on to its reply — the
  // fake does exactly that, and so does a real Brain whose await happened to
  // settle first. Speaking here would read out the answer to a question the
  // user has already talked past.
  const h = harness();
  const brain = fakeBrain(h.session, h.calls);
  h.session.attach(brain);
  h.session.start();
  h.wake();
  h.vad.segments.push(loud(16));
  h.feed('vad');
  await settle();
  h.kws.hits.push('hey_steven');
  h.feed('kws');
  await settle();
  assert.deepEqual(h.spoken(), [], 'the dead turn must not reach the speaker');
});

test('a cancelled turn cannot drag a newer one back to LISTENING', async () => {
  // The user interrupts, then immediately starts talking again. The dead turn
  // finishes unwinding a moment later; if its tail is still allowed to set a
  // state, it cuts the new sentence off at the knees — and silently.
  const h = harness();
  const brain = fakeBrain(h.session, h.calls);
  h.session.attach(brain);
  h.session.start();
  h.wake();
  h.vad.segments.push(loud(16));
  h.feed('vad');
  await settle();
  h.kws.hits.push('hey_steven');
  h.feed('kws');                 // turn aborted, back to LISTENING
  h.vad.detected = true;
  h.feed('vad');                 // the user is already talking again
  assert.equal(h.session.state, 'CAPTURING');
  await settle();                // the dead turn unwinds now
  assert.equal(h.session.state, 'CAPTURING', 'the dead turn must not set a state');
});

test('a segment arriving mid-turn does not start a second one', async () => {
  // §5.2 has no arrow back from THINKING. Two turns racing would answer one
  // instruction twice — with two sets of car actions.
  const h = harness();
  const brain = fakeBrain(h.session, h.calls);
  h.session.attach(brain);
  h.session.start();
  h.wake();
  h.vad.segments.push(loud(16));
  h.feed('vad');
  await settle();
  h.vad.segments.push(loud(16));
  h.feed('vad');
  await settle();
  assert.equal(brain.seen.length, 1);
});

// --- the two floors ---------------------------------------------------------

test('a segment under the level floor never becomes a turn', async () => {
  // The VAD cutting a segment is not evidence anybody spoke. Chrome's residual
  // echo suppressor hands it low-level bursts in a silent room and silero
  // reads them as speech; letting one through costs a hallucinated transcript
  // driving the car, which is the expensive direction to be wrong in.
  /** @type {number} */ let asked = 0;
  const h = harness({
    stt: {
      transcribeDetailed: async () => { asked++; return { text: 'go', logprob: null }; },
    },
  });
  const brain = fakeBrain(h.session, h.calls);
  h.session.attach(brain);
  h.session.start();
  h.wake();
  h.vad.segments.push(new Float32Array(16).fill(0.001));  // −60 dBFS
  h.feed('vad');
  await settle();
  assert.equal(asked, 0, 'the STT was never called');
  assert.deepEqual(brain.seen, []);
});

test('refusing a quiet segment says nothing — no earcon answers nobody', async () => {
  const h = harness();
  h.session.attach(fakeBrain(h.session, h.calls));
  h.session.start();
  h.wake();
  const before = h.calls.filter((c) => c[0] === 'earcon').length;
  h.vad.segments.push(new Float32Array(16).fill(0.001));
  h.feed('vad');
  await settle();
  assert.equal(h.calls.filter((c) => c[0] === 'earcon').length, before);
});

test('a quiet frame does not keep the session awake', async () => {
  // The failure this prevents is silent and permanent: one burst a minute
  // resets §5.2's clock forever, the car never reaches SLEEPING, and nothing
  // in any log says so.
  const h = harness();
  h.session.attach(fakeBrain(h.session, h.calls));
  h.session.start();
  h.wake();
  h.vad.detected = true;
  h.tick(IDLE_TO_SLEEP_MS - 1);
  h.feed('vad', 0.001);            // a burst, not a voice
  h.tick(2);
  h.feed('vad', 0.001);
  assert.equal(h.session.state, 'SLEEPING');
});

test('a loud frame does keep it awake — the floor is not a mute button', async () => {
  const h = harness();
  h.session.attach(fakeBrain(h.session, h.calls));
  h.session.start();
  h.wake();
  h.vad.detected = true;
  h.tick(IDLE_TO_SLEEP_MS - 1);
  h.feed('vad');                   // −20 dBFS: somebody is there
  h.tick(2);
  h.feed('vad');
  assert.notEqual(h.session.state, 'SLEEPING');
});

// --- the logprob veto -------------------------------------------------------

test('a transcript the model was unsure of is a `huh`, not an instruction', async () => {
  // 「我以来」for 「倒回来」came back at −1.18 on a −25 dB segment: a good
  // input level and fluent nonsense. Level cannot catch this one.
  const h = harness({
    stt: { transcribeDetailed: async () => ({ text: '我以来', logprob: -1.18 }) },
  });
  const brain = fakeBrain(h.session, h.calls);
  h.session.attach(brain);
  h.session.start();
  h.wake();
  h.vad.segments.push(loud(16));
  h.feed('vad');
  await settle();
  assert.deepEqual(brain.seen, []);
  assert.ok(h.calls.some((c) => c[0] === 'earcon' && c[1] === 'huh'));
  assert.equal(h.session.state, 'LISTENING');
});

test('a confident transcript goes through', async () => {
  const h = harness({
    stt: { transcribeDetailed: async () => ({ text: '往前走', logprob: -0.35 }) },
  });
  const brain = fakeBrain(h.session, h.calls);
  h.session.attach(brain);
  h.session.start();
  h.wake();
  h.vad.segments.push(loud(16));
  h.feed('vad');
  await settle();
  assert.deepEqual(brain.seen, ['往前走']);
});

test('a null logprob is no opinion, not a low one', async () => {
  // Groq is OpenAI-compatible, not OpenAI. An endpoint that does not report
  // confidence must not thereby mute the car.
  const h = harness({
    stt: { transcribeDetailed: async () => ({ text: '往前走', logprob: null }) },
  });
  const brain = fakeBrain(h.session, h.calls);
  h.session.attach(brain);
  h.session.start();
  h.wake();
  h.vad.segments.push(loud(16));
  h.feed('vad');
  await settle();
  assert.deepEqual(brain.seen, ['往前走']);
});

test('the wake word is ignored while a sentence is being captured', async () => {
  // Answering it there plays an earcon, and an earcon unsubscribes the pipeline
  // for 80 ms — a hole in the middle of the command being recorded, bought for
  // nothing, since the session is already listening.
  const h = harness();
  h.session.attach(fakeBrain(h.session, h.calls));
  h.session.start();
  h.wake();
  h.vad.detected = true;
  h.feed('vad');                       // LISTENING -> CAPTURING
  assert.equal(h.session.state, 'CAPTURING');
  const before = h.calls.filter((c) => c[0] === 'earcon').length;
  h.kws.hits.push('hey_steven');
  h.feed('kws');
  assert.equal(h.calls.filter((c) => c[0] === 'earcon').length, before);
  assert.equal(h.session.state, 'CAPTURING', 'the capture was not interrupted');
});

test('the stop word is still answered while capturing — it is the brake', async () => {
  const h = harness();
  h.session.attach(fakeBrain(h.session, h.calls));
  h.session.start();
  h.wake();
  h.vad.detected = true;
  h.feed('vad');
  assert.equal(h.session.state, 'CAPTURING');
  h.kws.hits.push('all_stop');
  h.feed('kws');
  assert.equal(h.took('executor.stop'), 1);
  assert.equal(h.session.state, 'SLEEPING');
});
