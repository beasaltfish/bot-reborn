// Stable, JSON-safe export for tools which do not consume the simulator's bench.
import { PARTS } from './parts.js';
import { nets } from './netlist.js';
import { DEVICES } from './devices/catalog.js';
import { profileById } from './devices/profiles.js';

/** @param {string} a @param {string} b */
const compare = (a, b) => a.localeCompare(b, 'en', { numeric: true });
/** @param {any} value @returns {any} */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}

/**
 * Each wire retains both physical endpoints, while members gives the semantic
 * device pins on its full net. Pin-only nets capture seated/internal joins.
 * @param {import('./bench.js').Bench} bench
 * @param {string} profileId
 */
export function projectSnapshot(bench, profileId) {
  const profile = profileById(profileId);
  if (!profile) throw new RangeError(`unknown profile ${profileId}`);
  const net = nets(bench);
  const pins = bench.placed.flatMap(p => PARTS[p.part].pins.map(pin => `${p.id}:${pin.name}`)).sort(compare);
  /** @param {string} point */
  const members = point => pins.filter(pin => net.same(pin, point));
  const devices = bench.placed.map(p => ({ part: p.part, instance: p.id, properties: canonical(p.properties), firmware: canonical(DEVICES[p.part].firmware) })).sort((a, b) => compare(a.instance, b.instance));
  const connections = bench.wires.map(w => {
    const [a, b] = [w.a, w.b].sort(compare);
    return { id: w.id, a, b, color: w.color, members: members(a) };
  });
  const seen = new Set();
  for (const pin of pins) {
    const group = members(pin);
    const key = group.join('\0');
    if (group.length < 2 || seen.has(key)) continue;
    seen.add(key);
    if (!connections.some(w => net.same(w.a, pin))) connections.push({ id: '', a: group[0], b: group[1], color: '', members: group });
  }
  connections.sort((a, b) => compare(a.a, b.a) || compare(a.b, b.b) || compare(a.id, b.id) || compare(a.color, b.color));
  const resources = Object.entries(profile).filter(([name]) => name !== 'id').map(([name, value]) => ({ kind: 'profile', name, value: canonical(value) })).sort((a, b) => compare(a.kind, b.kind) || compare(a.name, b.name));
  const unique = (/** @type {string[]} */ values) => [...new Set(values)].sort(compare);
  const firmware = {
    libraries: unique(devices.flatMap(d => d.firmware.libraries)),
    actions: unique(devices.flatMap(d => d.firmware.actions)),
    telemetry: unique(devices.flatMap(d => d.firmware.telemetry)),
  };
  return { version: 1, profile: profile.id, devices, connections, resources, firmware };
}

/** @param {unknown} raw @returns {string[]} */
export function validateProjectSnapshot(raw) {
  /** @type {string[]} */ const errors = [];
  /** @param {unknown} v @returns {v is Record<string, any>} */
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  /** @param {unknown} v */
  const string = v => typeof v === 'string' && v.length > 0;
  /** @param {unknown} v */
  const strings = v => Array.isArray(v) && Array.from(v).every(string);
  /** @param {unknown} v @param {Set<object>} [seen] @param {number} [depth] @returns {boolean} */
  const json = (v, seen = new Set(), depth = 0) => {
    if (depth > 64) return false;
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
    if (typeof v === 'number') return Number.isFinite(v);
    if (!v || typeof v !== 'object' || seen.has(v)) return false;
    seen.add(v);
    const valid = Array.isArray(v) ? Array.from(v).every(x => json(x, seen, depth + 1)) : Object.values(v).every(x => json(x, seen, depth + 1));
    seen.delete(v);
    return valid;
  };
  /** @param {unknown} f */
  const contract = f => object(f) && strings(f.libraries) && Array.isArray(f.resources) && Array.from(f.resources).every(r => object(r) && string(r.kind) && json(r)) && object(f.init) && json(f.init) && strings(f.actions) && strings(f.telemetry);
  if (!object(raw)) return ['snapshot must be an object'];
  if (Object.keys(raw).sort().join(',') !== 'connections,devices,firmware,profile,resources,version') errors.push('invalid top-level keys');
  if (raw.version !== 1) errors.push('invalid version');
  if (!string(raw.profile) || !profileById(raw.profile)) errors.push('unknown profile');
  if (!Array.isArray(raw.devices) || !Array.from(raw.devices).every(d => object(d) && string(d.part) && Object.hasOwn(DEVICES, d.part) && string(d.instance) && object(d.properties) && Object.values(d.properties).every(v => ['string', 'boolean'].includes(typeof v) || (typeof v === 'number' && Number.isFinite(v))) && contract(d.firmware))) errors.push('invalid devices');
  const ids = new Set();
  const pins = new Set();
  if (Array.isArray(raw.devices)) for (const d of raw.devices) {
    if (!object(d) || !string(d.instance) || !string(d.part) || !Object.hasOwn(PARTS, d.part)) continue;
    if (ids.has(d.instance)) errors.push('duplicate device instance');
    ids.add(d.instance);
    for (const pin of PARTS[d.part].pins) pins.add(`${d.instance}:${pin.name}`);
  }
  if (!Array.isArray(raw.connections) || !Array.from(raw.connections).every(c => object(c) && typeof c.id === 'string' && string(c.a) && string(c.b) && typeof c.color === 'string' && (c.id === '' ? c.color === '' : string(c.color)) && strings(c.members) && c.members.every((/** @type {string} */ p) => pins.has(p)) && new Set(c.members).size === c.members.length)) errors.push('invalid connections');
  const selected = string(raw.profile) ? profileById(raw.profile) : undefined;
  const expected = selected ? Object.entries(selected).filter(([name]) => name !== 'id') : [];
  if (!selected || !Array.isArray(raw.resources) || raw.resources.length !== expected.length || !Array.from(raw.resources).every(r => object(r) && r.kind === 'profile' && string(r.name) && Object.hasOwn(r, 'value') && json(r.value)) || new Set(raw.resources.map((/** @type {any} */ r) => r.name)).size !== expected.length || !expected.every(([name, value]) => {
    const resource = raw.resources.find((/** @type {any} */ r) => r.name === name);
    return resource && JSON.stringify(canonical(resource.value)) === JSON.stringify(canonical(value));
  })) errors.push('invalid resources');
  if (!object(raw.firmware) || !strings(raw.firmware.libraries) || !strings(raw.firmware.actions) || !strings(raw.firmware.telemetry)) errors.push('invalid firmware');
  return errors;
}
