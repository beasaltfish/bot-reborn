// The tarot reader's executor: no wheels, but the screen moves. A draw starts
// the shuffle and a reveal turns the card over; both resolve at once, because
// handle() must not wait for an animation before it can listen again (the same
// reason the pet's pose does not).

export class TarotExecutor {
  /** @type {import('../tarot/animator.js').TarotAnimator | null} */ #animator;
  /** The Brain's `stop()` on a body that has gone away sets this; nothing here reads it. */
  connected = true;

  /** @param {import('../tarot/animator.js').TarotAnimator | null} animator null: no frames, so nothing to move */
  constructor(animator) {
    this.#animator = animator;
  }

  /** No wheels: these exist so the Brain's executor shape is satisfied. */
  move() { return Promise.resolve(); }
  cruise() { return Promise.resolve(); }
  stop() { return Promise.resolve(); }

  /** @param {import('../../core/tarot.js').Draw} card */
  draw(card) {
    this.#animator?.draw(card);
    return Promise.resolve();
  }

  reveal() {
    this.#animator?.reveal();
    return Promise.resolve();
  }
}
