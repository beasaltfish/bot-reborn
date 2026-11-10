import test from 'node:test';
import assert from 'node:assert/strict';

import { TIMING, speedFactor, pauseFor, runRecipe } from '../../sim/scene/autowire.js';
import { emptyBench } from '../../sim/bench.js';
import { recipeSteps, startBench, applyStep } from '../../sim/recipes.js';

test('a wire holds longer than a part, which holds longer than the plug', () => {
  assert.ok(TIMING.wire > TIMING.part);
  assert.ok(TIMING.part > TIMING.usb);
});

test('every step kind has a pause, and 2× halves it', () => {
  for (const kind of ['wire', 'usb', 'board', 'part']) {
    const once = pauseFor({ kind }, 1);
    assert.ok(once > 0, kind);
    assert.equal(pauseFor({ kind }, 2), once / 2, kind);
  }
});

test('a speed the page cannot use means 1×, never zero', () => {
  for (const bad of [0, -1, NaN, Infinity, undefined, null, /** @type {any} */ ('2')]) {
    assert.equal(speedFactor(bad), 1, String(bad));
    assert.equal(pauseFor({ kind: 'wire' }, bad), TIMING.wire, String(bad));
  }
});

test('the default speed is 1×', () => {
  assert.equal(pauseFor({ kind: 'wire' }), TIMING.wire);
});

/** A run of two plug steps (no bench, no scene): the shortest way to watch the pacing itself. */
/** @param {number} speed */
function timeRun(speed) {
  return new Promise((resolve) => {
    const started = performance.now();
    runRecipe(/** @type {any} */ ({
      steps: /** @type {any} */ ([{ kind: 'usb' }, { kind: 'usb' }]),
      mode: 'watch',
      speed,
      getBench: () => ({}),
      setBench: () => {},
      world: {},
      usb: { insert: async () => {} },
      hands: { enable: () => {} },
      say: () => {},
      onDone: () => resolve(performance.now() - started),
    }));
  });
}

test('runRecipe halves the wait between steps at 2×', async () => {
  const once = await timeRun(1);
  const twice = await timeRun(2);
  assert.ok(once >= TIMING.usb * 2, `1× ran in ${once}ms, expected at least ${TIMING.usb * 2}`);
  assert.ok(twice < once * 0.7, `2× ran in ${twice}ms against 1×'s ${once}ms`);
});

/** The least world fly() will accept: one piece, and a frame loop driven at a fixed 16ms. */
function flyWorld() {
  const position = {
    x: 0, y: 0, z: 0,
    clone() { return { ...position, clone: position.clone, lerpVectors: position.lerpVectors }; },
    copy(/** @type {any} */ p) { position.x = p.x; position.y = p.y; position.z = p.z; return position; },
    lerpVectors(/** @type {any} */ a, /** @type {any} */ b, /** @type {number} */ t) {
      position.x = a.x + (b.x - a.x) * t;
      position.y = a.y + (b.y - a.y) * t;
      return position;
    },
  };
  const group = { position };
  let asked = 0;
  const world = /** @type {any} */ ({
    tableBounds: { x0: 0, x1: 100 },
    scene: { getObjectByName: () => (asked++ === 0 ? undefined : group) },
    requestRender: () => {},
    // Deferred like the real one: fly() calls the off() it is handed, so the callback
    // must never run before onFrame() has returned.
    /** @param {(now: number) => boolean | void} cb */
    onFrame(cb) {
      let cancelled = false;
      queueMicrotask(() => {
        if (cancelled) return;
        for (let now = 0; cb(now) === true; now += 16) { /* run the flight out */ }
      });
      return () => { cancelled = true; };
    },
  });
  return world;
}

/**
 * How many simulated milliseconds the piece is in the air, at `speed`.
 * @param {number} speed
 */
async function airTime(speed) {
  // The bench the recipe leaves just before its first part lands: a part needs a board to sit on.
  const all = recipeSteps('audio');
  const at = all.findIndex((s) => s.kind === 'part');
  const step = all[at];
  const before = all.slice(0, at).reduce(applyStep, startBench(emptyBench()));
  let flight = 0;
  let first = null;
  let last = 0;
  const world = flyWorld();
  const real = world.onFrame;
  world.onFrame = (/** @type {any} */ cb) => real((/** @type {number} */ now) => {
    first ??= now;
    last = now;
    return cb(now);
  });
  const ended = new Promise((resolve) => {
    const run = runRecipe(/** @type {any} */ ({
      steps: [step],
      mode: 'step',
      speed,
      getBench: () => before,
      setBench: () => {},
      world,
      usb: { insert: async () => {} },
      hands: { enable: () => {} },
      say: () => {},
      onDone: resolve,
    }));
    // Step by step, so the only time this takes is the flight itself.
    run.next();
  });
  await ended;
  flight = last - (first ?? 0);
  return flight;
}

test('a part flies in faster at 2×, not just the pauses after it', async () => {
  const once = await airTime(1);
  const twice = await airTime(2);
  assert.ok(once >= TIMING.fly - 16, `1× flight was ${once}ms, expected about ${TIMING.fly}`);
  assert.ok(twice <= once / 1.8, `2× flight was ${twice}ms against 1×'s ${once}ms`);
});

test('the run bar can change the pace while the bench is being built', async () => {
  // Four plug steps at 1× would take 4 × TIMING.usb. Flipped to 2× after the
  // first pause, the rest run at half, and the pause it lands in is cut short.
  const elapsed = await new Promise((resolve) => {
    const started = performance.now();
    const run = runRecipe(/** @type {any} */ ({
      steps: /** @type {any} */ ([{ kind: 'usb' }, { kind: 'usb' }, { kind: 'usb' }, { kind: 'usb' }]),
      mode: 'watch',
      speed: 1,
      getBench: () => ({}),
      setBench: () => {},
      world: {},
      usb: { insert: async () => {} },
      hands: { enable: () => {} },
      say: () => {},
      onDone: () => resolve(performance.now() - started),
    }));
    setTimeout(() => run.speed(2), TIMING.usb * 1.2);
  });
  assert.ok(elapsed < TIMING.usb * 3.4, `ran in ${elapsed}ms, expected under ${TIMING.usb * 3.4}`);
  assert.ok(elapsed > TIMING.usb, `ran in ${elapsed}ms, too fast to be real`);
});
