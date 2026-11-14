import { nets } from '../netlist.js';
import { PARTS } from '../parts.js';
import { resistorPaths } from './resistor-paths.js';

/** Identify direct shorts and directly paralleled independent DC supplies,
 * including contact with ESP32 rails. These connectivity checks do not
 * estimate current, external board power or reverse-current behavior.
 * @param {import('../bench.js').Bench} bench
 * @param {import('../devices/profiles.js').Profile} profile
 * @returns {import('./supply.js').ElectricalFault[]}
 */
export function dcSourceSafety(bench, profile) {
  const network = nets(bench);
  const sources = bench.placed.filter(part => part.part === 'dc-source' && !part.burnt).sort((a, b) => a.id.localeCompare(b.id));
  const boards = bench.placed.filter(part => part.part === 'esp32' && !part.burnt);
  /** @type {import('./supply.js').ElectricalFault[]} */
  const faults = [];
  for (const [i, source] of sources.entries()) {
    const positive = `${source.id}:+`, negative = `${source.id}:-`;
    if (network.same(positive, negative)) faults.push({ code: 'source-short', severity: 'error', instances: [source.id], points: [positive, negative], values: {} });
    for (const other of sources.slice(i + 1)) {
      const otherPositive = `${other.id}:+`, otherNegative = `${other.id}:-`;
      const parallel = network.same(positive, otherPositive) && network.same(negative, otherNegative);
      const opposing = network.same(positive, otherNegative) && network.same(negative, otherPositive);
      if (parallel || opposing) faults.push({ code: 'source-contention', severity: 'error', instances: [source.id, other.id], points: [positive, negative, otherPositive, otherNegative], values: {} });
    }
    const positivePaths = resistorPaths(bench, network, positive);
    const negativePaths = resistorPaths(bench, network, negative);
    for (const board of boards) {
      const ground = `${board.id}:GND`;
      const rails = ['3V3', '5V'].map(rail => `${board.id}:${rail}`);
      const driven = network.same(negative, ground) && !network.same(positive, ground) ? positive
        : network.same(positive, ground) && !network.same(negative, ground) ? negative : null;
      const paths = driven === positive ? positivePaths : driven === negative ? negativePaths : null;
      /** @param {Map<string, string[]>} referencePaths */
      const referencePins = referencePaths => {
        for (const reference of [ground, ...rails]) {
          const pins = referencePaths.get(network.netOf(reference));
          if (pins !== undefined) return pins;
        }
        return null;
      };
      /** @param {string} target */
      const unsupportedPath = target => {
        const pins = paths?.get(network.netOf(target));
        if (!pins?.length || network.same(target, ground)) return;
        faults.push({ code: 'unsupported-electrical-network', severity: 'error', instances: [board.id, source.id].sort(), points: [positive, negative, ground, target, ...pins], values: {} });
      };
      for (const supply of rails) {
        unsupportedPath(supply);
        const connected = (network.same(positive, supply) && network.same(negative, ground))
          || (network.same(positive, ground) && network.same(negative, supply));
        if (!connected) continue;
        faults.push({ code: bench.usb ? 'source-contention' : 'unsupported-electrical-network', severity: 'error', instances: [board.id, source.id].sort(), points: [positive, negative, supply, ground], values: {} });
      }
      const voltage = Number(source.properties.voltage);
      for (const pin of PARTS[board.part].pins.filter(pin => /^GPIO\d+$/.test(pin.name))) {
        const gpio = `${board.id}:${pin.name}`;
        unsupportedPath(gpio);
        if (network.same(gpio, ground)) continue;
        const positiveSignal = network.same(positive, gpio);
        const negativeSignal = network.same(negative, gpio);
        if (!positiveSignal && !negativeSignal) {
          // With no direct common reference, an external signal may still
          // reach the pin through resistors; distinguish an unknown resistive
          // reference from a genuinely unreferenced source.
          if (!driven && !network.same(positive, negative)) {
            const plus = positivePaths.get(network.netOf(gpio));
            const minus = negativePaths.get(network.netOf(gpio));
            const signalPins = plus?.length ? plus : minus?.length ? minus : null;
            if (signalPins) {
              const reference = referencePins(plus?.length ? negativePaths : positivePaths);
              faults.push({ code: reference ? 'unsupported-electrical-network' : 'source-ground-missing', severity: 'warning', instances: [board.id, source.id].sort(), points: [positive, negative, gpio, ground, ...signalPins, ...(reference ?? [])], values: {} });
            }
          }
          continue;
        }
        const points = [positive, negative, gpio, ground];
        const instances = [board.id, source.id].sort();
        if (positiveSignal && network.same(negative, ground)) {
          if (!Number.isFinite(profile.gpioVoltage)) faults.push({ code: 'unsupported-electrical-network', severity: 'error', instances, points, values: {} });
          else if (voltage > profile.gpioVoltage) faults.push({ code: 'gpio-overvoltage-risk', severity: 'warning', instances, points, values: { sourceVoltage: voltage, logicVoltage: profile.gpioVoltage } });
          else faults.push({ code: 'gpio-drive-unmodeled', severity: 'warning', instances, points, values: { sourceVoltage: voltage, logicVoltage: profile.gpioVoltage } });
        } else if (negativeSignal && network.same(positive, ground)) {
          if (voltage > 0) faults.push({ code: 'gpio-negative-voltage-risk', severity: 'warning', instances, points, values: { sourceVoltage: voltage } });
        } else {
          const reference = referencePins(positiveSignal ? negativePaths : positivePaths);
          const code = reference ? 'unsupported-electrical-network' : 'source-ground-missing';
          faults.push({ code, severity: 'warning', instances, points: [...points, ...(reference ?? [])], values: {} });
        }
      }
    }
  }
  return faults;
}
