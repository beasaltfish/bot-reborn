// Deliberately limited to directed source -> regulator -> load networks.
import { nets } from '../netlist.js';
import { DEVICES } from '../devices/catalog.js';

/** @typedef {{ p: import('../bench.js').Placed, c: any, positive: string, ground: string, input?: string }} Producer */
/** @typedef {{ p: import('../bench.js').Placed, c: any, positive: string, ground: string, current: number }} Load */

/**
 * @param {import('../bench.js').Bench} bench
 * @param {{ profile: object, mode: import('./supply.js').OperatingMode, stimuli?: object, devices?: Record<string, import('./supply.js').ElectricalDevice> }} options
 * @returns {import('./supply.js').ElectricalOutcome}
 */
export function evaluateElectrical(bench, { profile, mode, stimuli, devices = DEVICES }) {
  const n = nets(bench);
  /** @type {import('./supply.js').ElectricalOutcome} */
  const outcome = { rails: {}, devices: {}, faults: [], burns: [] };
  /** @type {Producer[]} */ const sources = [];
  /** @type {Producer[]} */ const regulators = [];
  /** @type {Load[]} */ const loads = [];
  /** @param {import('../bench.js').Placed} p @param {string} pin */
  const point = (p, pin) => `${p.id}:${pin}`;
  /** @param {string} code @param {import('./supply.js').ElectricalFault['severity']} severity @param {string[]} instances @param {string[]} points @param {Record<string, number>} values */
  const fault = (code, severity, instances, points, values = {}) => outcome.faults.push({ code, severity, instances, points, values });
  /** @param {...unknown} xs */
  const finite = (...xs) => xs.every(x => typeof x === 'number' && Number.isFinite(x));
  for (const p of bench.placed) {
    if (p.burnt) continue;
    for (const raw of devices[p.part]?.capabilities ?? []) {
      /** @type {any} */ const c = { ...raw };
      let unresolved = false;
      const resolve = (/** @type {any} */ value) => {
        if (value && typeof value === 'object' && ('property' in value || 'profileRail' in value)) {
          const result = typeof value.property === 'string' ? p.properties[value.property] : /** @type {any} */ (profile).rails?.[value.profileRail];
          if (typeof result !== 'number' || !Number.isFinite(result)) unresolved = true;
          return result;
        }
        return value;
      };
      for (const key of ['voltage', 'currentLimitMa', 'internalResistanceOhm', 'dropoutVoltage', 'efficiency', 'minVoltage', 'maxVoltage', 'maxPowerMw']) if (key in c) c[key] = resolve(c[key]);
      if (c.currentsMa) c.currentsMa = Object.fromEntries(Object.entries(c.currentsMa).map(([key, value]) => [key, resolve(value)]));
      if (unresolved) { fault('unsupported-electrical-network', 'error', [p.id], [], {}); continue; }
      if (c.kind === 'source' && c.positive && c.negative && finite(c.voltage, c.currentLimitMa, c.internalResistanceOhm) && c.voltage > 0 && c.currentLimitMa >= 0 && c.internalResistanceOhm >= 0) {
        sources.push({ p, c, positive: n.netOf(point(p, c.positive)), ground: n.netOf(point(p, c.negative)) });
      } else if (c.kind === 'regulator' && c.input && c.output && c.ground && finite(c.voltage, c.dropoutVoltage, c.efficiency, c.currentLimitMa) && c.voltage > 0 && c.dropoutVoltage >= 0 && c.efficiency > 0 && c.efficiency <= 1 && c.currentLimitMa >= 0) {
        regulators.push({ p, c, input: n.netOf(point(p, c.input)), positive: n.netOf(point(p, c.output)), ground: n.netOf(point(p, c.ground)) });
      } else if ((c.kind === 'supply' || c.kind === 'load') && c.positive && (c.ground || c.negative) && c.currentsMa && finite(c.currentsMa[mode] ?? c.currentsMa.idle ?? 0) && (c.currentsMa[mode] ?? c.currentsMa.idle ?? 0) >= 0) {
        loads.push({ p, c, positive: n.netOf(point(p, c.positive)), ground: n.netOf(point(p, c.ground || c.negative)), current: c.currentsMa[mode] ?? c.currentsMa.idle ?? 0 });
      } else if (['source', 'regulator', 'supply', 'load', 'resistor', 'led'].includes(c.kind) && Object.values(raw).some(v => typeof v === 'number' || (v && typeof v === 'object'))) {
        fault('unsupported-electrical-network', 'error', [p.id], [], {});
      }
    }
  }
  for (const s of sources) if (sources.some(other => other !== s && (other.positive === s.ground || other.ground === s.positive))) fault('unsupported-electrical-network', 'error', [s.p.id], [point(s.p, s.c.positive), point(s.p, s.c.negative)], {});
  for (const s of sources) if (s.c.internalResistanceOhm > 0 && regulators.some(r => r.input === s.positive && r.ground === s.ground)) fault('unsupported-electrical-network', 'error', [s.p.id], [point(s.p, s.c.positive)], {});
  for (const r of regulators) if (sources.some(s => s.positive === r.input && s.ground !== r.ground)) fault('unsupported-electrical-network', 'error', [r.p.id], [point(r.p, r.c.input), point(r.p, r.c.ground)], {});
  const producers = [...sources, ...regulators];
  /** @type {Map<string, Producer[]>} */ const byNet = new Map();
  for (const s of producers) byNet.set(s.positive, [...(byNet.get(s.positive) ?? []), s]);
  /** @type {Set<Producer>} */ const active = new Set(), done = new Set(), cyclic = new Set();
  /** @type {Producer[]} */ const path = [];
  /** @param {Producer} s */
  const detect = s => {
    if (active.has(s)) { for (const x of path.slice(path.indexOf(s))) cyclic.add(x); return; }
    if (done.has(s)) return;
    active.add(s); path.push(s);
    if (s.input !== undefined) for (const parent of byNet.get(s.input) ?? []) detect(parent);
    path.pop(); active.delete(s); done.add(s);
  };
  producers.forEach(detect);
  if (cyclic.size) fault('unsupported-electrical-network', 'error', [...cyclic].map(x => x.p.id), [], {});
  /** @param {Producer} s @param {Set<Producer>} seen @returns {number} */
  const available = (s, seen = new Set()) => {
    if (seen.has(s) || cyclic.has(s)) return 0;
    if (s.input === undefined) return s.c.voltage;
    const parent = (byNet.get(s.input) ?? []).find(x => x.ground === s.ground);
    if (!parent) return 0;
    return Math.max(0, Math.min(s.c.voltage, available(parent, new Set(seen).add(s)) - s.c.dropoutVoltage));
  };
  /** @param {Producer} s @param {Set<Producer>} seen @returns {number} */
  const demand = (s, seen = new Set()) => {
    if (seen.has(s) || cyclic.has(s)) return 0;
    const next = new Set(seen).add(s);
    let current = loads.filter(l => l.positive === s.positive && l.ground === s.ground).reduce((sum, l) => sum + l.current, 0);
    for (const r of regulators.filter(r => r.input === s.positive && r.ground === s.ground)) {
      const inputVoltage = available(s);
      const outputVoltage = available(r);
      const outputDemand = demand(r, next);
      // A current-limited constant-current output is unavailable.
      if (outputDemand <= r.c.currentLimitMa && outputVoltage > 0) current += outputDemand * outputVoltage / (inputVoltage * r.c.efficiency);
    }
    return current;
  };
  /** @type {Set<Producer>} */ const evaluating = new Set();
  /** @param {Producer} s @returns {import('./supply.js').RailState} */
  const evaluate = s => {
    if (outcome.rails[s.positive]) return outcome.rails[s.positive];
    const group = byNet.get(s.positive) ?? [];
    /** @type {import('./supply.js').RailState} */
    const rail = { voltage: 0, requestedCurrentMa: demand(s), deliveredCurrentMa: 0, sourceInstances: group.map(x => x.p.id), status: 'off' };
    outcome.rails[s.positive] = rail;
    if (cyclic.has(s) || evaluating.has(s)) return rail;
    if (group.length > 1) {
      rail.status = 'contended';
      fault('source-contention', 'error', rail.sourceInstances, group.map(x => point(x.p, x.c.positive || x.c.output)));
      return rail;
    }
    if (s.positive === s.ground) { rail.status = 'reversed'; fault('reverse-polarity', 'error', [s.p.id], [point(s.p, s.c.positive || s.c.output)]); return rail; }
    evaluating.add(s);
    let voltage = s.c.voltage;
    if (s.input !== undefined) {
      const parent = (byNet.get(s.input) ?? []).find(x => x.ground === s.ground);
      const input = parent ? evaluate(parent) : null;
      voltage = input && input.voltage > 0 ? Math.min(voltage, Math.max(0, input.voltage - s.c.dropoutVoltage)) : 0;
      if (input && input.voltage > 0 && voltage < s.c.voltage) { rail.status = 'dropout'; fault('regulator-dropout', 'warning', [s.p.id], [point(s.p, s.c.output)], { voltage }); }
    } else voltage = Math.max(0, voltage - rail.requestedCurrentMa * s.c.internalResistanceOhm / 1000);
    rail.voltage = voltage;
    rail.deliveredCurrentMa = voltage ? Math.min(rail.requestedCurrentMa, s.c.currentLimitMa) : 0;
    if (rail.requestedCurrentMa > s.c.currentLimitMa) { rail.status = 'limited'; rail.voltage = 0; fault('source-current-limit', 'warning', [s.p.id], [point(s.p, s.c.positive || s.c.output)], { requestedCurrentMa: rail.requestedCurrentMa, currentLimitMa: s.c.currentLimitMa }); }
    else if (voltage && rail.status === 'off') rail.status = 'ok';
    evaluating.delete(s); return rail;
  };
  producers.forEach(evaluate);
  // Propagate unsupported points along regulator power paths, without joining
  // unrelated rails merely because they share a return.
  /** @type {Set<string>} */ const affected = new Set();
  for (const f of outcome.faults.filter(f => f.code === 'unsupported-electrical-network')) {
    for (const pin of f.points) affected.add(n.netOf(pin));
    for (const id of f.instances) {
      const p = bench.placed.find(x => x.id === id);
      if (!p) continue;
      for (const raw of devices[p.part]?.capabilities ?? []) {
        /** @type {any} */ const c = raw;
        const keys = c.kind === 'regulator' ? ['input', 'output'] : c.kind === 'resistor' || c.kind === 'led' ? ['positive', 'negative'] : ['positive'];
        for (const key of keys) if (typeof c[key] === 'string') affected.add(n.netOf(point(p, c[key])));
      }
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of regulators) if (r.input !== undefined && (affected.has(r.input) || affected.has(r.positive) || affected.has(r.ground))) {
      for (const net of [r.input, r.positive]) if (!affected.has(net)) { affected.add(net); changed = true; }
    }
  }
  for (const s of producers) if (affected.has(s.positive) || affected.has(s.ground)) {
    const rail = outcome.rails[s.positive];
    rail.voltage = 0; rail.deliveredCurrentMa = 0; rail.status = 'off';
  }
  for (const l of loads) {
    const s = (byNet.get(l.positive) ?? []).find(x => x.ground === l.ground);
    const reverse = (byNet.get(l.ground) ?? []).find(x => x.ground === l.positive);
    const r = s && outcome.rails[s.positive];
    const voltage = r?.voltage ?? 0;
    /** @type {import('./supply.js').DeviceElectricalState['status']} */
    let status = 'ok';
    const points = [point(l.p, l.c.positive), point(l.p, l.c.ground || l.c.negative)];
    if (reverse) { status = 'reversed'; fault('reverse-polarity', 'error', [l.p.id], points, { voltage: outcome.rails[reverse.positive]?.voltage ?? 0 }); }
    else if (r?.status === 'limited') { status = 'brownout'; fault('rail-brownout', 'warning', [l.p.id], points, { voltage: 0 }); }
    else if (!voltage) { status = 'unpowered'; fault('device-unpowered', 'info', [l.p.id], points); }
    else if (l.c.maxVoltage !== undefined && voltage > l.c.maxVoltage) { status = 'overvoltage'; fault('device-overvoltage', 'destructive', [l.p.id], points, { voltage }); outcome.burns.push(l.p.id); }
    else if (l.c.maxPowerMw !== undefined && voltage * l.current > l.c.maxPowerMw) { status = 'overpower'; fault('device-overpower', 'destructive', [l.p.id], points, { powerMw: voltage * l.current }); outcome.burns.push(l.p.id); }
    else if (l.c.minVoltage !== undefined && voltage < l.c.minVoltage) { status = 'brownout'; fault('rail-brownout', 'warning', [l.p.id], points, { voltage, minVoltage: l.c.minVoltage }); }
    const previous = outcome.devices[l.p.id];
    const rank = ['ok', 'unpowered', 'brownout', 'reversed', 'overvoltage', 'overpower'];
    outcome.devices[l.p.id] = { voltage: previous ? Math.min(previous.voltage, voltage) : voltage, currentMa: (previous?.currentMa ?? 0) + (voltage ? l.current : 0), status: previous && rank.indexOf(previous.status) > rank.indexOf(status) ? previous.status : status }; 
  }
  outcome.burns = [...new Set(outcome.burns)].sort();
  outcome.faults = [...new Map(outcome.faults.map(f => { f.instances.sort(); f.points.sort(); return [JSON.stringify(f), f]; })).values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return outcome;
}
