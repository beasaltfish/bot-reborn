// A character's own reflex presets: the question, threshold and state the
// admin saved under a name, to pick again later. Kept per character beside
// `config`, like `endpoints`, because the body never reads them. Never the
// provider or its key: picking one changes what is asked, not who is asked.
//
// The built-in two live in core/reflex-presets.js and are not stored here.

import { normalizeReflex } from '../core/config.js';

export const MAX_SAVED = 30;

/**
 * @typedef {{ name: string, threshold: number, state: string,
 *             question: import('../core/config.js').ReflexQuestion }} SavedReflex
 */

const isPlain = (/** @type {unknown} */ v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Read the way the brain reads a reflex, so what is picked is what runs.
 * @param {Record<string, unknown>} x @returns {SavedReflex | null}
 */
function readOne(x) {
  const name = typeof x.name === 'string' ? x.name.trim() : '';
  const r = normalizeReflex({ threshold: x.threshold, state: x.state, question: x.question });
  if (!name || name.length > 60 || !r.question) return null;
  return { name, threshold: r.threshold, state: r.state, question: r.question };
}

/** As stored: a bad entry is dropped, the rest kept. @param {unknown} v @returns {SavedReflex[]} */
export function storedSavedReflexes(v) {
  if (!Array.isArray(v)) return [];
  /** @type {SavedReflex[]} */ const out = [];
  for (const x of v) {
    const s = isPlain(x) ? readOne(/** @type {Record<string, unknown>} */ (x)) : null;
    if (s && !out.some((o) => o.name === s.name)) out.push(s);
  }
  return out;
}

/**
 * Checked before it is written: the page sends the whole list, and a list it
 * could not have meant is refused rather than half kept.
 * @param {unknown} list @returns {SavedReflex[]}
 */
export function checkSavedReflexes(list) {
  if (!Array.isArray(list)) throw new Error('saved reflexes must be a list');
  if (list.length > MAX_SAVED) throw new Error(`at most ${MAX_SAVED} saved reflexes`);
  const names = new Set();
  return list.map((x) => {
    if (!isPlain(x)) throw new Error('each saved reflex must be an object');
    const name = typeof x.name === 'string' ? x.name.trim() : '';
    if (!name || name.length > 60) throw new Error('a saved reflex name must be 1–60 characters');
    if (names.has(name)) throw new Error(`saved reflex ${name} is listed twice`);
    names.add(name);
    const s = readOne(x);
    if (!s) throw new Error(`saved reflex ${name} needs a question with at least two options`);
    return s;
  });
}
