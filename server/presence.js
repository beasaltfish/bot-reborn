// Who this brain has met since it started: a body connected, and a body the
// robot actually answered out loud — speech, or a pet's bark. Memory only — a
// restart forgets, and the admin page says so ("since this brain started").
// Never written to a character's config or to disk.

/**
 * @param {() => number} [now] milliseconds; injectable so a test needs no clock
 * @returns {{
 *   saw(id: string): void,
 *   spoke(id: string): void,
 *   of(id: string): { lastSeenAt?: number, lastSpokeAt?: number },
 * }}
 */
export function createPresence(now = Date.now) {
  /** @type {Map<string, number>} first time this brain met the body */
  const seen = new Map();
  /** @type {Map<string, number>} first time this brain answered it out loud */
  const spoke = new Map();

  return {
    saw(id) {
      if (!seen.has(id)) seen.set(id, now());
    },
    spoke(id) {
      if (!spoke.has(id)) spoke.set(id, now());
    },
    of(id) {
      /** @type {{ lastSeenAt?: number, lastSpokeAt?: number }} */
      const out = {};
      const firstSeen = seen.get(id);
      const firstSpoke = spoke.get(id);
      if (firstSeen !== undefined) out.lastSeenAt = firstSeen;
      if (firstSpoke !== undefined) out.lastSpokeAt = firstSpoke;
      return out;
    },
  };
}
