// The flat per-instance view a sketch reads: `ctx.parts.btn.level`, not the
// evaluator's nested sections. Only a device the firmware has initialised is
// visible; circuit devices are not sketches' inputs.
const SECTION = /** @type {Record<string,string>} */ ({
  'button-module': 'digital', 'hc-sr04': 'digital',
  'bme280-i2c': 'bme280', 'ssd1306': 'display',
  'sg90': 'servo', 'tb6612fng': 'motor', 'dc-motor-small': 'motor',
  'ws2812-strip': 'strip',
});

const KIND = /** @type {Record<string,string>} */ ({
  'button-module': 'button', 'hc-sr04': 'sonar', 'bme280-i2c': 'bme280',
  'ssd1306': 'display', 'sg90': 'servo', 'tb6612fng': 'motor',
  'dc-motor-small': 'motor', 'ws2812-strip': 'strip',
});

/**
 * @param {import('../bench.js').Bench} bench
 * @param {Record<string, any>} evaluation `evaluateBench(...).engineering`
 * @param {Record<string, string>} [deviceStates]
 */
export function partsView(bench, evaluation, deviceStates = {}) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const part of bench.placed) {
    const section = SECTION[part.part];
    if (!section) continue;
    const state = deviceStates[part.id];
    if (state && state !== 'active') continue;
    const record = evaluation?.[section]?.[part.id];
    if (!record) continue;
    out[part.id] = {
      kind: KIND[part.part],
      ...record,
      ...(evaluation.parts?.[part.id]?.electrical ? { electrical: evaluation.parts[part.id].electrical } : {}),
    };
  }
  return out;
}

/** Latch a sonar measurement until the sketch turns it off or the board stops. */
/** @param {Record<string, any>} stimuli @param {boolean} [on] @param {number} [distanceCm] */
export function measureSonar(stimuli, on = true, distanceCm = 100) {
  return { ...stimuli, sonar: { ...(stimuli.sonar ?? {}), measure: on, distanceCm } };
}

/** Device states that mean the part exists but its init did not succeed. */
const FAILED = new Set([
  'off', 'unsupported', 'burnt', 'reversed', 'address-conflict', 'swapped',
  'shorted', 'wrong-bus', 'unsupported-voltage', 'no-data', 'brownout',
]);

/**
 * Whether a board device's evaluation says its firmware init succeeded: the
 * part's own section record exists and is not a refusal.
 * @param {Record<string, any>} evaluation `evaluateBench(...).engineering`
 * @param {{ id: string, part: string }} part
 */
export function deviceInitialized(evaluation, part) {
  const section = SECTION[part.part];
  // An LED, a screen or another part without a protocol has no init to fail.
  if (!section) return true;
  const record = evaluation?.[section]?.[part.id];
  if (!record) return false;
  if (part.part === 'button-module') return record.level !== null;
  return !FAILED.has(record.state);
}
