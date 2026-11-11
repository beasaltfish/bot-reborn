import { nets } from '../netlist.js';
import { evaluateLed } from './led.js';

/** Evaluate a single unbranched source–resistor–LED loop from actual nets.
 * @param {import('../bench.js').Bench} bench
 * @param {string} ledId
 */
export function evaluateLedBench(bench, ledId) {
  const led = bench.placed.find(p => p.id === ledId && p.part === 'led-5mm');
  if (!led) throw new RangeError('unknown LED');
  if (led.burnt) return { state: 'burnt', currentMa: 0 };
  const n = nets(bench);
  const sources = bench.placed.filter(p => p.part === 'dc-source' && !p.burnt);
  const resistors = bench.placed.filter(p => p.part === 'resistor' && !p.burnt);
  const anode = `${ledId}:A`, cathode = `${ledId}:K`;
  for (const source of sources) {
    const positive = `${source.id}:+`, negative = `${source.id}:-`;
    if (n.same(positive, negative) && (n.same(anode, positive) || n.same(cathode, positive))) return { state: 'short', currentMa: 0 };
    if (n.same(anode, negative)) {
      const reversed = n.same(cathode, positive) || resistors.some(r => (n.same(`${r.id}:1`, positive) && n.same(`${r.id}:2`, cathode)) || (n.same(`${r.id}:2`, positive) && n.same(`${r.id}:1`, cathode)));
      if (reversed) return { state: 'reversed', currentMa: 0 };
    }
    if (!n.same(cathode, negative)) continue;
    const direct = n.same(anode, positive);
    const matching = resistors.filter(r => (n.same(`${r.id}:1`, positive) && n.same(`${r.id}:2`, anode)) || (n.same(`${r.id}:2`, positive) && n.same(`${r.id}:1`, anode)));
    if (!direct && matching.length !== 1) continue;
    const allowed = new Set([positive, negative, anode, cathode, ...(direct ? [] : [`${matching[0].id}:1`, `${matching[0].id}:2`])]);
    const extra = [positive, negative, anode].some(point => n.members(point).some(member => !member.startsWith('bb') && !allowed.has(member)));
    if (extra || (direct && matching.length)) return { state: 'unsupported', currentMa: 0 };
    const resistance = direct ? 0 : Number(matching[0].properties.ohms);
    return evaluateLed({ voltage: Number(source.properties.voltage), resistance: resistance + Number(source.properties.internalResistanceOhm), forwardVoltage: 2, maxCurrentMa: 20, maxPowerMw: 60, currentLimitMa: Number(source.properties.currentLimitMa) });
  }
  return { state: 'off', currentMa: 0 };
}

/** Mark LEDs damaged by a modeled excessive current. Unsupported circuits are
 * left untouched because their current has not been determined.
 * @param {import('../bench.js').Bench} bench
 * @returns {{bench: import('../bench.js').Bench, burns: string[]}}
 */
export function applyLedDamage(bench) {
  const burns = bench.placed.filter(p => p.part === 'led-5mm' && !p.burnt && evaluateLedBench(bench, p.id).state === 'overcurrent').map(p => p.id);
  if (!burns.length) return { bench, burns };
  return { bench: { ...bench, placed: bench.placed.map(p => burns.includes(p.id) ? { ...p, burnt: true } : p) }, burns };
}
