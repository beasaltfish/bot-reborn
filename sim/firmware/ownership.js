// Who controls a device, from the netlist. This is not "what is powered": an
// externally powered servo with a GPIO signal is `board`, and a source-and-
// resistor LED with no controller is `circuit`. Powered off, uninitialised or
// a different firmware does not change the verdict.
import { nets } from '../netlist.js';
import { PARTS } from '../parts.js';
import { DEVICES } from '../devices/catalog.js';

const CONTROL_KINDS = new Set(['gpio', 'pwm', 'oneWire', 'driver']);

/** @param {any} device @param {string} id */
function terminals(device, id) {
  /** @type {string[]} */
  const out = [];
  for (const cap of device.capabilities) {
    if (cap.kind === 'gpio' || cap.kind === 'pwm' || cap.kind === 'oneWire') out.push(`${id}:${cap.pin}`);
    else if (cap.kind === 'i2c') out.push(`${id}:${cap.sda}`, `${id}:${cap.scl}`);
    else if (cap.kind === 'spi') out.push(`${id}:${cap.sck}`, `${id}:${cap.mosi}`);
    else if (cap.kind === 'driver') for (const pin of cap.inputs) out.push(`${id}:${pin}`);
    else if (cap.kind === 'led' || cap.kind === 'load') out.push(`${id}:${cap.positive}`, `${id}:${cap.negative}`);
  }
  return out;
}

/** @param {import('../bench.js').Bench} bench @returns {Record<string, 'board'|'circuit'|'unknown'>} */
export function ownershipOf(bench) {
  const network = nets(bench);
  const board = bench.placed.find((part) => part.part === 'esp32');
  if (!board) return {};
  /** @param {string} point @returns {string} */
  const net = (point) => {
    try { return network.netOf(point); } catch { return ''; }
  };

  // Every GPIO is a potential control point, whatever its current level.
  /** @type {Set<string>} */
  const control = new Set();
  for (const pin of PARTS.esp32.pins) {
    if (/^GPIO\d+$/.test(pin.name)) control.add(net(`${board.id}:${pin.name}`));
  }

  const resistors = bench.placed.filter((part) => part.part === 'resistor' && !part.burnt);
  const resistorNet = (/** @type {string} */ id, /** @type {number} */ n) => net(`${id}:${n}`);
  // One resistor carries a control path, not a chain of them.
  for (const r of resistors) {
    const a = resistorNet(r.id, 1), b = resistorNet(r.id, 2);
    if (control.has(a)) control.add(b);
    if (control.has(b)) control.add(a);
  }

  /** @type {Set<string>} */
  const power = new Set();
  for (const part of bench.placed) {
    if (part.burnt) continue;
    const device = DEVICES[part.part];
    if (!device) continue;
    // The adjustable DC source predates the capability table and is handled
    // specially by the evaluator; its terminals are still + and -.
    if (part.part === 'dc-source') power.add(net(`${part.id}:+`));
    for (const cap of device.capabilities) {
      if (cap.kind === 'source' && 'positive' in cap) power.add(net(`${part.id}:${cap.positive}`));
      else if (cap.kind === 'battery') power.add(net(`${part.id}:${cap.positive}`));
      else if (cap.kind === 'regulator') power.add(net(`${part.id}:${cap.output}`));
      else if (cap.kind === 'supply' && !cap.ground && typeof cap.positive === 'string') power.add(net(`${part.id}:${cap.positive}`));
    }
  }
  for (const r of resistors) {
    const a = resistorNet(r.id, 1), b = resistorNet(r.id, 2);
    if (power.has(a)) power.add(b);
    if (power.has(b)) power.add(a);
  }

  /** @type {Record<string, 'board'|'circuit'|'unknown'>} */
  const result = {};
  for (const part of bench.placed) {
    if (part.part === 'esp32' || part.burnt) continue;
    const device = DEVICES[part.part];
    if (!device) continue;
    const points = terminals(device, part.id);
    if (points.length === 0) continue;
    const netsOf = points.map(net);
    const hasControl = netsOf.some((n) => control.has(n)) || (part.part === 'speaker' && netsOf.some((n) => (network.members(n) ?? []).some((m) => m.startsWith('amp:'))));
    const hasPower = netsOf.some((n) => power.has(n));
    const conflict = netsOf.some((n) => control.has(n) && power.has(n));
    if (conflict) result[part.id] = 'unknown';
    else if (hasControl) result[part.id] = 'board';
    else if (hasPower) result[part.id] = 'circuit';
    else result[part.id] = 'unknown';
  }

  // A board-controlled driver carries its declared outputs into the control path.
  for (const part of bench.placed) {
    if (part.part === 'esp32' || part.burnt) continue;
    if (result[part.id] !== 'board') continue;
    const device = DEVICES[part.part];
    for (const cap of device?.capabilities ?? []) {
      if (cap.kind !== 'driver') continue;
      for (const channel of cap.channels ?? []) {
        for (const output of channel.outputs) control.add(net(`${part.id}:${output}`));
      }
    }
  }
  // Re-evaluate loads now that driver outputs are control nets.
  for (const part of bench.placed) {
    if (result[part.id] !== 'unknown') continue;
    const device = DEVICES[part.part];
    if (!device) continue;
    const netsOf = terminals(device, part.id).map(net);
    if (netsOf.some((n) => control.has(n)) && !netsOf.some((n) => control.has(n) && power.has(n))) result[part.id] = 'board';
  }
  return result;
}

/** @param {any} network @param {string} point */
function netOfSafe(network, point) { try { return network.netOf(point); } catch { return ''; } }

/**
 * @param {import('../bench.js').Bench} bench
 * @returns {{ code: 'ownership-unknown', severity: 'info', instances: string[], points: string[] }[]}
 */
export function ownershipIssues(bench) {
  const verdicts = ownershipOf(bench);
  /** @type {{ code: 'ownership-unknown', severity: 'info', instances: string[], points: string[] }[]} */
  const issues = [];
  const network = nets(bench);
  for (const part of bench.placed) {
    if (verdicts[part.id] !== 'unknown') continue;
    const device = DEVICES[part.part];
    if (!device) continue;
    const points = terminals(device, part.id);
    const wired = points.some((point) => {
      const members = network.members(netOfSafe(network, point)) ?? [];
      return members.some((m) => !m.startsWith(`${part.id}:`) && !m.startsWith('bb'));
    });
    if (!wired) continue;
    issues.push({ code: 'ownership-unknown', severity: 'info', instances: [part.id], points });
  }
  return issues;
}
