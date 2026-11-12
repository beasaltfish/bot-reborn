import { nets } from '../netlist.js';

/** Resolve only the documented jumper and SDO-to-ground address selections.
 * Other SDO/CS connections require signal-level or SPI modeling and are not
 * assumed safe. Empty breadboard strips do not drive a pin.
 * @param {import('../bench.js').Bench} bench @param {string} instance
 * @returns {{address:number|null,supported:boolean,points:string[]}}
 */
export function bme280Wiring(bench, instance) {
  const sensor = bench.placed.find(part => part.id === instance && part.part === 'bme280-i2c');
  if (!sensor) throw new RangeError('unknown BME280');
  const network = nets(bench);
  const parts = new Map(bench.placed.map(part => [part.id, part]));
  const sdo = `${instance}:SDO`, ground = `${instance}:GND`, cs = `${instance}:CS`;
  /** @param {string} point */
  const deviceMembers = point => network.members(point).filter(member => parts.has(member.slice(0, member.indexOf(':'))));
  /** @param {string} point */
  const isGroundTerminal = point => {
    const colon = point.indexOf(':');
    const part = parts.get(point.slice(0, colon)), pin = point.slice(colon + 1);
    return pin.replace(/\.\d+$/, '') === 'GND' || (part?.part === 'dc-source' && pin === '-');
  };
  const sdoMembers = deviceMembers(sdo);
  const csMembers = deviceMembers(cs);
  const grounded = network.same(sdo, ground);
  const otherSdo = sdoMembers.filter(point => point !== sdo && !(grounded && isGroundTerminal(point)));
  const otherCs = csMembers.filter(point => point !== cs);
  if (otherSdo.length || otherCs.length || !['0x76', '0x77'].includes(String(sensor.properties.address))) {
    const points = [...new Set([...(otherSdo.length ? [sdo, ...otherSdo] : []), ...(otherCs.length ? [cs, ...otherCs] : [])])].sort();
    return { address: null, supported: false, points };
  }
  return { address: grounded ? 0x76 : Number(sensor.properties.address), supported: true, points: [] };
}
