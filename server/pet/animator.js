// What the screen is showing, one frame at a time (pet screen spec §4.4,
// postures spec).
//
// The dog is always in one of three postures — lying, sitting, standing — and
// is shown as a sequence of animations ending in a loop: a rest in its posture.
// A command moves it to a posture and it stays; nobody talking for RELAX_MS
// lets it lie down again. Tricks are done from the posture they belong to
// (shake sitting, spin standing); asked from another, the dog first moves to
// the right one, and stays in it afterwards.
//
// Pure logic, no sockets and no timers of its own: `show` is whatever puts a
// JPEG on the wire and `after` is whatever schedules the next frame, so the
// whole thing runs under a fake clock in tests.

/** @typedef {import('./frames.js').PetAnim} PetAnim */
/** @typedef {import('./frames.js').FramePick} FramePick */
/** @typedef {'lie' | 'sit' | 'stand'} Posture */

/** Nobody talking for this long: a sitting or standing dog lies down. */
export const RELAX_MS = 10000;

export class Animator {
  /** @type {import('./frames.js').PetFrames} */ #frames;
  /** @type {(pick: FramePick) => void} */ #show;
  /** @type {(ms: number, fn: () => void) => () => void} */ #after;
  /** @type {(line: string) => void} */ #log;
  /** @type {(() => void) | null} */ #cancel = null;
  /** @type {(() => void) | null} */ #cancelRelax = null;
  /** @type {PetAnim | null} */ #anim = null;
  /** Animations still to play after the current one; the last is a rest loop. @type {string[]} */
  #queue = [];
  /** The posture the running sequence ends in. @type {Posture} */
  #posture = 'lie';
  #index = 0;
  #running = false;

  /**
   * @param {{
   *   frames: import('./frames.js').PetFrames,
   *   show: (pick: FramePick) => void,
   *   after?: (ms: number, fn: () => void) => () => void,
   *   log?: (line: string) => void,
   * }} deps
   */
  constructor({ frames, show, after, log = () => {} }) {
    this.#frames = frames;
    this.#show = show;
    this.#after = after ?? ((ms, fn) => {
      const timer = setTimeout(fn, ms);
      return () => clearTimeout(timer);
    });
    this.#log = log;
  }

  /** Begin: lying down, breathing. Called when a body connects. */
  start() {
    this.stop();
    this.#running = true;
    this.#posture = 'lie';
    if (!this.#frames.has('rest-lie')) {
      this.#log('pet: no rest-lie animation — nothing to show');
      return;
    }
    this.#play(['rest-lie']);
  }

  /**
   * Do what a pose asks, now, whatever was playing: move to a posture, or do a
   * trick from the posture it belongs to. A name nobody knows is ignored with
   * one line: the animation died without the robot dying with it.
   * @param {string} name
   */
  pose(name) {
    if (!this.#running) return;
    const plan = this.#plan(name);
    if (plan === null) {
      this.#log(`pet: no animation for "${name}" — the pose is ignored`);
      return;
    }
    if (plan.length === 0) {
      // Already there. Only the relax timer starts over, if the dog is resting.
      if (this.#anim?.loop) this.#armRelax();
      return;
    }
    this.#play(plan);
  }

  /** The body is gone. The screen keeps its last frame; we just stop feeding it. */
  stop() {
    this.#running = false;
    this.#cancel?.();
    this.#cancel = null;
    this.#cancelRelax?.();
    this.#cancelRelax = null;
    this.#anim = null;
    this.#queue = [];
    this.#index = 0;
    this.#posture = 'lie';
  }

  /**
   * The animations a pose needs, in order, from the dog's end posture; moves
   * #posture to where the plan ends. [] when nothing needs to happen, null for
   * a pose with no meaning.
   * @param {string} name @returns {string[] | null}
   */
  #plan(name) {
    /** @type {Posture} */ let target;
    /** @type {string[]} */ let middle = [];
    if (name === 'sit' || name === 'stand' || name === 'lie') {
      target = name;
      if (target === this.#posture) return [];
    } else if (name === 'shake') {
      target = 'sit';
      middle = ['shake'];
    } else if (name === 'spin') {
      target = 'stand';
      middle = ['spin'];
    } else {
      return null;
    }
    const from = this.#posture;
    const steps = [...(from === target ? [] : [`${from}-${target}`]), ...middle, `rest-${target}`];
    this.#posture = target;
    return this.#playable(steps);
  }

  /**
   * Drop what has no frames, saying so once each; the dog carries on with
   * what is left (a missing transition is a cut to the next animation).
   * @param {string[]} steps
   */
  #playable(steps) {
    return steps.filter((s) => {
      if (this.#frames.has(s)) return true;
      this.#log(`pet: no animation called "${s}" — skipped`);
      return false;
    });
  }

  /** Start a sequence at once, interrupting what is playing. @param {string[]} steps */
  #play(steps) {
    this.#cancel?.();
    this.#cancel = null;
    this.#cancelRelax?.();
    this.#cancelRelax = null;
    this.#queue = steps.slice(1);
    this.#begin(steps[0]);
  }

  /** @param {string} name */
  #begin(name) {
    this.#anim = this.#frames.get(name) ?? null;
    this.#index = 0;
    if (!this.#anim) return;
    this.#emit(0);
    this.#schedule();
    // A sequence has reached its rest: from here, nobody talking for RELAX_MS
    // lets the dog lie down. (Looping back to frame 0 is not arriving.)
    if (this.#anim.loop) this.#armRelax();
  }

  #armRelax() {
    this.#cancelRelax?.();
    this.#cancelRelax = null;
    if (this.#posture === 'lie') return;
    this.#cancelRelax = this.#after(RELAX_MS, () => {
      this.#cancelRelax = null;
      if (!this.#running) return;
      const from = this.#posture;
      this.#posture = 'lie';
      const plan = this.#playable([`${from}-lie`, 'rest-lie']);
      if (plan.length > 0) this.#play(plan);
    });
  }

  /**
   * Hand out THIS frame, whatever happens to the animation afterwards. The
   * pick closes over the animation and the index, so a screen that asks a
   * moment later still gets the frame that was current when show() ran.
   * @param {number} index
   */
  #emit(index) {
    const anim = this.#anim;
    if (!anim) return;
    this.#show((size) => anim.bySize.get(size)?.[index]);
  }

  #schedule() {
    const anim = this.#anim;
    if (!anim) return;
    this.#cancel = this.#after(1000 / anim.fps, () => {
      this.#cancel = null;
      this.#tick();
    });
  }

  #tick() {
    const anim = this.#anim;
    if (!this.#running || !anim) return;
    const next = this.#index + 1;
    if (next < anim.count) {
      this.#index = next;
      this.#emit(next);
      this.#schedule();
      return;
    }
    if (anim.loop) {
      this.#index = 0;
      this.#emit(0);
      this.#schedule();
      return;
    }
    // One play is over: on to the next, which for a transition or a trick is
    // the rest of the posture it ended in (the art ends on that rest's first frame).
    const following = this.#queue.shift();
    if (following) this.#begin(following);
  }
}
