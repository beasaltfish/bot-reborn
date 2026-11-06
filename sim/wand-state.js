// Which wands power-on found awake. The scene keeps this outside the meshes,
// like a screen's look, so a moved wand (a new mesh) does not forget. It is
// keyed by instance id, and the bin hands out the lowest free id, so a wand
// thrown away must be forgotten before a new one takes its name. Pure.

/** @typedef {{ id: string }} Instance */

export function createWandState() {
  /** @type {Map<string, boolean>} */
  const awake = new Map();
  return {
    /**
     * What a power-on (or an unplug) found: replaces everything known.
     * @param {Instance[]} placed
     * @param {Record<string, { kind: string, awake?: boolean, [field: string]: unknown }>} states
     */
    set(placed, states) {
      awake.clear();
      for (const p of placed) {
        const state = states[p.id];
        if (state && state.kind === 'imu') awake.set(p.id, state.awake === true);
      }
    },
    /**
     * Forget every wand that is no longer on the bench.
     * @param {Instance[]} placed
     */
    prune(placed) {
      const ids = new Set(placed.map((p) => p.id));
      for (const id of [...awake.keys()]) if (!ids.has(id)) awake.delete(id);
    },
    /** @param {string} id */
    awake(id) {
      return awake.get(id) === true;
    },
  };
}
