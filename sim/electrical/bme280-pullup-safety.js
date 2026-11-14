import { poweredOutputSafety } from './powered-output-safety.js';

/** The BME280 breakout's header-side I²C pull-ups go to VIN.
 * @param {import('../bench.js').Bench} bench
 * @param {import('../devices/profiles.js').Profile} profile
 */
export function bme280PullupSafety(bench, profile) {
  return poweredOutputSafety(bench, profile, { part: 'bme280-i2c', supplyPin: 'VIN', signalPins: ['SDI', 'SCK'], directCode: 'i2c-level-incompatible' });
}
