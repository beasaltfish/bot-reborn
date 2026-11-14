import test from 'node:test';
import assert from 'node:assert/strict';
import { startBody } from '../../sim/body.js';
import { powerOn } from '../../sim/power.js';
import { emptyBench } from '../../sim/bench.js';
import { AudioPipeline } from '../../phone/audio/pipeline.js';

test('a cancelled character fetch cannot start the microphone or report an end', async () => {
  const oldFetch = globalThis.fetch;
  const oldStart = AudioPipeline.start;
  try {
    let live = true, pipelineStarts = 0, ends = 0;
    /** @type {(value:any)=>void} */ let resolveFetch = () => {};
    globalThis.fetch = /** @type {any} */ (() => new Promise(resolve => { resolveFetch = resolve; }));
    AudioPipeline.start = /** @type {any} */ (async () => { pipelineStarts++; throw Error('must not start'); });
    const starting = startBody({ id: 'test', outcome: powerOn(emptyBench()), isCurrent: () => live, onState() {}, onLevel() {}, onEnd() { ends++; } });
    live = false;
    resolveFetch({ ok: true, json: async () => ({ token: 'token', config: { bargeIn: false } }) });
    const body = await starting;
    assert.equal(pipelineStarts, 0);
    assert.equal(ends, 0);
    body.stop();
  } finally { globalThis.fetch = oldFetch; AudioPipeline.start = oldStart; }
});

test('aborting a pending character fetch ends startup without reporting an error', async () => {
  const oldFetch = globalThis.fetch;
  try {
    let ends = 0, receivedAbort = false;
    const abort = new AbortController();
    globalThis.fetch = /** @type {any} */ ((/** @type {string} */ _url, /** @type {{signal: AbortSignal}} */ options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => { receivedAbort = true; reject(new DOMException('Aborted', 'AbortError')); });
    }));
    const starting = startBody({ id: 'test', outcome: powerOn(emptyBench()), signal: abort.signal, onState() {}, onLevel() {}, onEnd() { ends++; } });
    abort.abort();
    const body = await starting;
    assert.equal(receivedAbort, true);
    assert.equal(ends, 0);
    body.stop();
  } finally { globalThis.fetch = oldFetch; }
});

test('a cancelled microphone start cannot open a body websocket', async () => {
  const oldFetch = globalThis.fetch, oldStart = AudioPipeline.start, oldSocket = globalThis.WebSocket, oldLocation = globalThis.location;
  try {
    let live = true, sockets = 0, unsubscribed = 0, stopped = 0;
    /** @type {AbortSignal | undefined} */ let receivedSignal;
    const abort = new AbortController();
    /** @type {(value:any)=>void} */ let resolvePipeline = () => {};
    globalThis.fetch = /** @type {any} */ (async () => ({ ok: true, json: async () => ({ token: 'token', config: { bargeIn: false } }) }));
    AudioPipeline.start = /** @type {any} */ ((/** @type {{signal?:AbortSignal}} */ opts) => { receivedSignal = opts.signal; return new Promise(resolve => { resolvePipeline = resolve; }); });
    globalThis.WebSocket = /** @type {any} */ (class { constructor() { sockets++; } });
    globalThis.location = /** @type {Location} */ (/** @type {unknown} */ ({ protocol: 'http:', host: 'localhost' }));
    const starting = startBody({ id: 'test', outcome: powerOn(emptyBench()), signal: abort.signal, isCurrent: () => live, onState() {}, onLevel() {}, onEnd() {} });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(receivedSignal, abort.signal);
    live = false; abort.abort();
    resolvePipeline({ audioContext: {}, subscribe() {}, unsubscribe() { unsubscribed++; }, stop() { stopped++; } });
    const body = await starting;
    assert.equal(sockets, 0);
    assert.equal(unsubscribed, 0);
    assert.equal(stopped, 1);
    body.stop();
  } finally { globalThis.fetch = oldFetch; AudioPipeline.start = oldStart; globalThis.WebSocket = oldSocket; globalThis.location = oldLocation; }
});
