// Declarative descriptions only. The existing power rules remain authoritative.
import { SCREENS } from '../../core/screens.js';

/** @typedef {{ kind: 'number', default: number, min?: number, max?: number, step?: number, unit?: string } | { kind: 'enum', default: string, values: string[] } | { kind: 'boolean', default: boolean }} PropertyDef */
/** @typedef {{ kind: 'supply', positive: string, ground: string } | { kind: 'source', pin: string } | { kind: 'regulator', input: string, output: string, ground: string } | { kind: 'gpio' | 'pwm' | 'oneWire', pin: string } | { kind: 'i2c', sda: string, scl: string } | { kind: 'spi', sck: string, mosi: string, cs?: string } | { kind: 'driver', inputs: string[] } | { kind: 'load' | 'resistor' | 'led', positive: string, negative: string }} Capability */
/** @typedef {{ kind: string, [key: string]: unknown }} ResourceNeed */
/** @typedef {{ part: string, category: string, summaryKey: string, tags: string[], properties: Record<string, PropertyDef>, capabilities: Capability[], firmware: { libraries: string[], resources: ResourceNeed[], init: Record<string, unknown>, actions: string[], telemetry: string[] } }} DeviceDef */

/** @param {string} part @param {string} category @param {Capability[]} capabilities @returns {DeviceDef} */
function device(part, category, capabilities) {
  return { part, category, summaryKey: part, tags: [], properties: {}, capabilities,
    firmware: { libraries: [], resources: [], init: {}, actions: [], telemetry: [] } };
}

/** @type {Record<string, DeviceDef>} */
export const DEVICES = {
  'led-5mm': { ...device('led-5mm', 'output', [{ kind: 'led', positive: 'A', negative: 'K' }]), properties: { color: { kind: 'enum', default: 'red', values: ['red'] } } },
  resistor: { ...device('resistor', 'fundamental', [{ kind: 'resistor', positive: '1', negative: '2' }]), properties: { ohms: { kind: 'number', default: 220, min: 1, max: 10000000, unit: 'Ω' } } },
  'dc-source': { ...device('dc-source', 'power', []), properties: { voltage: { kind: 'number', default: 5, min: 0, max: 12, unit: 'V' }, currentLimitMa: { kind: 'number', default: 500, min: 1, max: 5000, unit: 'mA' }, internalResistanceOhm: { kind: 'number', default: 0.2, min: 0, max: 10, unit: 'Ω' } } },
  esp32: device('esp32', 'controller', [
    { kind: 'source', pin: '3V3' }, { kind: 'source', pin: '5V' },
  ]),
  inmp441: device('inmp441', 'audio', [{ kind: 'supply', positive: 'VDD', ground: 'GND' }]),
  max98357a: device('max98357a', 'audio', [{ kind: 'supply', positive: 'Vin', ground: 'GND' }, { kind: 'driver', inputs: ['DIN', 'BCLK', 'LRC'] }]),
  speaker: device('speaker', 'audio', [{ kind: 'load', positive: '+', negative: '-' }]),
  mpu6050: device('mpu6050', 'sensor', [{ kind: 'supply', positive: 'VCC', ground: 'GND' }, { kind: 'i2c', sda: 'SDA', scl: 'SCL' }]),
  toy: device('toy', 'actuator', [{ kind: 'driver', inputs: ['U3A', 'U3B', 'U5A', 'U5B'] }]),
};
for (const screen of SCREENS) {
  const part = `screen-${screen.id}`;
  /** @param {import('../../core/screens.js').PinRole} role */
  const pin = (role) => screen.pins.find((p) => p.role === role)?.silk;
  /** @type {Capability[]} */
  const capabilities = [];
  const positive = pin('VCC'), ground = pin('GND'), sck = pin('SCK'), mosi = pin('MOSI'), cs = pin('CS');
  if (positive && ground) capabilities.push({ kind: 'supply', positive, ground });
  if (sck && mosi) capabilities.push({ kind: 'spi', sck, mosi, ...(cs ? { cs } : {}) });
  DEVICES[part] = device(part, 'display', capabilities);
}

/** @param {string} partId @returns {DeviceDef | undefined} */
export function deviceByPart(partId) { return Object.hasOwn(DEVICES, partId) ? DEVICES[partId] : undefined; }
