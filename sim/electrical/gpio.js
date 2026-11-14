import { nets } from '../netlist.js';
import { PARTS } from '../parts.js';

/** Explicit hypothetical GPIO declarations; no firmware pin modes are inferred.
 * @typedef {{point:string,direction:'input',pull:'up'|'down'|'none'} | {point:string,direction:'output',level:'high'|'low'|'high-z'}} Declaration
 * @typedef {{point:string,ground:string,powered:boolean,level:'high'|'low'|'high-z',highVoltage:number}} ExternalDriver
 * @typedef {'off'|'high'|'low'|'floating'|'contended'|'unsupported'|'unsupported-voltage'} GpioState
 */

/** Evaluate direct GPIO nets, explicitly supplied external drivers and the
 * modeled ideal push-button. The caller must establish each driver's power and
 * nominal output voltage; resistor networks, current, voltage dividers and
 * real firmware pin modes are not inferred.
 * @param {import('../bench.js').Bench} bench
 * @param {import('../devices/profiles.js').Profile} profile
 * @param {Declaration[]} declarations
 * @param {{controllerPowered:boolean,drivers?:ExternalDriver[]}} electrical
 * @returns {{states:Record<string,GpioState>,faults:import('./supply.js').ElectricalFault[]}}
 */
export function evaluateGpio(bench, profile, declarations, electrical) {
  const board = bench.placed.find(part => part.part === 'esp32' && !part.burnt);
  if (!board) throw new RangeError('GPIO controller is missing');
  const validPins = new Set(PARTS.esp32.pins.filter(pin => /^GPIO\d+$/.test(pin.name)).map(pin => `${board.id}:${pin.name}`));
  const declared = new Set();
  for (const item of declarations) {
    if (!validPins.has(item.point) || declared.has(item.point)
      || (item.direction === 'input' && !['up', 'down', 'none'].includes(item.pull))
      || (item.direction === 'output' && !['high', 'low', 'high-z'].includes(item.level))
      || !['input', 'output'].includes(item.direction)) throw new RangeError('invalid GPIO declaration');
    declared.add(item.point);
  }
  const network = nets(bench);
  const parts = new Map(bench.placed.map(part => [part.id, part]));
  const drivers = electrical.drivers ?? [];
  const driverPoints = new Set();
  /** @param {string} point */
  const placedPin = point => {
    const colon = point.indexOf(':');
    const part = colon < 0 ? undefined : parts.get(point.slice(0, colon));
    return part && PARTS[part.part].pins.some(pin => pin.name === point.slice(colon + 1)) ? part : undefined;
  };
  for (const driver of drivers) {
    const part = placedPin(driver.point), reference = placedPin(driver.ground);
    if (!part || part.id === board.id || reference?.id !== part.id || driver.point === driver.ground || driverPoints.has(driver.point)
      || typeof driver.powered !== 'boolean' || !['high', 'low', 'high-z'].includes(driver.level)
      || !Number.isFinite(driver.highVoltage) || driver.highVoltage <= 0) throw new RangeError('invalid external GPIO driver');
    driverPoints.add(driver.point);
  }
  /** @type {Record<string,GpioState>} */ const states = {};
  /** @type {import('./supply.js').ElectricalFault[]} */ const faults = [];
  const seenFaults = new Set();
  /** @param {string} code @param {string[]} points */
  const fault = (code, points) => {
    const normalized = [...new Set(points)].sort();
    const key = JSON.stringify([code, normalized]);
    if (!seenFaults.has(key)) {
      seenFaults.add(key);
      const instances = [...new Set([board.id, ...normalized.map(point => point.slice(0, point.indexOf(':'))).filter(id => parts.has(id))])].sort();
      faults.push({ code, severity: 'warning', instances, points: normalized, values: {} });
    }
  };
  for (const item of declarations) {
    const point = item.point;
    const attached = drivers.filter(driver => network.same(point, driver.point));
    if (!electrical.controllerPowered) {
      states[point] = 'off';
      const active = attached.filter(driver => driver.powered && driver.level !== 'high-z');
      if (active.length) fault('unsupported-electrical-network', [point, ...active.flatMap(driver => [driver.point, driver.ground])]);
      continue;
    }
    const group = declarations.filter(other => network.same(point, other.point));
    const unknownDrivers = attached.filter(driver => !driver.powered || parts.get(driver.point.slice(0, driver.point.indexOf(':')))?.burnt || !network.same(driver.ground, `${board.id}:GND`));
    const active = attached.filter(driver => !unknownDrivers.includes(driver));
    const members = network.members(point).filter(member => parts.has(member.slice(0, member.indexOf(':'))));
    const unknown = members.filter(member => {
      if (declared.has(member) || driverPoints.has(member)) return false;
      const colon = member.indexOf(':'), part = parts.get(member.slice(0, colon)), pin = member.slice(colon + 1).replace(/\.\d+$/, '');
      if (part?.id === board.id && ['GND', '3V3', '5V'].includes(pin)) return false;
      return part?.part !== 'push-button';
    });
    const highRail = network.same(point, `${board.id}:3V3`), lowRail = network.same(point, `${board.id}:GND`);
    const fiveVolt = network.same(point, `${board.id}:5V`);
    const high = highRail || fiveVolt || group.some(other => other.direction === 'output' && other.level === 'high') || active.some(driver => driver.level === 'high');
    const low = lowRail || group.some(other => other.direction === 'output' && other.level === 'low') || active.some(driver => driver.level === 'low');
    const rails = [...(highRail ? ['3V3'] : []), ...(fiveVolt ? ['5V'] : [])];
    const invalidLevels = !Number.isFinite(profile.gpioVoltage) || profile.gpioVoltage <= 0 || rails.some(rail => !Number.isFinite(profile.rails[rail]) || profile.rails[rail] <= 0);
    const excessive = rails.filter(rail => profile.rails[rail] > profile.gpioVoltage);
    const excessiveDrivers = active.filter(driver => driver.level === 'high' && driver.highVoltage > profile.gpioVoltage);
    const indeterminateHigh = active.filter(driver => driver.level === 'high' && driver.highVoltage < profile.gpioVoltage);
    if (invalidLevels) {
      states[point] = 'unsupported';
      fault('unsupported-electrical-network', [...group.map(other => other.point), ...rails.map(rail => `${board.id}:${rail}`)]);
    } else if (excessive.length || excessiveDrivers.length) {
      states[point] = 'unsupported-voltage';
      fault('logic-level-incompatible', [...group.map(other => other.point), ...excessive.map(rail => `${board.id}:${rail}`), ...excessiveDrivers.map(driver => driver.point)]);
    } else if (high && low) {
      states[point] = 'contended';
      fault('gpio-contention', [...group.map(other => other.point), ...active.filter(driver => driver.level !== 'high-z').map(driver => driver.point), ...(highRail ? [`${board.id}:3V3`] : []), ...(lowRail ? [`${board.id}:GND`] : [])]);
    } else if (unknown.length || rails.length > 1 || unknownDrivers.length || indeterminateHigh.length) {
      states[point] = 'unsupported';
      fault('unsupported-electrical-network', [...group.map(other => other.point), ...unknown, ...unknownDrivers.flatMap(driver => [driver.point, driver.ground]), ...indeterminateHigh.map(driver => driver.point)]);
    } else if (high || low) states[point] = high ? 'high' : 'low';
    else {
      const pulls = new Set(group.filter(other => other.direction === 'input').map(other => other.direction === 'input' ? other.pull : 'none').filter(pull => pull !== 'none'));
      if (pulls.size > 1) { states[point] = 'unsupported'; fault('unsupported-electrical-network', group.map(other => other.point)); }
      else if (pulls.has('up')) states[point] = 'high';
      else if (pulls.has('down')) states[point] = 'low';
      else {
        states[point] = 'floating';
        if (item.direction === 'input') fault('floating-input', group.map(other => other.point));
      }
    }
  }
  return { states, faults };
}
