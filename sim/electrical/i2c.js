import { nets } from '../netlist.js';

/**
 * Check bus topology for supplied I2C instances. This evaluates connectivity,
 * not signal timing or pull-up sizing; callers must not treat it as SPICE.
 * @param {import('../bench.js').Bench} bench
 * @param {import('../devices/profiles.js').Profile} profile
 * @param {{id:string, sda:string, scl:string, address:number}[]} instances
 * @param {{controllerPowered:boolean, devices: Record<string, {status:string}>}} electrical
 */
export function evaluateI2c(bench, profile, instances, electrical) {
  const net = nets(bench);
  const controller = bench.placed.find(p => p.part === 'esp32' && !p.burnt);
  /** @type {Record<string,string>} */ const states = {};
  /** @type {{code:string, instances:string[], points:string[]}[]} */ const faults = [];
  /** @type {{id:string,sda:string,scl:string,address:number,bus:string}[]} */ const ready = [];
  /** @param {string} code @param {string[]} ids @param {string[]} points */
  const fault = (code, ids, points) => faults.push({ code, instances: [...ids].sort(), points: [...points].sort() });
  for (const item of [...instances].sort((a, b) => a.id.localeCompare(b.id))) {
    const sda = `${item.id}:${item.sda}`, scl = `${item.id}:${item.scl}`;
    const points = [sda, scl];
    const status = electrical.devices[item.id]?.status;
    if (status !== 'ok') {
      const invalidSupply = status === 'overvoltage' || status === 'reversed' || status === 'overpower';
      states[item.id] = status === 'overvoltage' ? 'unsupported-voltage' : 'off';
      fault(invalidSupply ? 'i2c-supply-invalid' : 'i2c-unpowered', [item.id], points);
      continue;
    }
    if (!controller || electrical.controllerPowered !== true) {
      states[item.id] = 'off';
      fault('i2c-controller-unpowered', [item.id], points);
      continue;
    }
    if (net.same(sda, scl)) { states[item.id] = 'shorted'; fault('i2c-lines-shorted', [item.id], points); continue; }
    const rails = controller ? ['GND', ...Object.keys(profile.rails)].map(p => `${controller.id}:${p}`) : [];
    const rail = rails.find(p => net.same(p, sda) || net.same(p, scl));
    if (rail) { states[item.id] = 'shorted'; fault('i2c-line-on-rail', [item.id], [...points, rail]); continue; }
    const buses = controller ? profile.i2cBuses.map(b => ({ ...b, sdaPoint: `${controller.id}:${b.sda}`, sclPoint: `${controller.id}:${b.scl}` })) : [];
    const bus = buses.find(b => net.same(sda, b.sdaPoint) && net.same(scl, b.sclPoint));
    if (bus) { states[item.id] = 'ready'; ready.push({ ...item, sda, scl, bus: bus.id }); continue; }
    const swapped = buses.find(b => net.same(sda, b.sclPoint) && net.same(scl, b.sdaPoint));
    states[item.id] = swapped ? 'swapped' : 'wrong-bus';
    fault(swapped ? 'i2c-sda-scl-swapped' : 'i2c-wrong-bus', [item.id], points);
  }
  /** @type {Map<string, typeof ready>} */ const groups = new Map();
  for (const item of ready) {
    const key = JSON.stringify([item.bus, item.address]);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const item of group) states[item.id] = 'address-conflict';
    fault('i2c-address-conflict', group.map(item => item.id), group.flatMap(item => [item.sda, item.scl]));
  }
  return { buses: profile.i2cBuses.map(b => ({ id: b.id, instances: ready.filter(r => r.bus === b.id).map(r => r.id) })), states, faults };
}
