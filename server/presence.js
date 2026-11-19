// Who this brain has met since it started: a body connected, and a body the
// robot actually answered out loud — speech, or a pet's bark. Memory only — a
// restart forgets, and the admin page says so ("since this brain started").
// Never written to a character's config or to disk.

/**
 * The key a record lives under: a setup generation when the caller has one,
 * else the character id alone (records and callers from before generations
 * existed). A generation is never compared with an id, so a name reused after
 * deletion cannot inherit the old pairing's memory.
 * @param {string} id @param {string} [setupId]
 */
const scope = (id, setupId) => setupId ?? id;

/**
 * @param {() => number} [now] milliseconds; injectable so a test needs no clock
 * @returns {{
 *   saw(id: string, setupId?: string): void,
 *   spoke(id: string, setupId?: string): void,
 *   of(id: string, setupId?: string): { lastSeenAt?: number, lastSpokeAt?: number },
 * }}
 */
export function createPresence(now = Date.now) {
  /** @type {Map<string, number>} first time this brain met the body */
  const seen = new Map();
  /** @type {Map<string, number>} first time this brain answered it out loud */
  const spoke = new Map();

  return {
    saw(id, setupId) {
      const key = scope(id, setupId);
      if (!seen.has(key)) seen.set(key, now());
    },
    spoke(id, setupId) {
      const key = scope(id, setupId);
      if (!spoke.has(key)) spoke.set(key, now());
    },
    of(id, setupId) {
      const key = scope(id, setupId);
      /** @type {{ lastSeenAt?: number, lastSpokeAt?: number }} */
      const out = {};
      const firstSeen = seen.get(key);
      const firstSpoke = spoke.get(key);
      if (firstSeen !== undefined) out.lastSeenAt = firstSeen;
      if (firstSpoke !== undefined) out.lastSpokeAt = firstSpoke;
      return out;
    },
  };
}
