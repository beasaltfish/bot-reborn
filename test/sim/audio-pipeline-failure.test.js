import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioPipeline } from '../../phone/audio/pipeline.js';

test('aborting while a worklet loads releases the microphone immediately and only once', async () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const oldContext = globalThis.AudioContext;
  let tracksStopped = 0, contextsClosed = 0;
  /** @type {()=>void} */ let resolveWorklet = () => {};
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() { tracksStopped++; } }] }) } } });
    globalThis.AudioContext = /** @type {any} */ (class {
      audioWorklet = { addModule: () => new Promise(resolve => { resolveWorklet = () => resolve(undefined); }) };
      close() { contextsClosed++; return Promise.resolve(); }
    });
    const abort = new AbortController();
    const pending = AudioPipeline.start({ signal: abort.signal });
    await new Promise(resolve => setTimeout(resolve, 0));
    abort.abort();
    assert.equal(tracksStopped, 1);
    assert.equal(contextsClosed, 1);
    resolveWorklet();
    await assert.rejects(pending, /abort/i);
    assert.equal(tracksStopped, 1);
    assert.equal(contextsClosed, 1);
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    else Reflect.deleteProperty(globalThis, 'navigator');
    globalThis.AudioContext = oldContext;
  }
});

test('a microphone granted after cancellation is stopped without opening a context', async () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const oldContext = globalThis.AudioContext;
  let tracksStopped = 0, contexts = 0;
  /** @type {(stream:any)=>void} */ let resolveMic = () => {};
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => new Promise(resolve => { resolveMic = resolve; }) } } });
    globalThis.AudioContext = /** @type {any} */ (class { constructor() { contexts++; } });
    const abort = new AbortController();
    const pending = AudioPipeline.start({ signal: abort.signal });
    abort.abort();
    resolveMic({ getTracks: () => [{ stop() { tracksStopped++; } }] });
    await assert.rejects(pending, /abort/i);
    assert.equal(tracksStopped, 1);
    assert.equal(contexts, 0);
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    else Reflect.deleteProperty(globalThis, 'navigator');
    globalThis.AudioContext = oldContext;
  }
});

test('failed worklet setup releases the microphone track and audio context', async () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const oldContext = globalThis.AudioContext;
  let tracksStopped = 0, contextsClosed = 0;
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() { tracksStopped++; } }] }) } } });
    globalThis.AudioContext = /** @type {any} */ (class {
      audioWorklet = { addModule: async () => { throw Error('worklet setup failed'); } };
      close() { contextsClosed++; return Promise.resolve(); }
    });
    await assert.rejects(AudioPipeline.start(), /worklet setup failed/);
    assert.equal(tracksStopped, 1);
    assert.equal(contextsClosed, 1);
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    else Reflect.deleteProperty(globalThis, 'navigator');
    globalThis.AudioContext = oldContext;
  }
});
