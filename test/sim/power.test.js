import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyBench, place, addWire, removeWire, swapBurnt } from '../../sim/bench.js';
import { TARGET } from '../../sim/target.js';
import { powerOn } from '../../sim/power.js';

/** The firmware's wiring, as wires between pins (parts stay on the table). */
function wired(/** @type {{ a: string, b: string }[]} */ links = TARGET, usb = true) {
  let b = { ...emptyBench(), usb };
  for (const l of links) b = addWire(b, l.a, l.b, 'red');
  return b;
}

/** TARGET with one link's far end replaced, or dropped when `to` is null. */
function without(/** @type {string} */ a, /** @type {string | null} */ to = null) {
  const links = TARGET.filter((l) => l.a !== a).map(({ a, b }) => ({ a, b }));
  return wired(to ? [...links, { a, b: to }] : links);
}

const codes = (/** @type {import('../../sim/power.js').Outcome} */ o) => o.faults.map((f) => f.code);

test('the full target wiring works', () => {
  assert.deepEqual(powerOn(wired()), { esp: 'ok', mic: 'ok', amp: 'ok', burns: [], faults: [] });
});

test('without USB nothing is on', () => {
  const o = powerOn(wired(TARGET, false));
  assert.deepEqual([o.esp, o.mic, o.amp, o.burns], ['off', 'silent', 'silent', []]);
});

test('a short between the supply pins browns the ESP out', () => {
  for (const [x, y] of [['esp:3V3', 'esp:GND'], ['esp:5V', 'esp:GND.2'], ['esp:3V3.2', 'esp:5V']]) {
    const o = powerOn(addWire(wired(), x, y, 'red'));
    assert.equal(o.esp, 'brownout');
    assert.deepEqual([o.mic, o.amp, o.burns], ['silent', 'silent', []]);
    assert.deepEqual(codes(o), ['short-rails']);
  }
});

test('mic VDD on 5V burns the mic', () => {
  const o = powerOn(without('mic:VDD', 'esp:5V'));
  assert.deepEqual(o.burns, ['mic']);
  assert.equal(o.mic, 'silent');
  assert.deepEqual(codes(o), ['mic-5v']);
  assert.equal(o.amp, 'ok');
});

test('burnt mic stays burnt across power cycles', () => {
  let b = without('mic:VDD', 'esp:5V');
  assert.deepEqual(powerOn(b).burns, ['mic']);
  b = { ...b, placed: b.placed.map((p) => (p.id === 'mic' ? { ...p, burnt: true } : p)) };
  const fixed = b.wires.find((w) => w.a === 'mic:VDD');
  b = addWire(removeWire(b, /** @type {any} */ (fixed).id), 'mic:VDD', 'esp:3V3', 'red');
  const o = powerOn(b);
  assert.equal(o.mic, 'silent');
  assert.deepEqual(o.burns, []);
  assert.deepEqual(codes(o), ['mic-burnt']);

  // The fresh mic is on the table; its wires still reach it by point id.
  b = swapBurnt(b, 'mic');
  assert.equal(powerOn(b).mic, 'ok');
  // Placed in the breadboard across the centre gap, clear of the wires' strips, it is still fine.
  b = place(b, 'mic', { x: 40, y: 7 }, 0);
  assert.deepEqual(powerOn(b), { esp: 'ok', mic: 'ok', amp: 'ok', burns: [], faults: [] });
});

test('a mic missing power or ground is unpowered', () => {
  for (const a of ['mic:VDD', 'mic:GND']) {
    const o = powerOn(without(a));
    assert.equal(o.mic, 'silent');
    assert.ok(codes(o).includes('mic-unpowered'));
  }
  assert.deepEqual(codes(powerOn(without('mic:VDD', 'esp:GND'))), ['mic-unpowered']);
});

test('L/R floating or on 3V3 picks the wrong slot', () => {
  for (const to of [null, 'esp:3V3']) {
    const o = powerOn(without('mic:L/R', to));
    assert.equal(o.mic, 'silent');
    assert.deepEqual(codes(o), ['mic-right-slot']);
  }
});

test('swapped clock wires make both chips noise', () => {
  const links = TARGET.map(({ a, b }) => ({ a, b: a === 'mic:SCK' ? 'esp:GPIO13' : a === 'mic:WS' ? 'esp:GPIO12' : b }));
  const o = powerOn(wired(links));
  assert.deepEqual([o.mic, o.amp], ['noise', 'noise']);
  assert.ok(codes(o).includes('clocks-swapped'));
});

test('a missing clock silences only the chip it is missing on', () => {
  const o = powerOn(without('amp:BCLK'));
  assert.deepEqual([o.mic, o.amp], ['ok', 'silent']);
  assert.deepEqual(codes(o), ['clock-missing']);
  const m = powerOn(without('mic:WS'));
  assert.deepEqual([m.mic, m.amp], ['silent', 'ok']);
});

test('mic data not on GPIO15 is silent', () => {
  const o = powerOn(without('mic:SD', 'esp:GPIO14'));
  assert.equal(o.mic, 'silent');
  assert.deepEqual(codes(o), ['mic-data']);
});

test('amp on 3V3 is quiet, not silent', () => {
  const o = powerOn(without('amp:Vin', 'esp:3V3'));
  assert.deepEqual([o.amp, o.faults], ['quiet', []]);
});

test('amp with no supply is unpowered', () => {
  const o = powerOn(without('amp:Vin'));
  assert.equal(o.amp, 'silent');
  assert.deepEqual(codes(o), ['amp-unpowered']);
});

test('amp data not on GPIO14 is silent', () => {
  const o = powerOn(without('amp:DIN', 'esp:GPIO15'));
  assert.equal(o.amp, 'silent');
  assert.ok(codes(o).includes('amp-data'));
});

test('amp SD tied to ground shuts the amp down', () => {
  const o = powerOn(addWire(wired(), 'amp:SD', 'esp:GND.2', 'black'));
  assert.equal(o.amp, 'silent');
  assert.deepEqual(codes(o), ['amp-shutdown']);
  // Tied high it stays on.
  assert.equal(powerOn(addWire(wired(), 'amp:SD', 'esp:3V3', 'red')).amp, 'ok');
});

test('a speaker not on the amp terminals is silent', () => {
  for (const o of [powerOn(without('spk:+')), powerOn(without('spk:-', 'amp:+'))]) {
    assert.equal(o.amp, 'silent');
    assert.deepEqual(codes(o), ['speaker']);
  }
});

test('a speaker wired the other way round still plays', () => {
  const links = TARGET.map(({ a, b }) => ({ a, b: a === 'spk:+' ? 'amp:-' : a === 'spk:-' ? 'amp:+' : b }));
  assert.equal(powerOn(wired(links)).amp, 'ok');
});

test('two bus pins in one net make every chip touching it noise', () => {
  const o = powerOn(addWire(wired(), 'esp:GPIO14', 'esp:GPIO15', 'red'));
  assert.deepEqual([o.mic, o.amp], ['noise', 'noise']);
  assert.ok(codes(o).includes('pins-shorted'));
});

test('a module straddling one strip shorts its own pins', () => {
  // Both rows in the a–e half: L/R and SD share a strip, so SD sits on ground.
  let b = wired(TARGET.filter((l) => !l.a.startsWith('mic:')));
  b = place(b, 'mic', { x: 19, y: 3 }, 0);
  const o = powerOn(b);
  assert.equal(o.mic, 'silent');
});
