import { nets } from '../netlist.js';
import { PARTS } from '../parts.js';
import { DEVICES } from '../devices/catalog.js';
import { batterySource } from './power-sources.js';
import { DEFAULT_LED_FORWARD_VOLTAGE, evaluateLed } from './led.js';

/**
 * A capability value that may be a fixed number or read from a property. A
 * regulator's voltage also maps a written value ("3.3") to a number.
 * @param {any} value @param {Record<string, any>} properties @param {boolean} [mapValues]
 */
function scalar(value, properties, mapValues = false) {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && typeof value.property === 'string') {
    const raw = properties[value.property];
    if (mapValues && value.values && typeof value.values[String(raw)] === 'number') return value.values[String(raw)];
    return Number(raw);
  }
  return NaN;
}

/**
 * The sources the bounded LED loop solves: a bench DC source, a regulated or
 * battery supply, and a regulator output whose input is one of those on shared
 * ground and clear of dropout. Everything else stays unsupported.
 * @param {import('../bench.js').Bench} bench
 * @param {any} n
 */
function modeledSources(bench, n) {
  /** @type {{ id: string, positive: string, negative: string, voltage: number, resistance: number, currentLimitMa: number, allowed: string[] }[]} */
  const sources = [];
  /** @type {{ p: import('../bench.js').Placed, cap: any, voltage: number }[]} */
  const regulators = [];
  for (const p of bench.placed) {
    if (p.burnt) continue;
    if (p.part === 'dc-source') {
      sources.push({
        id: p.id, positive: `${p.id}:+`, negative: `${p.id}:-`,
        voltage: Number(p.properties.voltage),
        resistance: Number(p.properties.internalResistanceOhm) || 0,
        currentLimitMa: Number(p.properties.currentLimitMa),
        allowed: [],
      });
      continue;
    }
    for (const raw of DEVICES[p.part]?.capabilities ?? []) {
      const cap = /** @type {any} */ (raw);
      if (cap.kind === 'source' && cap.positive && cap.negative) {
        sources.push({
          id: p.id, positive: `${p.id}:${cap.positive}`, negative: `${p.id}:${cap.negative}`,
          voltage: scalar(cap.voltage, p.properties),
          resistance: scalar(cap.internalResistanceOhm, p.properties) || 0,
          currentLimitMa: scalar(cap.currentLimitMa, p.properties),
          allowed: [],
        });
      } else if (cap.kind === 'battery' && cap.positive && cap.negative) {
        const spec = batterySource(p.properties);
        if (spec) {
          sources.push({
            id: p.id, positive: `${p.id}:${cap.positive}`, negative: `${p.id}:${cap.negative}`,
            voltage: spec.voltage, resistance: spec.internalResistanceOhm,
            currentLimitMa: spec.currentLimitMa, allowed: [],
          });
        }
      } else if (cap.kind === 'regulator' && cap.input && cap.output && cap.ground) {
        const voltage = scalar(cap.voltage, p.properties, true);
        if (Number.isFinite(voltage) && voltage > 0) regulators.push({ p, cap, voltage });
      }
    }
  }
  for (const { p, cap, voltage } of regulators) {
    const input = `${p.id}:${cap.input}`, ground = `${p.id}:${cap.ground}`;
    const feed = sources.find((s) => n.same(input, s.positive) && n.same(ground, s.negative));
    if (!feed) continue;
    const dropout = scalar(cap.dropoutVoltage, p.properties) || 0;
    if (feed.voltage < voltage + dropout) continue;
    sources.push({
      id: p.id, positive: `${p.id}:${cap.output}`, negative: ground,
      // A bench regulator is stiff enough for a few tens of mA; this is the
      // bounded stand-in for its output impedance, not a datasheet figure.
      voltage, resistance: 0.1,
      currentLimitMa: scalar(cap.currentLimitMa, p.properties),
      allowed: [input, ground, feed.positive, feed.negative],
    });
  }
  return sources;
}

/** Evaluate a single unbranched source–resistor–LED loop from actual nets.
 * @param {import('../bench.js').Bench} bench
 * @param {string} ledId
 */
export function evaluateLedBench(bench, ledId) {
  const led = bench.placed.find(p => p.id === ledId && p.part === 'led-5mm');
  if (!led) throw new RangeError('unknown LED');
  if (led.burnt) return { state: 'burnt', currentMa: 0 };
  const n = nets(bench);
  const sources = modeledSources(bench, n);
  const resistors = bench.placed.filter(p => p.part === 'resistor' && !p.burnt);
  const anode = `${ledId}:A`, cathode = `${ledId}:K`;
  // Reachability through other modeled passive elements detects closed loops
  // beyond the one-resistor model. It does not estimate their current.
  /** @type {Map<string, Set<string>>} */
  const paths = new Map();
  /** @param {string} a @param {string} b */
  const join = (a, b) => {
    const x = n.netOf(a), y = n.netOf(b);
    if (!paths.has(x)) paths.set(x, new Set());
    if (!paths.has(y)) paths.set(y, new Set());
    paths.get(x)?.add(y); paths.get(y)?.add(x);
  };
  for (const resistor of resistors) join(`${resistor.id}:1`, `${resistor.id}:2`);
  for (const other of bench.placed.filter(p => p.part === 'led-5mm' && p.id !== ledId && !p.burnt)) join(`${other.id}:A`, `${other.id}:K`);
  /** @param {string} a @param {string} b @param {string} excludedSource */
  const reaches = (a, b, excludedSource) => {
    const target = n.netOf(b), seen = new Set([n.netOf(a)]), queue = [...seen];
    for (let i = 0; i < queue.length; i++) {
      if (queue[i] === target) return true;
      const neighbours = [...(paths.get(queue[i]) ?? [])];
      // Another source in the path is not solved; it only tells us the
      // network is outside the one-source approximation.
      for (const other of sources) {
        if (other.id === excludedSource) continue;
        const positive = n.netOf(other.positive), negative = n.netOf(other.negative);
        if (queue[i] === positive) neighbours.push(negative);
        if (queue[i] === negative) neighbours.push(positive);
      }
      for (const next of neighbours) if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
    return false;
  };
  for (const source of sources) {
    if (!Number.isFinite(source.voltage) || source.voltage <= 0) continue;
    const positive = source.positive, negative = source.negative;
    if (n.same(positive, negative) && (n.same(anode, positive) || n.same(cathode, positive))) return { state: 'short', currentMa: 0 };
    if (n.same(anode, negative)) {
      const reversed = n.same(cathode, positive) || resistors.some(r => (n.same(`${r.id}:1`, positive) && n.same(`${r.id}:2`, cathode)) || (n.same(`${r.id}:2`, positive) && n.same(`${r.id}:1`, cathode)));
      if (reversed) return { state: 'reversed', currentMa: 0 };
    }
    const direct = n.same(anode, positive) && n.same(cathode, negative);
    const matching = resistors.filter(r => {
      const joins = (/** @type {string} */ a, /** @type {string} */ b) => (n.same(`${r.id}:1`, a) && n.same(`${r.id}:2`, b)) || (n.same(`${r.id}:2`, a) && n.same(`${r.id}:1`, b));
      return (n.same(cathode, negative) && joins(positive, anode)) || (n.same(anode, positive) && joins(cathode, negative));
    });
    if (!direct && matching.length !== 1) {
      const closed = (reaches(positive, anode, source.id) && reaches(negative, cathode, source.id)) || (reaches(positive, cathode, source.id) && reaches(negative, anode, source.id));
      if (closed) return { state: 'unsupported', currentMa: 0 };
      continue;
    }
    const allowed = new Set([positive, negative, anode, cathode, ...source.allowed, ...(direct ? [] : [`${matching[0].id}:1`, `${matching[0].id}:2`])]);
    for (const button of bench.placed.filter(p => p.part === 'push-button' && p.properties.pressed === true)) {
      allowed.add(`${button.id}:1`);
      allowed.add(`${button.id}:2`);
    }
    const extra = [positive, negative, anode, cathode].some(point => n.members(point).some(member => !member.startsWith('bb') && !allowed.has(member)));
    if (extra || (direct && matching.length)) return { state: 'unsupported', currentMa: 0 };
    const resistance = direct ? 0 : Number(matching[0].properties.ohms);
    return evaluateLed({ voltage: source.voltage, resistance: resistance + source.resistance, forwardVoltage: DEFAULT_LED_FORWARD_VOLTAGE, maxCurrentMa: 20, maxPowerMw: 60, currentLimitMa: source.currentLimitMa });
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

/**
 * A bounded GPIO-driven LED: high-side (GPIO -> resistor -> LED -> GND) and
 * low-side (3V3 -> resistor -> LED -> GPIO sinking). Only one resistor and one
 * LED; anything else is unsupported, never assumed safe.
 * @param {import('../bench.js').Bench} bench
 * @param {string} ledId
 * @param {Record<string, 'high'|'low'|'high-z'>} gpioOutputs
 * @param {{ gpioSourceMa?: number }} [profile]
 */
export function evaluateGpioLed(bench, ledId, gpioOutputs, profile = {}) {
  const n = nets(bench);
  const led = bench.placed.find((p) => p.id === ledId && p.part === 'led-5mm');
  if (!led) return { state: 'unsupported', currentMa: 0 };
  if (led.burnt) return { state: 'burnt', currentMa: 0 };
  const resistors = bench.placed.filter((p) => p.part === 'resistor' && !p.burnt);
  const gpioPoint = (/** @type {string} */ name) => `esp:${name}`;
  const pins = PARTS.esp32.pins.filter((p) => /^GPIO\d+$/.test(p.name)).map((p) => p.name);
  /** @param {string} a @param {string} b */
  const same = (a, b) => n.same(a, b);
  for (const name of pins) {
    const level = gpioOutputs[name];
    if (!level || level === 'high-z') continue;
    const gpio = gpioPoint(name);
    for (const r of resistors) {
      const ohms = Number(r.properties.ohms);
      if (!Number.isFinite(ohms) || ohms <= 0) continue;
      const highSide = (same(`${r.id}:1`, gpio) && same(`${r.id}:2`, `${ledId}:A`) && same(`${ledId}:K`, 'esp:GND'))
        || (same(`${r.id}:2`, gpio) && same(`${r.id}:1`, `${ledId}:A`) && same(`${ledId}:K`, 'esp:GND'));
      if (highSide) {
        if (level !== 'high') return { state: 'off', currentMa: 0 };
        const currentMa = Math.max(0, (3.3 - 1.8) / ohms * 1000);
        const limit = profile.gpioSourceMa ?? 20;
        return currentMa > limit ? { state: 'overcurrent', currentMa } : { state: 'on', currentMa };
      }
      const lowSide = (same(`${r.id}:1`, 'esp:3V3') && same(`${r.id}:2`, `${ledId}:A`) && same(`${ledId}:K`, gpio))
        || (same(`${r.id}:2`, 'esp:3V3') && same(`${r.id}:1`, `${ledId}:A`) && same(`${ledId}:K`, gpio));
      if (lowSide) {
        if (level !== 'low') return { state: 'off', currentMa: 0 };
        const currentMa = Math.max(0, (3.3 - 1.8) / ohms * 1000);
        const limit = profile.gpioSourceMa ?? 20;
        return currentMa > limit ? { state: 'overcurrent', currentMa } : { state: 'on', currentMa };
      }
    }
  }
  return { state: 'off', currentMa: 0 };
}
