import test from 'node:test';
import assert from 'node:assert/strict';
import { WebAudioTts } from '../web/providers/tts-webaudio.js';

const CFG = {
  baseURL: 'https://api.example.com/v1', apiKey: 'sk-test',
  model: 'tts-1', voice: 'alloy',
};

/**
 * A promise the test settles by hand, so it can hold speak() inside the
 * fetch/decode window — the window cancel() used to be a no-op in.
 * @template T
 * @returns {{ promise: Promise<T>, resolve: (value: T) => void }}
 */
function deferred() {
  /** @type {(value: any) => void} */
  let resolve = () => {};
  /** @type {Promise<any>} */
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

/**
 * The smallest WebAudio that WebAudioTts actually touches. `started` records
 * every BufferSource that reached .start() — i.e. every reply that was audible.
 */
function fakeAudio() {
  /** @type {any[]} */ const started = [];
  /** @type {any[]} */ const stopped = [];
  const gain = {
    connect() {},
    gain: {
      value: 1,
      setValueAtTime() {}, cancelScheduledValues() {}, linearRampToValueAtTime() {},
    },
  };
  /** @type {any} */
  const ctx = {
    state: 'running',
    currentTime: 0,
    destination: {},
    createGain: () => gain,
    createAnalyser: () => ({ connect() {} }),
    createBufferSource() {
      /** @type {any} */
      const source = {
        buffer: null, onended: null,
        connect() {},
        start() { started.push(source); },
        /** @param {number} when */
        stop(when) { stopped.push(when); },
      };
      return source;
    },
    /** @param {any} _bytes */
    async decodeAudioData(_bytes) { return { duration: 1 }; },
    async resume() { ctx.state = 'running'; },
  };
  return { ctx, started, stopped };
}

/** @param {any} body */
const okResponse = (body = new ArrayBuffer(8)) => ({
  ok: true, status: 200, statusText: 'OK', async arrayBuffer() { return body; },
});

test('speak(): plays the decoded buffer and resolves when it ends', async () => {
  const audio = fakeAudio();
  const tts = new WebAudioTts(CFG, {
    audioContext: audio.ctx,
    fetch: /** @type {any} */ (async () => okResponse()),
  });

  // Non-ASCII on purpose: the text travels through a JSON body, and this is
  // the only place that path is exercised at all.
  const playing = tts.speak('你好');
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(audio.started.length, 1);
  audio.started[0].onended();
  await playing;
});

test('cancel(): silences a reply that is still being fetched (spec §7.1)', async () => {
  // §7.1: the fetch/decode window is 1–2 s of silence for a long reply. cancel()
  // returned early when #source was null, so a caller cancelling in that window
  // got the audio anyway, a beat later, with no way to stop it.
  const audio = fakeAudio();
  const gate = /** @type {{ promise: Promise<any>, resolve: (v: any) => void }} */ (deferred());
  const tts = new WebAudioTts(CFG, {
    audioContext: audio.ctx,
    fetch: /** @type {any} */ (() => gate.promise),
  });

  const speaking = tts.speak('a long reply');
  await Promise.resolve();
  tts.cancel();                     // nothing is playing yet — and never should
  gate.resolve(okResponse());
  await speaking;

  assert.deepEqual(audio.started, [], 'a cancelled reply must never reach start()');
});

test('cancel(): silences a reply that is still being decoded', async () => {
  const audio = fakeAudio();
  const gate = /** @type {{ promise: Promise<any>, resolve: (v: any) => void }} */ (deferred());
  audio.ctx.decodeAudioData = () => gate.promise;
  const tts = new WebAudioTts(CFG, {
    audioContext: audio.ctx,
    fetch: /** @type {any} */ (async () => okResponse()),
  });

  const speaking = tts.speak('a long reply');
  for (let i = 0; i < 4; i++) await Promise.resolve();
  tts.cancel();
  gate.resolve({ duration: 1 });
  await speaking;

  assert.deepEqual(audio.started, []);
});

test('speak(): a second call supersedes one still in flight, instead of overlapping', async () => {
  const audio = fakeAudio();
  /** @type {Array<{ promise: Promise<any>, resolve: (v: any) => void }>} */
  const gates = [];
  const tts = new WebAudioTts(CFG, {
    audioContext: audio.ctx,
    fetch: /** @type {any} */ (() => {
      const gate = /** @type {any} */ (deferred());
      gates.push(gate);
      return gate.promise;
    }),
  });

  const first = tts.speak('the first sentence');
  await Promise.resolve();
  const second = tts.speak('the second sentence');
  await Promise.resolve();
  assert.equal(gates.length, 2);

  // Let them land in the worst order: the superseded one last.
  gates[1].resolve(okResponse());
  for (let i = 0; i < 6; i++) await Promise.resolve();
  gates[0].resolve(okResponse());
  await first;

  assert.equal(audio.started.length, 1, 'only the later reply may be audible');
  audio.started[0].onended();
  await second;
});

test('cancel(): a playing source still fades out rather than stopping hard', async () => {
  const audio = fakeAudio();
  const tts = new WebAudioTts(CFG, {
    audioContext: audio.ctx,
    fetch: /** @type {any} */ (async () => okResponse()),
  });

  const speaking = tts.speak('你好');
  for (let i = 0; i < 4; i++) await Promise.resolve();
  assert.equal(audio.started.length, 1);

  tts.cancel();
  await speaking;                      // cancel() resolves the pending speak()
  assert.deepEqual(audio.stopped, [0.01], 'stop() is scheduled FADE_MS out, not now');
});

test('the loopback path is refused rather than half-implemented (spec §7.2)', () => {
  const audio = fakeAudio();
  assert.throws(
    () => new WebAudioTts(CFG, { audioContext: audio.ctx, loopback: true }),
    /loopback/);
});

test('speak(): a hung request aborts at timeoutMs', async () => {
  // Spec §6.7: the same 15 s net as STT and LLM. A TTS that never returns
  // freezes the turn in SPEAKING with nothing to recover it.
  const { ctx } = fakeAudio();
  /** @param {any} url @param {any} init */
  const fetchImpl = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  const tts = new WebAudioTts(CFG, { audioContext: ctx, fetch: fetchImpl, timeoutMs: 20 });

  await assert.rejects(() => tts.speak('hi'), (/** @type {any} */ err) => err.name === 'AbortError');
});

test("speak(): the caller's signal ends the reply quietly, like cancel()", async () => {
  // A deliberate cancellation is not a failure. cancel() already resolves
  // rather than throwing, and brain.js turns a rejection into an `error`
  // earcon — which would mean the user pressing stop gets told something
  // broke. The timeout above still throws, because that one IS a failure.
  const { ctx, started } = fakeAudio();
  /** @param {any} url @param {any} init */
  const fetchImpl = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  const tts = new WebAudioTts(CFG, { audioContext: ctx, fetch: fetchImpl, timeoutMs: 60_000 });
  const controller = new AbortController();

  const speaking = tts.speak('hi', { signal: controller.signal });
  controller.abort();

  const outcome = await Promise.race([
    speaking.then(() => 'resolved', (/** @type {any} */ err) => err.name),
    new Promise((r) => setTimeout(() => r('still pending'), 50)),
  ]);
  assert.equal(outcome, 'resolved');
  assert.deepEqual(started, [], 'nothing should have reached the speakers');
});
