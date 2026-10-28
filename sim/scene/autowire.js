// "Wire it for me", played: the steps of a recipe laid onto the table one at
// a time. A board or part flies in from the parts-bin side and lands (with its
// click), a wire appears with a tick, and the last step slides the USB plug
// home, which powers the bench up through the usual plug-in path.
//
// The scene is only dressed here: every step is also applied to the bench with
// applyStep, so the saved bench and the drawn bench never disagree, and Skip,
// Stop or a reload at any moment leaves something real behind.

import { applyStep } from '../recipes.js';
import { click, tick } from './sounds.js';

/** @typedef {import('../recipes.js').Step} Step */
/** @typedef {ReturnType<typeof import('./world.js').createWorld>} World */

// Timing, in ms. The screen recipe has ~29 steps (7 boards and parts, ~21
// wires, USB) and should take 30–60 s in Watch mode: about 9 s of parts, 25 s
// of wires and 1 s of plug come to ~35 s; the audio recipe is shorter still.
// Wires are paced slowest because each one is a link the viewer should be
// able to follow with the eye.
const FLY_MS = 600;
const PART_PAUSE_MS = 700;
const WIRE_PAUSE_MS = 1200;
const USB_PAUSE_MS = 400;

/** Where a flying piece starts, past the table's left edge, and how high it is carried. */
const OFF_LEFT = 30;
const CARRY_Y = 14;

/** @param {number} t */
const easeOut = (t) => 1 - (1 - t) ** 3;

/**
 * @param {{
 *   steps: Step[],
 *   mode: 'watch' | 'step',
 *   getBench(): import('../bench.js').Bench,
 *   setBench(b: import('../bench.js').Bench): void,
 *   world: World,
 *   usb: { insert(): Promise<void> },
 *   hands: { enable(on: boolean): void },
 *   say(text: string): void,
 *   onDone(): void,
 * }} o
 * @returns {{ next(): void, finish(): void, skip(): void, stop(): void }}
 */
export function runRecipe(o) {
  let mode = o.mode;
  let skipping = false;
  let stopped = false;
  /** Everything waiting on a timer or a click, so a control can cut the wait short. */
  /** @type {Set<() => void>} */
  const waiting = new Set();

  /** @param {number} ms */
  const pause = (ms) => new Promise((resolve) => {
    const done = () => { clearTimeout(timer); waiting.delete(done); resolve(undefined); };
    const timer = setTimeout(done, ms);
    waiting.add(done);
  });
  /** Held until a control is used (the step-by-step mode's wait for Next). */
  const gate = () => new Promise((resolve) => {
    const done = () => { waiting.delete(done); resolve(undefined); };
    waiting.add(done);
  });
  const wake = () => { for (const w of [...waiting]) w(); };

  /**
   * Seat the step on the bench, then fly its new group from off the left edge
   * to where the bench put it. The group exists only after setBench, and the
   * frame that draws it comes after this returns, so it never shows at rest first.
   * @param {Step & { kind: 'board' | 'part' }} s
   */
  function fly(s) {
    o.setBench(applyStep(o.getBench(), s));
    const group = o.world.scene.getObjectByName(`${s.kind}:${s.id}`);
    if (!group) return Promise.resolve();
    const to = group.position.clone();
    const from = to.clone();
    from.x = o.world.tableBounds.x0 - OFF_LEFT;
    from.y = to.y + CARRY_Y;
    group.position.copy(from);
    return new Promise((resolve) => {
      /** @type {number | null} */
      let start = null;
      const off = o.world.onFrame((now) => {
        start ??= now;
        const t = skipping ? 1 : Math.min(1, (now - start) / FLY_MS);
        group.position.lerpVectors(from, to, easeOut(t));
        if (t < 1) return true;
        off();
        // The click is pins going into a board; a loose part just lands.
        if (s.kind === 'board' || s.seated) click();
        resolve(undefined);
        return false;
      });
      o.world.requestRender();
    });
  }

  /** @param {Step} s */
  async function play(s) {
    switch (s.kind) {
      case 'board':
      case 'part':
        await fly(s);
        break;
      case 'wire':
        o.setBench(applyStep(o.getBench(), s));
        tick();
        break;
      case 'usb':
        await o.usb.insert();
        break;
    }
  }

  /** @param {Step} s */
  const pauseFor = (s) => (s.kind === 'wire' ? WIRE_PAUSE_MS : s.kind === 'usb' ? USB_PAUSE_MS : PART_PAUSE_MS);

  async function run() {
    o.hands.enable(false);
    try {
      for (const s of o.steps) {
        if (stopped) break;
        // Skipping lays everything down at once but leaves the plug to be pushed in.
        if (skipping && s.kind !== 'usb') {
          o.setBench(applyStep(o.getBench(), s));
          continue;
        }
        o.say(s.say);
        // Step by step: the line says what comes next, and Next does it.
        if (mode === 'step' && !skipping) await gate();
        if (stopped) break;
        await play(s);
        if (mode === 'watch' && !skipping && !stopped) await pause(pauseFor(s));
      }
    } finally {
      o.hands.enable(true);
      o.onDone();
    }
  }
  run();

  return {
    next() { wake(); },
    finish() { mode = 'watch'; wake(); },
    skip() { skipping = true; wake(); },
    stop() { stopped = true; wake(); },
  };
}
