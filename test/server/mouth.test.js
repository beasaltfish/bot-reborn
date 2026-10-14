import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mouth } from '../../server/body/mouth.js';
import { FakeClock } from './fake-clock.js';

function rig(slackMs = 0) {
  const clock = new FakeClock();
  /** @type {number[]} */ const chunks = [];
  /** @type {any[]} */ const msgs = [];
  const mouth = new Mouth({
    sendAudio: (b) => chunks.push(b.length / 2), send: (m) => msgs.push(m),
    now: clock.now, after: clock.after, slackMs,
  });
  return { clock, chunks, msgs, mouth };
}

test('a clip goes out 300 ms ahead of real time, 100 ms per frame', async () => {
  const { clock, chunks, mouth } = rig();
  mouth.play(new Int16Array(16000));           // 1 s
  assert.deepEqual(chunks, [1600, 1600, 1600]);
  await clock.advance(100);
  assert.equal(chunks.length, 4);
  await clock.advance(1000);
  assert.equal(chunks.length, 10);
});

test('play reports when the clip will end, plus the echo slack', () => {
  const { mouth } = rig(300);
  assert.equal(mouth.play(new Int16Array(1600)).ms, 400);
});

test('a second clip queues behind the first', async () => {
  const { clock, mouth } = rig();
  mouth.play(new Int16Array(8000));             // 500 ms
  const second = mouth.play(new Int16Array(1600));
  assert.equal(second.ms, 600);
  let started = false;
  void second.started.then(() => { started = true; });
  await clock.advance(499);
  assert.equal(started, false);
  await clock.advance(1);
  assert.equal(started, true);
});

test('hush drops everything queued, settles every waiter, and tells the body', async () => {
  const { clock, chunks, msgs, mouth } = rig();
  const clip = mouth.play(new Int16Array(32000));
  let done = false;
  void clip.done.then(() => { done = true; });
  mouth.hush();
  await clock.advance(0);
  assert.equal(done, true);
  assert.deepEqual(msgs, [{ type: 'hush' }]);
  const sentBefore = chunks.length;
  await clock.advance(3000);
  assert.equal(chunks.length, sentBefore);
  assert.equal(mouth.play(new Int16Array(1600)).ms, 100);
});
