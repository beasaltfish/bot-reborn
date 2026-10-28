// The pet's executor: no wheels, but the screen moves. A pose is handed to
// the animator and the promise resolves at once — handle() must not wait for
// a two-second trick before it can listen again (the same reason a car's move
// resolves when the motion ends, not when the command is sent).

export class PetExecutor {
  /** @type {import('../pet/animator.js').Animator} */ #animator;
  /** The Brain's `stop()` on a body that has gone away sets this; nothing here reads it. */
  connected = true;

  /** @param {import('../pet/animator.js').Animator} animator */
  constructor(animator) {
    this.#animator = animator;
  }

  /** No wheels: these exist so the Brain's executor shape is satisfied. */
  move() { return Promise.resolve(); }
  cruise() { return Promise.resolve(); }
  stop() { return Promise.resolve(); }

  /** @param {import('../../core/poses.js').Pose} name */
  pose(name) {
    this.#animator.pose(name);
    return Promise.resolve();
  }
}
