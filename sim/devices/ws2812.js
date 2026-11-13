// WS2812/NeoPixel strip: 5 V supply, common ground and a one-wire data input.
// Pixel colours are session-only bounded stimuli.
import { nets } from '../netlist.js';
import { PARTS } from '../parts.js';
import { boundedPixels, evaluateOneWire, stripCurrent } from '../electrical/one-wire.js';

/**
 * @param {import('../bench.js').Bench} bench
 * @param {import('../devices/profiles.js').Profile} profile
 * @param {{controllerPowered?:boolean, electrical?:any}} electrical
 * @param {any} [stimuli]
 */
export function evaluateWs2812(bench, profile, { controllerPowered = false, electrical = null } = {}, stimuli = {}) {
  const network = nets(bench);
  const board = bench.placed.find(part => part.part === 'esp32' && !part.burnt);
  /** @type {Record<string, any>} */ const parts = {};
  /** @type {import('../electrical/supply.js').ElectricalFault[]} */ const faults = [];
  const addFault = (/** @type {string} */ code, /** @type {import('../electrical/supply.js').ElectricalFault['severity']} */ severity, /** @type {string[]} */ instances, /** @type {string[]} */ points, /** @type {Record<string, number>} */ values = {}) => {
    faults.push({ code, severity, instances: [...new Set(instances)].sort(), points: [...new Set(points)].sort(), values });
  };
  if (!board) return { parts, faults };
  for (const strip of bench.placed.filter(part => !part.burnt && part.part === 'ws2812-strip')) {
    const vcc = `${strip.id}:5V`, gnd = `${strip.id}:GND`, din = `${strip.id}:DIN`, dout = `${strip.id}:DOUT`;
    const boardGround = network.same(gnd, `${board.id}:GND`);
    const gpioPins = PARTS.esp32.pins.map(pin => pin.name).filter(name => /^GPIO\d+$/.test(name));
    const dataPin = gpioPins.find(name => network.same(din, `${board.id}:${name}`)) ?? null;
    const outputPin = gpioPins.find(name => network.same(dout, `${board.id}:${name}`)) ?? null;
    const dataPoint = dataPin ? `${board.id}:${dataPin}` : null;
    let powered = false, voltage = 0, supplyNet = network.netOf(vcc);
    if (network.same(vcc, `${board.id}:5V`)) { powered = controllerPowered; voltage = profile.rails?.['5V'] ?? 0; }
    else {
      const rail = electrical?.rails?.[network.netOf(vcc)];
      if (rail && rail.voltage > 0) { powered = true; voltage = rail.voltage; }
    }
    const pixels = boundedPixels(stimuli?.strip?.[strip.id]?.pixels, Number(strip.properties.pixels) || 1);
    const currentMa = powered && boardGround ? stripCurrent(pixels) : 0;
    const oneWire = evaluateOneWire(profile, { id: strip.id, point: dataPoint, pin: dataPin, output: true });
    faults.push(...oneWire.faults);
    if (!powered) addFault('device-unpowered', 'info', [strip.id], [vcc, gnd], {});
    if (!boardGround) addFault('source-ground-missing', 'warning', [strip.id, board.id], [gnd, `${board.id}:GND`], {});
    if (outputPin && !dataPin) addFault('onewire-data-direction', 'warning', [strip.id], [din, dout], {});
    if (Number(strip.properties.pixels) > 60) addFault('unsupported-electrical-network', 'warning', [strip.id], [vcc], {});
    let state = 'off';
    if (!powered || !boardGround) state = 'off';
    else if (!dataPin) state = 'no-data';
    else if (oneWire.state === 'level-incompatible') state = 'level-incompatible';
    else if (pixels.length === 0) state = 'ready';
    else state = 'active';
    const rail = electrical?.rails?.[network.netOf(vcc)];
    const overcurrent = rail?.currentLimitMa !== undefined && currentMa > rail.currentLimitMa;
    if (powered && overcurrent) { state = 'brownout'; addFault('rail-brownout', 'warning', [strip.id], [vcc, gnd], { currentMa, currentLimitMa: rail?.currentLimitMa ?? 0 }); }
    parts[strip.id] = { state, pixels: pixels.length, currentMa, supplyVoltage: powered ? voltage : 0, supplyNet };
  }
  return { parts, faults };
}
