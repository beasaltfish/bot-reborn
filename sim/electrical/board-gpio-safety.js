import { nets } from '../netlist.js';
import { PARTS } from '../parts.js';
import { resistorPaths } from './resistor-paths.js';

/** Detect onboard 5 V-to-GPIO paths without assuming pin mode. Resistor paths
 * are unsupported, not solved; other intervening components are not modeled.
 * @param {import('../bench.js').Bench} bench
 * @param {import('../devices/profiles.js').Profile} profile
 * @returns {import('./supply.js').ElectricalFault[]}
 */
export function boardGpioSafety(bench, profile) {
  if (!bench.usb) return [];
  const network = nets(bench);
  /** @type {import('./supply.js').ElectricalFault[]} */ const faults = [];
  for (const board of bench.placed.filter(part => part.part === 'esp32')) {
    const supply = `${board.id}:5V`;
    const invalid = !Number.isFinite(profile.rails['5V']) || !Number.isFinite(profile.gpioVoltage) || profile.rails['5V'] <= 0 || profile.gpioVoltage <= 0;
    if (!invalid && profile.rails['5V'] <= profile.gpioVoltage) continue;
    const paths = resistorPaths(bench, network, supply);
    for (const pin of PARTS[board.part].pins.filter(pin => /^GPIO\d+$/.test(pin.name))) {
      const point = `${board.id}:${pin.name}`;
      const pins = paths.get(network.netOf(point));
      if (pins === undefined) continue;
      const unsupported = invalid || pins.length > 0;
      faults.push({ code: unsupported ? 'unsupported-electrical-network' : 'logic-level-incompatible', severity: 'warning', instances: [board.id], points: [supply, point, ...pins], values: unsupported ? {} : { supplyVoltage: profile.rails['5V'], logicVoltage: profile.gpioVoltage } });
    }
  }
  return faults;
}
