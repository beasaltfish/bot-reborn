import { nets } from '../netlist.js';
import { PARTS } from '../parts.js';
import { resistorPaths } from './resistor-paths.js';

/** Conservative supply-to-output reachability, not an operating-point solver.
 * Use only for documented outputs that can reach the module supply voltage.
 * @param {import('../bench.js').Bench} bench
 * @param {import('../devices/profiles.js').Profile} profile
 * @param {{part:string,supplyPin:string,signalPins:string[],directCode:string}} model
 * @returns {import('./supply.js').ElectricalFault[]}
 */
export function poweredOutputSafety(bench, profile, model) {
  const network = nets(bench);
  const boards = bench.placed.filter(part => part.part === 'esp32');
  const devices = bench.placed.filter(part => part.part === model.part);
  const sources = bench.placed.filter(part => part.part === 'dc-source' && !part.burnt);
  /** @type {import('./supply.js').ElectricalFault[]} */ const faults = [];
  for (const board of boards) for (const device of devices) {
    const vin = `${device.id}:${model.supplyPin}`, ground = `${board.id}:GND`;
    const gpio = PARTS[board.part].pins.filter(pin => /^GPIO\d+$/.test(pin.name)).map(pin => `${board.id}:${pin.name}`);
    const connected = model.signalPins.flatMap(pin => {
      const signal = `${device.id}:${pin}`;
      const paths = resistorPaths(bench, network, signal);
      return gpio.flatMap(point => {
        const pins = paths.get(network.netOf(point));
        return pins === undefined ? [] : [{ signal, point, pins }];
      });
    });
    if (!connected.length) continue;
    const signalPoints = connected.flatMap(({ signal, point, pins }) => [signal, point, ...pins]);
    const signalViaResistor = connected.some(item => item.pins.length > 0);
    const supplyPaths = resistorPaths(bench, network, vin);
    const boardSupply = supplyPaths.get(network.netOf(`${board.id}:5V`));
    const unknownVoltage = !Number.isFinite(profile.rails['5V']) || !Number.isFinite(profile.gpioVoltage);
    if (bench.usb && boardSupply !== undefined && (unknownVoltage || profile.rails['5V'] > profile.gpioVoltage)) {
      const indirect = unknownVoltage || boardSupply.length > 0 || signalViaResistor;
      faults.push({ code: indirect ? 'unsupported-electrical-network' : model.directCode, severity: 'warning', instances: [board.id, device.id].sort(), points: [vin, `${board.id}:5V`, ...boardSupply, ...signalPoints].sort(), values: indirect ? {} : { supplyVoltage: profile.rails['5V'] } });
    }
    for (const source of sources) {
      const positive = `${source.id}:+`, negative = `${source.id}:-`;
      // A terminal already on board ground is not itself a driven path into
      // the supply; this avoids treating unrelated pull-downs as source paths.
      const plus = network.same(positive, ground) ? undefined : supplyPaths.get(network.netOf(positive));
      const minus = network.same(negative, ground) ? undefined : supplyPaths.get(network.netOf(negative));
      if (plus === undefined && minus === undefined) continue;
      const common = plus !== undefined && network.same(negative, ground);
      const voltage = Number(source.properties.voltage);
      const supplyPins = plus ?? minus ?? [];
      const indirect = !Number.isFinite(voltage) || !Number.isFinite(profile.gpioVoltage) || supplyPins.length > 0 || signalViaResistor;
      if (common && !indirect && voltage <= profile.gpioVoltage) continue;
      const code = common && !indirect ? model.directCode : 'unsupported-electrical-network';
      faults.push({ code, severity: 'warning', instances: [board.id, device.id, source.id].sort(), points: [vin, positive, negative, ...supplyPins, ...signalPoints].sort(), values: {} });
    }
  }
  return faults;
}
