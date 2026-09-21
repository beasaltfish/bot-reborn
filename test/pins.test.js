import test from 'node:test';
import assert from 'node:assert/strict';

import { traceTheRun, readRun, pinTrace } from '../web/panels/pins.js';

// ② used to be timed by a person with a stopwatch on a 2.5 s run, which is
// ±200 ms of hand. The chip can do it itself: readPins() reports what the last
// clocked-out byte left on the pins, so the run is the gap between the first
// high read and the first low one after it.

/**
 * A chip that answers `pattern` one read at a time: '_' low, '#' high. The
 * write resolves only at the end, the way the real one does at this baud rate —
 * the transfer drains no faster than the chip plays it out.
 *
 * @param {string} pattern
 */
function fakeChip(pattern) {
  let at = 0;
  /** @type {{ wroteBeforeFirstRead: boolean | null, reads: number }} */
  const seen = { wroteBeforeFirstRead: null, reads: 0 };
  let written = false;
  const dev = {
    /** @param {Uint8Array} _stream */
    write(_stream) {
      written = true;
      return new Promise((resolve) => setTimeout(() => resolve(_stream.length), 5));
    },
    readPins() {
      if (seen.wroteBeforeFirstRead === null) seen.wroteBeforeFirstRead = written;
      seen.reads += 1;
      const ch = pattern[Math.min(at++, pattern.length - 1)];
      return Promise.resolve(ch === '#' ? 0x10 : 0x00);
    },
  };
  return { dev: /** @type {any} */ (dev), seen };
}

const stream = new Uint8Array(4);

test('the run is the gap between the first high read and the last', async () => {
  const { dev } = fakeChip('_####_');
  const run = readRun((await traceTheRun(dev, stream, { pollMs: 10, timeoutMs: 2000, settleReads: 1 })).reads);
  assert.ok(run, 'no high read was seen at all');
  assert.ok(run.seconds > 0.015 && run.seconds < 0.12,
    `three 10 ms intervals should read as roughly 0.03 s, got ${run.seconds}`);
  assert.equal(run.dips, 0);
});

test('one low read mid-run does not end the measurement', async () => {
  // The failure this exists for: the first rule stopped at the first low read,
  // so a single glitch reported a run five times shorter than the real one —
  // and a short reading is indistinguishable from a fast chip.
  const { dev } = fakeChip('_###_#####_');
  const run = readRun((await traceTheRun(dev, stream, { pollMs: 5, timeoutMs: 2000, settleReads: 3 })).reads);
  assert.ok(run);
  assert.equal(run.dips, 1, 'the dip was not counted');
  assert.ok(run.seconds > run.toFirstDip,
    'the run stopped at the dip instead of spanning it');
});

test('the trace is what the log shows, run-length encoded', () => {
  assert.equal(
    pinTrace([[0, 0x00], [10, 0x10], [20, 0x10], [30, 0x00]]),
    '_ #×2 _',
  );
});

test('what the host says it wrote comes back with the trace', async () => {
  // One length cannot tell a fast chip from a truncated write; the byte count
  // is the other half of that question, and it was being thrown away.
  const { dev } = fakeChip('_##_');
  const { wrote } = await traceTheRun(dev, stream, { pollMs: 1, timeoutMs: 2000, settleReads: 1 });
  assert.equal(wrote, stream.length);
});

test('the write is started before the first read, not awaited before it', async () => {
  // The whole measurement depends on this. At 1200 baud the transfer only
  // drains as fast as the chip plays it out, so awaiting the write first would
  // start the clock after the run it is timing had already finished.
  const { dev, seen } = fakeChip('_##_');
  await traceTheRun(dev, stream, { pollMs: 1, timeoutMs: 2000, settleReads: 1 });
  assert.equal(seen.wroteBeforeFirstRead, true);
});

test('pins that never come up are an absent reading, not a zero one', async () => {
  // A part that refuses the read-back looks exactly like this, and a ratio
  // computed from it would be a number nobody measured.
  const { dev } = fakeChip('_');
  assert.equal(readRun((await traceTheRun(dev, stream, { pollMs: 1, timeoutMs: 60 })).reads), null);
});

test('a failed write surfaces as itself, not as a timeout', async () => {
  const dev = /** @type {any} */ ({
    write: () => Promise.reject(new Error('transferOut: NetworkError')),
    readPins: () => Promise.resolve(0x00),
  });
  await assert.rejects(
    () => traceTheRun(dev, stream, { pollMs: 1, timeoutMs: 5000 }),
    /transferOut: NetworkError/,
  );
});

// ⑧: the tally, and what it is allowed to conclude from it.

/** @param {Array<[number, number, number]>} rows [ms, tries, hits] */
const tally = (rows) => new Map(rows.map(([ms, tries, hits]) => [ms, { tries, hits }]));

test('the threshold is the shortest length that moved it every single time', async () => {
  const { summariseTrials } = await import('../web/panels/pins.js');
  const { threshold } = summariseTrials(tally([[100, 3, 0], [200, 3, 3], [300, 3, 3]]), 3);
  assert.equal(threshold, 200);
});

test('nine out of ten is not an answer', async () => {
  // Near the threshold the outcome is a probability, and the length that works
  // nine times in ten is exactly the one a shorter procedure would accept.
  const { summariseTrials } = await import('../web/panels/pins.js');
  const { threshold } = summariseTrials(tally([[200, 10, 9], [300, 10, 10]]), 10);
  assert.equal(threshold, 300);
});

test('a shorter length nobody finished testing is named, not ruled out', async () => {
  // Reporting 300 while 150 has had two tries would turn "nobody tested 150"
  // into "150 does not work" — and the product would carry a floor twice as
  // high as it needs.
  const { summariseTrials } = await import('../web/panels/pins.js');
  const { threshold, unfinished } = summariseTrials(tally([[150, 2, 2], [300, 10, 10]]), 10);
  assert.equal(threshold, 300);
  assert.deepEqual(unfinished.map((r) => r.ms), [150]);
});

test('an untried length above the answer is not a caveat on it', async () => {
  const { summariseTrials } = await import('../web/panels/pins.js');
  const { unfinished } = summariseTrials(tally([[300, 10, 10], [600, 1, 1]]), 10);
  assert.deepEqual(unfinished, []);
});
