// What the screen is showing, one frame at a time (pet screen spec §4.4).
//
// Pure logic, no sockets and no timers of its own: `show` is whatever puts a
// JPEG on the wire and `after` is whatever schedules the next frame, so the
// whole thing runs under a fake clock in tests. The brain streams idle at a
// low frame rate; a pose interrupts it at once, plays once, and hands back to
// idle from idle's first frame.

/** @typedef {{ fps: number, loop: boolean, frames: Buffer[] }} Animation */

export class Animator {
  /** @type {import('./frames.js').PetFrames} */ #frames;
  /** @type {(jpeg: Buffer) => void} */ #show;
  /** @type {(ms: number, fn: () => void) => () => void} */ #after;
  /** @type {(line: string) => void} */ #log;
  /** @type {(() => void) | null} */ #cancel = null;
  /** @type {Animation | null} */ #anim = null;
  /** @type {string} */ #name = '';
  #index = 0;
  #running = false;

  /**
   * @param {{
   *   frames: import('./frames.js').PetFrames,
   *   show: (jpeg: Buffer) => void,
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

  /** Begin streaming idle. Called when a body connects. */
  start() {
    this.stop();
    this.#running = true;
    if (!this.#frames.has('idle')) {
      this.#log('pet: no idle animation — nothing to show');
      return;
    }
    this.#begin('idle', 0);
  }

  /**
   * Play a trick once, now, whatever was playing. A name with no frames is
   * ignored with one line: the animation died without the robot dying with it.
   * @param {string} name
   */
  pose(name) {
    if (!this.#running) return;
    if (!this.#frames.has(name)) {
      this.#log(`pet: no animation called "${name}" — the pose is ignored`);
      return;
    }
    this.#begin(name, 0);
  }

  /** The body is gone. The screen keeps its last frame; we just stop feeding it. */
  stop() {
    this.#running = false;
    this.#cancel?.();
    this.#cancel = null;
    this.#anim = null;
    this.#name = '';
    this.#index = 0;
  }

  /** @param {string} name @param {number} index */
  #begin(name, index) {
    this.#cancel?.();
    this.#cancel = null;
    this.#name = name;
    this.#anim = this.#frames.get(name) ?? null;
    this.#index = index;
    if (!this.#anim) return;
    this.#show(this.#anim.frames[index]);
    this.#schedule();
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
    if (next < anim.frames.length) {
      this.#index = next;
      this.#show(anim.frames[next]);
      this.#schedule();
      return;
    }
    // A trick is over: back to idle from its first frame, so the hand-back is
    // the idle's own animation rather than a cut (the art ends on that frame).
    if (anim.loop) {
      this.#index = 0;
      this.#show(anim.frames[0]);
      this.#schedule();
      return;
    }
    if (this.#name !== 'idle' && this.#frames.has('idle')) this.#begin('idle', 0);
    else this.#begin(this.#name, 0);
  }
}
