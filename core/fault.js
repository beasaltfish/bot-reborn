// What the brain tells a body when one of its layers fails.
//
// Only the layer and the class of failure travel. The provider's own words
// stay in the brain's log: a 401 body can echo the key it was sent, and a body
// has no use for prose it would have to show verbatim.

/** @typedef {'stt' | 'llm' | 'tts'} LayerPart */

/**
 * @param {LayerPart} part which layer failed
 * @param {Error} err
 * @returns {{ type: 'fault', part: LayerPart, status: number | null, kind: 'http' | 'timeout' | 'network' | 'other' }}
 */
export function faultOf(part, err) {
  const status = Number.isInteger(/** @type {any} */ (err).status) ? /** @type {any} */ (err).status : null;
  const message = String(err?.message ?? '');
  /** @type {'http' | 'timeout' | 'network' | 'other'} */
  let kind = 'other';
  if (status !== null) kind = 'http';
  else if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || /timed out/i.test(message)) kind = 'timeout';
  else if (err instanceof TypeError && /fetch failed|ECONNREFUSED|ENOTFOUND|network/i.test(message)) kind = 'network';
  return { type: 'fault', part, status, kind };
}
