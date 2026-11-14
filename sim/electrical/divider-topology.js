import { nets } from '../netlist.js';
import { PARTS, holeStrip } from '../parts.js';

/** Find only an isolated, unambiguous two-resistor divider. This checks net
 * topology, not supply, resistor tolerance, leakage, thresholds, current,
 * component ratings or safety; a match must never bypass an interlock.
 * @param {import('../bench.js').Bench} bench
 * @param {{source:string,output:string,ground:string}} points
 * @returns {{kind:'unsupported'}|{kind:'match',upper:string,lower:string,points:string[]}}
 */
export function findDividerTopology(bench, points) {
  const unsupported = /** @type {const} */ ({ kind: 'unsupported' });
  const parts = new Map(bench.placed.map(part => [part.id, part]));
  const boards = new Set(bench.boards.map(board => board.id));
  /** @param {string} point */
  const physical = point => {
    const colon = point.indexOf(':');
    const part = colon < 0 ? undefined : parts.get(point.slice(0, colon));
    return !!part && !part.burnt && PARTS[part.part].pins.some(pin => pin.name === point.slice(colon + 1));
  };
  if (![points.source, points.output, points.ground].every(physical)) return unsupported;
  const network = nets(bench);
  if (network.same(points.source, points.output) || network.same(points.source, points.ground) || network.same(points.output, points.ground)) return unsupported;
  const resistors = bench.placed.filter(part => part.part === 'resistor');
  /** @param {import('../bench.js').Placed} resistor @param {string} a @param {string} b */
  const connects = (resistor, a, b) => {
    const one = `${resistor.id}:1`, two = `${resistor.id}:2`;
    return (network.same(one, a) && network.same(two, b)) || (network.same(one, b) && network.same(two, a));
  };
  const uppers = resistors.filter(part => connects(part, points.source, points.output));
  const lowers = resistors.filter(part => connects(part, points.output, points.ground));
  if (uppers.length !== 1 || lowers.length !== 1 || uppers[0].id === lowers[0].id || uppers[0].burnt || lowers[0].burnt) return unsupported;
  const upper = uppers[0], lower = lowers[0];
  const allowed = new Set([points.source, points.output, points.ground, `${upper.id}:1`, `${upper.id}:2`, `${lower.id}:1`, `${lower.id}:2`]);
  /** @param {string} member */
  const harmlessGround = member => {
    const colon = member.indexOf(':');
    const part = parts.get(member.slice(0, colon));
    const name = member.slice(colon + 1), pin = name.replace(/\.\d+$/, '');
    return !!part && PARTS[part.part].pins.some(item => item.name === name)
      && (pin === 'GND' || (part.part === 'dc-source' && pin === '-'));
  };
  for (const anchor of [points.source, points.output, points.ground]) {
    for (const member of network.members(anchor)) {
      const id = member.slice(0, member.indexOf(':'));
      if (boards.has(id)) {
        try { holeStrip(member.slice(member.indexOf(':') + 1)); continue; } catch { return unsupported; }
      }
      if (allowed.has(member) || (anchor === points.ground && harmlessGround(member))) continue;
      return unsupported;
    }
  }
  return { kind: 'match', upper: upper.id, lower: lower.id, points: [...allowed].sort() };
}
