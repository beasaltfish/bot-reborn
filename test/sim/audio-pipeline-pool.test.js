import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipelinePool } from '../../sim/audio-pipeline-pool.js';

/** @returns {{promise:Promise<any>, resolve:(value:any)=>void}} */
function deferred() {
  /** @type {(value:any)=>void} */ let resolve = () => {};
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

test('a pipeline finishing after cancellation is stopped and not retained', async () => {
  const pending = deferred(); let stops = 0, starts = 0, live = true;
  const pool = createPipelinePool(async () => { starts++; return pending.promise; });
  const waiting = pool.acquire(false, () => live);
  live = false;
  pending.resolve({ stop() { stops++; } });
  assert.equal(await waiting, null);
  assert.equal(stops, 1);
  const next = pool.acquire(false, () => true);
  assert.equal(starts, 2, 'a later session must not reuse the stopped pipeline');
  const lease = await next; assert.ok(lease); lease.cancel();
  assert.equal(stops, 2);
});

test('a stale pending pipeline cannot replace or stop a newer live pipeline', async () => {
  const old = deferred(), newer = deferred(); let oldStops = 0, newStops = 0, calls = 0, oldLive = true;
  const pool = createPipelinePool(() => (++calls === 1 ? old.promise : newer.promise));
  const first = pool.acquire(false, () => oldLive);
  oldLive = false;
  const second = pool.acquire(false, () => true);
  const newPipeline = { stop() { newStops++; } };
  newer.resolve(newPipeline);
  const newLease = await second; assert.ok(newLease); newLease.commit();
  old.resolve({ stop() { oldStops++; } });
  assert.equal(await first, null);
  assert.equal(oldStops, 1); assert.equal(newStops, 0);
  const reused = await pool.acquire(false, () => true);
  assert.ok(reused); assert.equal(reused.pipeline, newPipeline); reused.commit();
  assert.equal(calls, 2);
});

test('a pending lease is not stopped while a newer session has reserved it', async () => {
  let stops = 0;
  const pipeline = { stop() { stops++; } };
  const pool = createPipelinePool(async () => pipeline);
  const old = await pool.acquire(false, () => true); assert.ok(old);
  const newer = await pool.acquire(false, () => true); assert.ok(newer);
  old.cancel(); assert.equal(stops, 0);
  newer.commit(); assert.equal(stops, 0);
  const reused = await pool.acquire(false, () => true); assert.ok(reused); reused.cancel();
  assert.equal(stops, 0, 'a successfully used shared microphone stays held');
});
