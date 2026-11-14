import { evaluateBench } from './devices/evaluate.js';
import { diagnose } from './diagnose.js';

/** Recompute the visible diagnosis without changing the power-on session. 
 * @param {import('./bench.js').Bench} bench
 * @param {string} [lang]
 * @param {ReturnType<typeof evaluateBench>} [evaluated]
 */
export function liveDiagnosis(bench, lang = 'en', evaluated) {
  const result = evaluated ?? evaluateBench(bench);
  const hints = diagnose(bench, { ...result.legacy, faults: result.faults, burns: result.burns }, lang);
  return (result.legacy.esp === 'brownout' ? hints.find(h => h.kind === 'fault') : hints[0]) ?? null;
}
