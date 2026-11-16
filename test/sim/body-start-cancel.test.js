import test from 'node:test';
import assert from 'node:assert/strict';
import { startBody } from '../../sim/body.js';
import { powerOn } from '../../sim/power.js';
import { emptyBench } from '../../sim/bench.js';
import { AudioPipeline } from '../../phone/audio/pipeline.js';

test('a cancelled start cannot open a body websocket or report an end', async () => {
  const oldStart = AudioPipeline.start, oldSocket = globalThis.WebSocket, oldLocation = globalThis.location;
  try {
    let live = true, sockets = 0, ends = 0;
    /** @type {(value:any)=>void} */ let resolvePipeline = () => {};
    AudioPipeline.start = /** @type {any} */ (() => new Promise((resolve) => { resolvePipeline = resolve; }));
    globalThis.WebSocket = /** @type {any} */ (class { constructor() { sockets += 1; } send() {} close() {} });
    globalThis.location = /** @type {Location} */ (/** @type {unknown} */ ({ protocol: 'http:', host: 'localhost' }));
    const starting = startBody({
      token: 'a'.repeat(32), outcome: powerOn(emptyBench()), audioContext: /** @type {any} */ ({}),
      isCurrent: () => live,
      onState() {}, onLevel() {}, onEnd() { ends += 1; },
    });
    live = false;
    resolvePipeline({ audioContext: {}, subscribe() {}, unsubscribe() {}, stop() {} });
    const body = await starting;
    assert.equal(sockets, 0);
    assert.equal(ends, 0);
    body.stop();
  } finally { AudioPipeline.start = oldStart; globalThis.WebSocket = oldSocket; globalThis.location = oldLocation; }
});
