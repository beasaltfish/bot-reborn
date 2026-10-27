import test from 'node:test';
import assert from 'node:assert/strict';

import { screenById } from '../../core/screens.js';
import { emptyBench, addPart, addWire, removeWire } from '../../sim/bench.js';
import { targetFor } from '../../sim/target.js';
import { powerOn } from '../../sim/power.js';
import { diagnose } from '../../sim/diagnose.js';

/** @typedef {import('../../sim/bench.js').Bench} Bench */
/** @typedef {import('../../sim/power.js').Outcome} Outcome */

/** @param {Outcome} o @param {string} id @returns {string} */
const show = (o, id) => /** @type {any} */ (o.parts[id]).show;

/**
 * A screen point by its job, not its printing: some modules print SDI where
 * another prints MOSI. The instance is always the first screen, "scr".
 * @param {string} model @param {import('../../core/screens.js').PinRole} role
 */
function pin(model, role) {
  const screen = screenById(model);
  const found = screen?.pins.find((p) => p.role === role);
  assert.ok(found, `${model} has a ${role}`);
  return `scr:${found.silk}`;
}

/** The opening bench plus one screen, wired exactly as the diagram says. */
function benchWith(/** @type {string} */ model, wireIt = true) {
  let b = /** @type {Bench} */ ({ ...emptyBench(), usb: true });
  b = addPart(b, /** @type {any} */ (`screen-${model}`), { x: 0, z: 40 }).bench;
  if (wireIt) for (const l of targetFor(b)) b = addWire(b, l.a, l.b, 'red');
  return b;
}

/** Remove the wire that ends on this point. */
function unwire(/** @type {Bench} */ b, /** @type {string} */ point) {
  const w = b.wires.find((x) => x.a === point || x.b === point);
  return w ? removeWire(b, w.id) : b;
}

const codes = (/** @type {import('../../sim/power.js').Outcome} */ o) => o.faults.map((f) => f.code);

test('a screen wired as the diagram says is ready, and the audio is untouched', () => {
  const o = powerOn(benchWith('ili9341-ips'));
  assert.deepEqual(o.parts.scr, { kind: 'screen', show: 'ready' });
  assert.equal(o.screenModel, 'ili9341-ips');
  assert.equal(o.mic, 'ok');
  assert.equal(o.amp, 'ok');
  assert.deepEqual(codes(o), []);
});

test('with USB out every screen is off', () => {
  const b = { ...benchWith('ili9341-ips'), usb: false };
  assert.deepEqual(powerOn(b).parts.scr, { kind: 'screen', show: 'off' });
});

test('a screen with no VCC is dark, and says which wire is missing', () => {
  const o = powerOn(unwire(benchWith('ili9341-ips'), 'scr:VCC'));
  assert.deepEqual(o.parts.scr, { kind: 'screen', show: 'off' });
  assert.ok(codes(o).includes('screen-unpowered'));
  assert.equal(o.screenModel, null);
});

test('5V on a 3V3-only module burns it', () => {
  let b = unwire(benchWith('st7789-320'), 'scr:VCC');
  b = addWire(b, 'scr:VCC', 'esp:5V', 'red');
  const o = powerOn(b);
  assert.deepEqual(o.burns, ['scr']);
  assert.deepEqual(o.parts.scr, { kind: 'screen', show: 'off' });
  assert.deepEqual(codes(o), ['screen-5v']);
});

test('a 5V module fed 3V3 is not driven', () => {
  let b = unwire(benchWith('ili9341-ips'), 'scr:VCC');
  b = addWire(b, 'scr:VCC', 'esp:3V3', 'red');
  const o = powerOn(b);
  assert.deepEqual(o.parts.scr, { kind: 'screen', show: 'off' });
  assert.ok(codes(o).includes('screen-needs-5v'));
});

test('SCK and MOSI swapped is a white screen, named as swapped', () => {
  const sck = pin('ili9341-ips', 'SCK');
  const mosi = pin('ili9341-ips', 'MOSI');
  let b = unwire(unwire(benchWith('ili9341-ips'), sck), mosi);
  b = addWire(b, sck, 'esp:GPIO10', 'red');
  b = addWire(b, mosi, 'esp:GPIO11', 'red');
  const o = powerOn(b);
  assert.deepEqual(o.parts.scr, { kind: 'screen', show: 'white' });
  assert.deepEqual(codes(o), ['screen-spi-swapped']);
  const hint = diagnose(b, o).find((h) => h.kind === 'swapped');
  assert.match(hint?.text ?? '', /screen SCK/);
});

test('DC left off is a white screen', () => {
  const o = powerOn(unwire(benchWith('ili9341-ips'), pin('ili9341-ips', 'DC')));
  assert.deepEqual(o.parts.scr, { kind: 'screen', show: 'white' });
  assert.deepEqual(codes(o), ['screen-signal']);
});

test('RST on 3V3 is fine', () => {
  let b = unwire(benchWith('ili9341-ips'), 'scr:RST');
  b = addWire(b, 'scr:RST', 'esp:3V3', 'red');
  assert.equal(show(powerOn(b), 'scr'), 'ready');
});

test('CS tied to ground selects the screen all the time, which works', () => {
  const cs = pin('ili9341-ips', 'CS');
  let b = unwire(benchWith('ili9341-ips'), cs);
  b = addWire(b, cs, 'esp:GND', 'black');
  assert.equal(show(powerOn(b), 'scr'), 'ready');
});

test('a module with no CS pin is selected all the time', () => {
  assert.equal(show(powerOn(benchWith('st7789-240')), 'scr'), 'ready');
});

test('a CS on any other pin leaves the panel uninitialised', () => {
  const cs = pin('ili9341-ips', 'CS');
  let b = unwire(benchWith('ili9341-ips'), cs);
  b = addWire(b, cs, 'esp:GPIO21', 'red');
  const o = powerOn(b);
  assert.deepEqual(o.parts.scr, { kind: 'screen', show: 'white' });
  assert.deepEqual(codes(o), ['screen-cs']);
});

test('a backlight pin left floating follows the module', () => {
  // ST7789 boards pull the backlight on; ILI9341 boards do not.
  assert.equal(show(powerOn(unwire(benchWith('st7789-320'), 'scr:BLK')), 'scr'), 'ready');
  const dark = powerOn(unwire(benchWith('ili9341-ips'), 'scr:LED'));
  assert.deepEqual(dark.parts.scr, { kind: 'screen', show: 'dark' });
  assert.deepEqual(codes(dark), ['screen-backlight']);
});

test('a backlight on a GPIO lights the panel and warns', () => {
  let b = unwire(benchWith('ili9341-ips'), pin('ili9341-ips', 'BL'));
  b = addWire(b, pin('ili9341-ips', 'BL'), 'esp:GPIO21', 'red');
  const o = powerOn(b);
  assert.deepEqual(o.parts.scr, { kind: 'screen', show: 'ready' });
  assert.deepEqual(codes(o), ['bl-on-gpio']);
});

test('a backlight on ground is dark', () => {
  let b = unwire(benchWith('st7789-320'), 'scr:BLK');
  b = addWire(b, 'scr:BLK', 'esp:GND', 'black');
  assert.deepEqual(powerOn(b).parts.scr, { kind: 'screen', show: 'dark' });
});

test('two screens of one model both show the same picture', () => {
  let b = /** @type {Bench} */ ({ ...emptyBench(), usb: true });
  b = addPart(b, /** @type {any} */ ('screen-ili9341-ips'), { x: 0, z: 40 }).bench;
  b = addPart(b, /** @type {any} */ ('screen-ili9341-ips'), { x: 0, z: 60 }).bench;
  for (const l of targetFor(b)) b = addWire(b, l.a, l.b, 'red');
  const o = powerOn(b);
  assert.deepEqual([show(o, 'scr'), show(o, 'scr2')], ['ready', 'ready']);
  assert.equal(o.screenModel, 'ili9341-ips');
});

test('two screens of different models both garble, and say why', () => {
  let b = /** @type {Bench} */ ({ ...emptyBench(), usb: true });
  b = addPart(b, /** @type {any} */ ('screen-ili9341-ips'), { x: 0, z: 40 }).bench;
  b = addPart(b, /** @type {any} */ ('screen-st7789-320'), { x: 0, z: 60 }).bench;
  for (const l of targetFor(b)) b = addWire(b, l.a, l.b, 'red');
  const o = powerOn(b);
  assert.deepEqual([show(o, 'scr'), show(o, 'scr2')], ['garbage', 'garbage']);
  assert.ok(codes(o).includes('screens-mixed'));
  assert.equal(o.screenModel, null);
  const hint = diagnose(b, o).find((h) => /one kind of screen/.test(h.text));
  assert.match(hint?.text ?? '', /one kind of screen/);
});

test('a screen touching a GPIO that is also on a rail is a white screen', () => {
  // DC shorted onto 3V3: the pin is held high and the panel never gets data.
  const dc = pin('ili9341-ips', 'DC');
  let b = unwire(benchWith('ili9341-ips'), dc);
  b = addWire(b, dc, 'esp:3V3', 'red');
  const o = powerOn(b);
  assert.deepEqual(o.parts.scr, { kind: 'screen', show: 'white' });
  assert.ok(codes(o).includes('screen-bus-on-rail'));
});
