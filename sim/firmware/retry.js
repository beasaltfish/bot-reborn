// When to knock again. Mirrors firmware/components/body_logic/link_policy.c.
export const RETRY_MS = [500, 1000, 2000, 5000];

/** A run of busy rejects is retried this long before the body gives up. */
export const BUSY_GIVE_UP_MS = 15000;

/** @param {number} attempt @returns {number} */
export function nextRetryMs(attempt) {
  return RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)];
}

/** @param {string} reason @param {number} busySince @param {number} now */
export function rejectIsFinal(reason, busySince, now) {
  if (reason !== 'busy') return true;
  return now - busySince >= BUSY_GIVE_UP_MS;
}
