// What a pet's whole body can do (pet screen spec §4.2). One list, because
// three things have to agree: the LLM's tool schema, the validator that drops
// what the model made up, and the admin page's reflex editor. A pose the
// animator has no frames for is a fourth, and the animator owns that answer.

export const POSES = /** @type {const} */ (['sit', 'shake', 'spin']);

/** @typedef {typeof POSES[number]} Pose */
