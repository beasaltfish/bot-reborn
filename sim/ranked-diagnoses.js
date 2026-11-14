import { diagnose } from './diagnose.js';

// Legacy faults do not carry severities; identify the cases that signal an
// immediate electrical hazard or damage before displaying other findings.
const URGENT = new Set(['short-rails', 'led-overcurrent', 'led-burnt', 'source-short', 'source-contention', 'gpio-overvoltage-risk', 'gpio-negative-voltage-risk', 'logic-level-incompatible', 'i2c-level-incompatible', 'reverse-polarity', 'device-overvoltage', 'device-overpower', 'mic-5v', 'mic-burnt', 'screen-5v', 'screen-burnt', 'imu-5v', 'imu-burnt', 'toy-short', 'toy-burnt']);
/** @param {{code:string, severity?:string}} fault */
function rank(fault) {
  if (fault.severity === 'destructive' || URGENT.has(fault.code)) return 0;
  if (fault.severity === 'info' || fault.code === 'firmware-unsupported') return 3;
  if (fault.severity === 'warning') return 2;
  return 1;
}

/** Rank actual faults without adding recipe-specific guesses to free mode.
 * @param {import('./bench.js').Bench} bench
 * @param {ReturnType<typeof import('./devices/evaluate.js').evaluateBench>} result
 * @param {string} [lang]
 */
export function rankedDiagnoses(bench, result, lang = 'en') {
  const faults = result.faults.map((fault, index) => ({ fault, index }))
    .sort((a, b) => rank(a.fault) - rank(b.fault) || a.index - b.index)
    .map(item => item.fault);
  return diagnose(bench, { ...result.legacy, faults, burns: result.burns }, lang).filter(hint => hint.kind === 'fault');
}
