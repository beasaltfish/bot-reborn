// Bounded addressable-strip data check: direction, profile pin support and
// logic-high compatibility. Bit timing and protocol waveforms are not modeled.
export const WS2812_CURRENT_MA = { idle: 1, perChannel: 20 };

/** @param {number} value */
const channel = value => Math.min(255, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)));

/** @param {unknown} pixels @param {number} limit */
export function boundedPixels(pixels, limit) {
  if (!Array.isArray(pixels)) return [];
  return pixels.slice(0, limit).map(pixel => Array.isArray(pixel) ? [channel(pixel[0]), channel(pixel[1]), channel(pixel[2])] : [0, 0, 0]);
}

/** @param {number[][]} pixels */
export function stripCurrent(pixels) {
  return pixels.reduce((sum, pixel) => sum + pixel.reduce((part, value) => part + value / 255 * WS2812_CURRENT_MA.perChannel, 0), WS2812_CURRENT_MA.idle);
}

/**
 * @param {import('../devices/profiles.js').Profile} profile
 * @param {{id:string,point:string|null,pin:string|null,output:boolean}} instance
 * @param {{levelHigh?:number, frequencyHz?:number}} [signal]
 */
export function evaluateOneWire(profile, instance, signal = {}) {
  /** @type {import('./supply.js').ElectricalFault[]} */ const faults = [];
  if (!instance.output || !instance.pin || !profile.pwmPins?.includes(instance.pin)) {
    faults.push({ code: 'onewire-data-direction', severity: 'warning', instances: [instance.id], points: instance.point ? [instance.point] : [], values: {} });
  }
  const requiredHigh = signal.levelHigh ?? 3.5;
  if (!Number.isFinite(profile.gpioVoltage) || profile.gpioVoltage < requiredHigh) {
    faults.push({ code: 'logic-level-incompatible', severity: 'warning', instances: [instance.id], points: instance.point ? [instance.point] : [], values: { requiredHigh, gpioVoltage: profile.gpioVoltage } });
    return { state: 'level-incompatible', faults };
  }
  return { state: 'ready', faults };
}
