/** @typedef {{min:number,max:number}} Range */
/** @typedef {{sourceVoltage:Range,sourceResistanceOhm:Range,upperOhm:Range,lowerOhm:Range,inputLeakageUa:Range,inputLimits:{minVoltage:number,maxVoltage:number,highMinVoltage:number}}} DividerParameters */
/** @typedef {{status:'unsupported',voltageMin:null,voltageMax:null} | {status:'within-declared-bounds'|'outside-declared-bounds'|'indeterminate-high',voltageMin:number,voltageMax:number}} DividerResult */

/** Ideal resistive divider, high state only. Positive leakage injects current
 * into the GPIO node; negative leakage draws current from it. Every source,
 * resistor and leakage bound must be supplied by the caller. This does not
 * validate a bench topology, switching, protection diodes, resistor power,
 * source current limits, component tolerances, or hardware safety.
 * @param {unknown} raw @returns {DividerResult}
 */
export function evaluateVoltageDivider(raw) {
  /** @type {DividerResult} */ const unsupported = { status: 'unsupported', voltageMin: null, voltageMax: null };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return unsupported;
  const p = /** @type {DividerParameters} */ (raw);
  /** @param {unknown} value @param {number} min @param {number} max @returns {value is Range} */
  const validRange = (value, min, max) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const range = /** @type {Range} */ (value);
    return Number.isFinite(range.min) && Number.isFinite(range.max) && range.min >= min && range.max <= max && range.min <= range.max;
  };
  if (!validRange(p.sourceVoltage, 0, 100) || !validRange(p.sourceResistanceOhm, 0, 1e9)
    || !validRange(p.upperOhm, 0.001, 1e9) || !validRange(p.lowerOhm, 0.001, 1e9)
    || !validRange(p.inputLeakageUa, -1e6, 1e6) || !p.inputLimits || typeof p.inputLimits !== 'object'
    || !Number.isFinite(p.inputLimits.minVoltage) || !Number.isFinite(p.inputLimits.maxVoltage) || !Number.isFinite(p.inputLimits.highMinVoltage)
    || p.inputLimits.minVoltage > p.inputLimits.highMinVoltage || p.inputLimits.highMinVoltage > p.inputLimits.maxVoltage) return unsupported;
  /** @type {number[]} */ const voltages = [];
  for (const source of [p.sourceVoltage.min, p.sourceVoltage.max])
    for (const resistance of [p.sourceResistanceOhm.min, p.sourceResistanceOhm.max])
      for (const upper of [p.upperOhm.min, p.upperOhm.max])
        for (const lower of [p.lowerOhm.min, p.lowerOhm.max])
          for (const leakage of [p.inputLeakageUa.min, p.inputLeakageUa.max]) {
            const gUpper = 1 / (upper + resistance), gLower = 1 / lower;
            const voltage = (source * gUpper + leakage / 1e6) / (gUpper + gLower);
            if (!Number.isFinite(voltage)) return unsupported;
            voltages.push(voltage);
          }
  const voltageMin = Math.min(...voltages), voltageMax = Math.max(...voltages);
  const status = voltageMin < p.inputLimits.minVoltage || voltageMax > p.inputLimits.maxVoltage ? 'outside-declared-bounds'
    : voltageMin < p.inputLimits.highMinVoltage ? 'indeterminate-high' : 'within-declared-bounds';
  return { status, voltageMin, voltageMax };
}
