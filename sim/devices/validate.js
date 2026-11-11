/** @param {unknown} value @returns {value is Record<string, any>} */
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** @param {unknown} value @returns {value is any[]} */
const denseArray = (value) => Array.isArray(value) && Array.from({ length: value.length }, (_, i) => Object.hasOwn(value, i)).every(Boolean);
const pinFields = /** @type {Record<string, string[]>} */ ({
  supply: ['positive', 'ground'], source: ['pin'], regulator: ['input', 'output', 'ground'],
  gpio: ['pin'], pwm: ['pin'], i2c: ['sda', 'scl'], spi: ['sck', 'mosi'], oneWire: ['pin'],
  driver: ['inputs'], load: ['positive', 'negative'], resistor: ['positive', 'negative'], led: ['positive', 'negative'],
});

/** Validate untrusted catalogue data, returning every error in stable order.
 * @param {unknown} devices @param {unknown} parts @returns {string[]}
 */
export function validateDeviceCatalogue(devices, parts) {
  /** @type {string[]} */ const errors = [];
  /** @param {string} part @param {string} field @param {string} reason */
  const error = (part, field, reason) => errors.push(`${part}: ${field}: ${reason}`);
  if (!object(devices)) return ['catalogue: devices: expected object'];
  const partMap = object(parts) ? parts : {};
  for (const id of Object.keys(devices).sort()) {
    const d = devices[id];
    if (!object(d)) { error(id, 'device', 'expected object'); continue; }
    const part = Object.hasOwn(partMap, id) ? partMap[id] : undefined;
    for (const key of Object.keys(d)) if (!['part', 'category', 'summaryKey', 'tags', 'properties', 'capabilities', 'firmware'].includes(key)) error(id, key, 'unexpected field');
    if (!object(part)) error(id, 'part', 'unknown part');
    if (d.part !== id) error(id, 'part', 'must match catalogue key');
    for (const field of ['category', 'summaryKey']) if (typeof d[field] !== 'string' || !d[field]) error(id, field, 'expected nonempty string');
    if (!denseArray(d.tags) || d.tags.some((/** @type {unknown} */ v) => typeof v !== 'string')) error(id, 'tags', 'expected string array');
    if (!object(d.properties)) error(id, 'properties', 'expected object');
    else for (const name of Object.keys(d.properties).sort()) {
      const p = d.properties[name], field = `properties.${name}`;
      if (!object(p)) { error(id, field, 'expected object'); continue; }
      if (p.kind === 'number') {
        for (const key of ['default', 'min', 'max', 'step']) if ((key === 'default' || p[key] !== undefined) && (typeof p[key] !== 'number' || !Number.isFinite(p[key]))) error(id, `${field}.${key}`, 'expected finite number');
        if (typeof p.min === 'number' && typeof p.max === 'number' && p.min > p.max) error(id, `${field}.min`, 'exceeds max');
        if (typeof p.step === 'number' && p.step <= 0) error(id, `${field}.step`, 'must be positive');
        if (typeof p.default === 'number' && ((typeof p.min === 'number' && p.default < p.min) || (typeof p.max === 'number' && p.default > p.max))) error(id, `${field}.default`, 'outside range');
        if (p.unit !== undefined && typeof p.unit !== 'string') error(id, `${field}.unit`, 'expected string');
      } else if (p.kind === 'enum') {
        if (!denseArray(p.values) || !p.values.length || p.values.some((/** @type {unknown} */ v) => typeof v !== 'string')) error(id, `${field}.values`, 'expected nonempty string array');
        if (!denseArray(p.values) || !p.values.includes(p.default)) error(id, `${field}.default`, 'must be one of values');
      } else if (p.kind === 'boolean') {
        if (typeof p.default !== 'boolean') error(id, `${field}.default`, 'expected boolean');
      } else error(id, `${field}.kind`, 'unknown property kind');
    }
    const pins = new Set(denseArray(part?.pins) ? part.pins.map((/** @type {any} */ p) => p?.name) : []);
    if (!denseArray(d.capabilities)) error(id, 'capabilities', 'expected array');
    else d.capabilities.forEach((/** @type {any} */ cap, /** @type {number} */ i) => {
      const field = `capabilities[${i}]`;
      if (!object(cap) || typeof cap.kind !== 'string' || !Object.hasOwn(pinFields, cap.kind)) { error(id, `${field}.kind`, 'unknown capability kind'); return; }
      const fields = [...pinFields[cap.kind], ...(cap.kind === 'spi' && cap.cs !== undefined ? ['cs'] : [])];
      /** @type {string[]} */ const used = [];
      for (const key of fields) {
        const values = key === 'inputs' ? cap[key] : [cap[key]];
        if (!denseArray(values) || !values.length) { error(id, `${field}.${key}`, 'expected pin array'); continue; }
        for (const value of values) {
          if (typeof value !== 'string' || !pins.has(value)) error(id, `${field}.${key}`, typeof value === 'string' ? `unknown pin ${value}` : 'unknown pin (expected string)');
          else if (used.includes(value)) error(id, `${field}.${key}`, `duplicate pin ${value}`);
          else used.push(value);
        }
      }
    });
    if (!object(d.firmware)) error(id, 'firmware', 'expected object');
    else {
      for (const field of ['libraries', 'resources', 'actions', 'telemetry']) {
        const value = d.firmware[field];
        if (!denseArray(value) || value.some((/** @type {unknown} */ v) => field === 'resources' ? !object(v) || typeof v.kind !== 'string' : typeof v !== 'string')) error(id, `firmware.${field}`, `expected ${field === 'resources' ? 'resource' : 'string'} array`);
      }
      if (!object(d.firmware.init)) error(id, 'firmware.init', 'expected object');
    }
  }
  return errors.sort();
}
