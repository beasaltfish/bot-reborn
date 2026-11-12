// Firmware assignments come from firmware/main/board.h and sim/target.js.
import { SCREENS } from '../../core/screens.js';
import { PARTS } from '../parts.js';
import { nets } from '../netlist.js';
import { DEVICES, firmwareIndependent } from './catalog.js';
import { bme280Wiring } from './bme280-wiring.js';

/** @typedef {{ code: string, instances: string[], points: string[], detail: Record<string, unknown> }} ResourceIssue */
/** @typedef {{ id: string, rails: Record<string, number>, gpioVoltage: number, adcPins: string[], i2cBuses: {id:string,sda:string,scl:string}[], spiBuses: {id:string,sck:string,mosi:string,miso:string}[], pwmPins: string[], pwmChannels: number, endpoints: Record<string, Record<string, string|number>>, supportedParts: string[] }} Profile */
// Exclude strapping pins and GPIO46 (input-only); GPIO19/20 are USB pins.
const exposed = PARTS.esp32.pins.map((p) => p.name).filter((p) => /^GPIO\d+$/.test(p));
const reserved = new Set(['GPIO0', 'GPIO3', 'GPIO19', 'GPIO20', 'GPIO45', 'GPIO46']);
/** @type {Profile[]} */
export const PROFILES = [{
  id: 'esp32-s3-bot-reborn', rails: { '3V3': 3.3, '5V': 5 }, gpioVoltage: 3.3,
  adcPins: exposed.filter((pin) => Number(pin.slice(4)) >= 1 && Number(pin.slice(4)) <= 20),
  i2cBuses: [{ id: 'i2c0', sda: 'GPIO1', scl: 'GPIO2' }],
  spiBuses: [{ id: 'spi2', sck: 'GPIO11', mosi: 'GPIO10', miso: 'GPIO17' }],
  pwmPins: exposed.filter((pin) => !reserved.has(pin)), pwmChannels: 8,
  endpoints: {
    audio: { bclk: 'GPIO12', ws: 'GPIO13', dout: 'GPIO14', din: 'GPIO15' },
    screen: { sck: 'GPIO11', mosi: 'GPIO10', cs: 'GPIO9', dc: 'GPIO8', rst: 'GPIO18', miso: 'GPIO17' },
    wand: { sda: 'GPIO1', scl: 'GPIO2', address: 0x68 },
    toy: { driveA: 'GPIO4', driveB: 'GPIO5', steerA: 'GPIO6', steerB: 'GPIO7' },
  }, supportedParts: ['esp32', 'inmp441', 'max98357a', 'speaker', 'mpu6050', 'toy', ...SCREENS.map((screen) => `screen-${screen.id}`)].sort(),
}];
/** @param {string} id @returns {Profile | undefined} */
export function profileById(id) { return PROFILES.find((p) => p.id === id); }

/** @param {unknown} value @returns {number | undefined} */
function addressNumber(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^(?:0x[\da-f]+|\d+)$/i.test(value))) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 0x7f ? n : undefined;
}

/**
 * Check resource use against the actual nets, not expected wiring.
 * @param {import('../bench.js').Bench} bench
 * @param {Profile} profile
 * @param {Record<string, import('./catalog.js').DeviceDef>} devices
 * @returns {ResourceIssue[]}
 */
export function checkResources(bench, profile, devices) {
  const net = nets(bench);
  /** @type {ResourceIssue[]} */ const issues = [];
  /** @type {{instance:string, sda:string, scl:string, address:number}[]} */ const i2c = [];
  /** @type {{instance:string, sck:string, mosi:string, cs:string}[]} */ const spi = [];
  /** @type {{instance:string, point:string, kind:string, direction:unknown}[]} */ const pins = [];
  for (const p of bench.placed.filter((p) => !p.burnt).sort((a, b) => a.id.localeCompare(b.id))) {
    const d = devices[p.part];
    if (!firmwareIndependent(p.part) && !profile.supportedParts.includes(p.part)) issues.push({ code: 'firmware-unsupported', instances: [p.id], points: [], detail: { part: p.part } });
    if (!d) continue;
    for (const cap of d.capabilities) {
      const point = (/** @type {string} */ pin) => `${p.id}:${pin}`;
      if (cap.kind === 'i2c') {
        pins.push({ instance: p.id, point: point(cap.sda), kind: 'i2c:sda', direction: undefined }, { instance: p.id, point: point(cap.scl), kind: 'i2c:scl', direction: undefined });
        const need = d.firmware.resources.find((r) => r.kind === 'i2c');
        const configured = addressNumber(typeof need?.addressProperty === 'string' ? p.properties[need.addressProperty] : (need?.address ?? (p.part === 'mpu6050' ? profile.endpoints.wand?.address : undefined)));
        const address = p.part === 'bme280-i2c' && d === DEVICES['bme280-i2c'] ? bme280Wiring(bench, p.id).address ?? undefined : configured;
        if (address !== undefined) i2c.push({ instance: p.id, sda: point(cap.sda), scl: point(cap.scl), address });
      } else if (cap.kind === 'spi') {
        pins.push({ instance: p.id, point: point(cap.sck), kind: 'spi:sck', direction: undefined }, { instance: p.id, point: point(cap.mosi), kind: 'spi:mosi', direction: undefined });
        if (cap.cs) {
          pins.push({ instance: p.id, point: point(cap.cs), kind: 'spi:cs', direction: undefined });
          spi.push({ instance: p.id, sck: point(cap.sck), mosi: point(cap.mosi), cs: point(cap.cs) });
        }
      }
      else if (cap.kind === 'gpio' || cap.kind === 'pwm' || cap.kind === 'oneWire') {
        const need = d.firmware.resources.find((r) => r.kind === cap.kind && (r.pin === undefined || r.pin === cap.pin));
        pins.push({ instance: p.id, point: point(cap.pin), kind: cap.kind, direction: need?.direction });
      } else if (cap.kind === 'driver') for (const pin of cap.inputs) pins.push({ instance: p.id, point: point(pin), kind: 'gpio', direction: 'input' });
    }
  }
  /** @param {string} code @param {string[]} instances @param {string[]} points @param {Record<string, unknown>} detail */
  const add = (code, instances, points, detail) => issues.push({ code, instances: instances.sort(), points: points.sort(), detail });
  for (let a = 0; a < i2c.length; a++) for (let b = a + 1; b < i2c.length; b++) {
    const x = i2c[a], y = i2c[b];
    if (x.instance !== y.instance && x.address === y.address && net.same(x.sda, y.sda) && net.same(x.scl, y.scl)) add('i2c-address-conflict', [x.instance, y.instance], [x.sda, x.scl, y.sda, y.scl], { address: x.address });
  }
  for (let a = 0; a < spi.length; a++) for (let b = a + 1; b < spi.length; b++) {
    const x = spi[a], y = spi[b];
    if (x.instance !== y.instance && net.same(x.sck, y.sck) && net.same(x.mosi, y.mosi) && net.same(x.cs, y.cs)) add('spi-chip-select-conflict', [x.instance, y.instance], [x.cs, y.cs], {});
  }
  for (let a = 0; a < pins.length; a++) for (let b = a + 1; b < pins.length; b++) {
    const x = pins[a], y = pins[b];
    if (x.point !== y.point && net.same(x.point, y.point) && !(x.kind === y.kind && (x.kind.startsWith('i2c:') || x.kind.startsWith('spi:'))) && !(x.kind === 'gpio' && y.kind === 'gpio' && x.direction === 'input' && y.direction === 'input')) add('resource-pin-conflict', [x.instance, y.instance], [x.point, y.point], { kinds: [x.kind, y.kind] });
  }
  return issues.sort((a, b) => a.code.localeCompare(b.code) || a.instances.join('\0').localeCompare(b.instances.join('\0')) || a.points.join('\0').localeCompare(b.points.join('\0')));
}
