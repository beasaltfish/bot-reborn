// Bounded battery pack model. The cell figures come from manufacturer
// datasheets (see docs/hardware/sim-power-sources.md); the state-of-charge
// interpolation and the empty-pack resistance are explicit model assumptions,
// not measurements.

/**
 * @typedef {{
 *   fullVoltage: number,
 *   emptyVoltage: number,
 *   freshInternalResistanceOhm: number,
 *   emptyInternalResistanceOhm: number,
 *   capacityMah: number,
 *   currentLimitMa: number,
 * }} Chemistry
 */

/** @type {Record<string, Chemistry>} */
export const BATTERY_CHEMISTRIES = {
  // 4 x Energizer E91: 1.5 V nominal, 150-300 mOhm per cell, 2850 mAh to 0.8 V.
  alkaline: {
    fullVoltage: 6,
    emptyVoltage: 4,
    freshInternalResistanceOhm: 0.6,
    emptyInternalResistanceOhm: 1.2,
    capacityMah: 2850,
    currentLimitMa: 2000,
  },
  // 4 x Panasonic eneloop BK-3MCC: 1.2 V nominal, 25 mOhm per cell, 2000 mAh.
  nimh: {
    fullVoltage: 5.6,
    emptyVoltage: 4,
    freshInternalResistanceOhm: 0.1,
    emptyInternalResistanceOhm: 0.4,
    capacityMah: 2000,
    currentLimitMa: 3000,
  },
};

/**
 * A pack's source figures from its chemistry and state of charge.
 * @param {Record<string, unknown>} properties
 */
export function batterySource(properties) {
  const chemistry = typeof properties.chemistry === 'string' ? BATTERY_CHEMISTRIES[properties.chemistry] : undefined;
  const charge = properties.charge;
  if (!chemistry || typeof charge !== 'number' || !Number.isFinite(charge) || charge < 0 || charge > 100) return null;
  const fraction = charge / 100;
  return {
    voltage: chemistry.emptyVoltage + (chemistry.fullVoltage - chemistry.emptyVoltage) * fraction,
    internalResistanceOhm: chemistry.emptyInternalResistanceOhm + (chemistry.freshInternalResistanceOhm - chemistry.emptyInternalResistanceOhm) * fraction,
    currentLimitMa: chemistry.currentLimitMa,
    capacityMah: chemistry.capacityMah,
    chemistry: properties.chemistry,
    chargePercent: charge,
  };
}
