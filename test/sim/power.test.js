import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyBench, addPart, place, trash, addWire, removeWire } from '../../sim/bench.js';
import { TARGET } from '../../sim/target.js';
import { powerOn } from '../../sim/power.js';

/** @typedef {import('../../sim/bench.js').Bench} Bench */

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

/** The same links, renamed for another instance ("mic:" → "mic2:"). */
const rename = (/** @type {{ a: string, b: string }[]} */ links, /** @type {string} */ from, /** @type {string} */ to) =>
  links.map((l) => ({ a: l.a.replace(from, to), b: l.b.replace(from, to) }));

const codes = (/** @type {import('../../sim/power.js').Outcome} */ o) => o.faults.map((f) => f.code);

test('the full target wiring works', () => {
  assert.deepEqual(powerOn(wired()), {
    esp: 'ok', mic: 'ok', amp: 'ok', burns: [], faults: [], screenModel: null,
    parts: {
      mic: { kind: 'mic', path: 'ok' },
      amp: { kind: 'amp', path: 'ok' },
      spk: { kind: 'speaker', playing: true },
    },
  });
});

test('without USB nothing is on', () => {
  const o = powerOn(wired(TARGET, false));
  assert.deepEqual([o.esp, o.mic, o.amp, o.burns], ['off', 'silent', 'silent', []]);
  assert.deepEqual(o.parts.spk, { kind: 'speaker', playing: false });
  assert.equal(o.screenModel, null);
});

test('a short between the supply pins browns the ESP out', () => {
  for (const [x, y] of [['esp:3V3', 'esp:GND'], ['esp:5V', 'esp:GND.2'], ['esp:3V3.2', 'esp:5V']]) {
    const o = powerOn(addWire(wired(), x, y, 'red'));
    assert.equal(o.esp, 'brownout');
    assert.deepEqual([o.mic, o.amp, o.burns], ['silent', 'silent', []]);
    assert.deepEqual(codes(o), ['short-rails']);
    assert.deepEqual(o.parts.mic, { kind: 'mic', path: 'silent' });
  }
});

test('mic VDD on 5V burns the mic', () => {
  const o = powerOn(without('mic:VDD', 'esp:5V'));
  assert.deepEqual(o.burns, ['mic']);
  assert.equal(o.mic, 'silent');
  assert.deepEqual(codes(o), ['mic-5v']);
  assert.equal(o.amp, 'ok');
});

test('a burnt mic stays dead across power cycles until it is replaced', () => {
  let b = without('mic:VDD', 'esp:5V');
  assert.deepEqual(powerOn(b).burns, ['mic']);
  b = { ...b, placed: b.placed.map((p) => (p.id === 'mic' ? { ...p, burnt: true } : p)) };
  const fixed = b.wires.find((w) => w.a === 'mic:VDD');
  b = addWire(removeWire(b, /** @type {any} */ (fixed).id), 'mic:VDD', 'esp:3V3', 'red');
  const o = powerOn(b);
  assert.equal(o.mic, 'silent');
  assert.deepEqual(o.burns, []);
  assert.deepEqual(codes(o), ['mic-burnt']);

  assert.deepEqual(o.parts.mic, { kind: 'mic', path: 'silent' });

  // The bin takes the dead one; a fresh mic takes the same id back, and is
  // wired up again from scratch.
  b = /** @type {Bench} */ (trash(b, 'mic'));
  b = addPart(b, 'inmp441', { x: 29, z: 17.5 }).bench;
  const fresh = /** @type {any} */ (b.placed.find((p) => p.id === 'mic'));
  assert.equal(fresh.burnt, false);
  for (const l of TARGET.filter((l) => l.a.startsWith('mic:'))) b = addWire(b, l.a, l.b, 'red');
  assert.equal(powerOn(b).mic, 'ok');
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

test('swapped clock wires make every chip on the bus noise', () => {
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
  assert.deepEqual(o.parts.amp, { kind: 'amp', path: 'quiet' });
  assert.deepEqual(o.parts.spk, { kind: 'speaker', playing: true }, 'quiet still plays');
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
    assert.deepEqual(o.parts.spk, { kind: 'speaker', playing: false });
  }
});

test('a speaker wired the other way round still plays', () => {
  const links = TARGET.map(({ a, b }) => ({ a, b: a === 'spk:+' ? 'amp:-' : a === 'spk:-' ? 'amp:+' : b }));
  const o = powerOn(wired(links));
  assert.equal(o.amp, 'ok');
  assert.deepEqual(o.parts.spk, { kind: 'speaker', playing: true });
});

test('two bus pins in one net make every chip touching it noise', () => {
  const o = powerOn(addWire(wired(), 'esp:GPIO14', 'esp:GPIO15', 'red'));
  assert.deepEqual([o.mic, o.amp], ['noise', 'noise']);
  assert.ok(codes(o).includes('pins-shorted'));
});

test('a module straddling one strip shorts its own pins', () => {
  // Both rows in the a–e half: L/R and SD share a strip, so SD sits on ground.
  let b = wired(TARGET.filter((l) => !l.a.startsWith('mic:')));
  b = place(b, 'mic', { x: -12, z: -6 }, 0, true);
  const o = powerOn(b);
  assert.equal(o.mic, 'silent');
});

test('a bus pin on a rail is a fault, not a working bench', () => {
  // Everything per TARGET, but a wire ties the mic's WS pin to ground, and WS
  // is also on GPIO 13: that GPIO is held at ground.
  const links = TARGET.filter((l) => l.a !== 'mic:L/R').map(({ a, b }) => ({ a, b }));
  const o = powerOn(addWire(wired(links), 'mic:WS', 'esp:GND', 'red'));
  assert.equal(o.amp, 'silent');
  assert.equal(o.mic, 'silent');
  assert.ok(codes(o).includes('bus-on-rail'));
});

test('two mics on the same data line make noise, and the fault says why', () => {
  let b = addPart(wired(), 'inmp441', { x: 0, z: 30 }).bench;
  for (const l of rename(TARGET.filter((l) => l.a.startsWith('mic:')), 'mic:', 'mic2:')) {
    b = addWire(b, l.a, l.b, 'blue');
  }
  const o = powerOn(b);
  assert.equal(o.mic, 'noise');
  assert.ok(codes(o).includes('mics-same-slot'));
  // Both mics are individually fine; it is the pair that is not.
  assert.deepEqual(o.parts.mic, { kind: 'mic', path: 'ok' });
  assert.deepEqual(o.parts.mic2, { kind: 'mic', path: 'ok' });
});

test('a second mic in the right slot leaves the left one alone', () => {
  let b = addPart(wired(), 'inmp441', { x: 0, z: 30 }).bench;
  for (const l of rename(TARGET.filter((l) => l.a.startsWith('mic:')), 'mic:', 'mic2:')) {
    const to = l.a === 'mic2:L/R' ? 'esp:3V3' : l.b;
    b = addWire(b, l.a, to, 'blue');
  }
  const o = powerOn(b);
  assert.equal(o.mic, 'ok');
  assert.ok(!codes(o).includes('mics-same-slot'));
});

test('the best amp is the one the downlink uses', () => {
  // The opening amp is left unpowered; a second amp and speaker are wired in.
  let b = addPart(wired(TARGET.filter((l) => !l.a.startsWith('amp:'))), 'max98357a', { x: 0, z: 34 }).bench;
  b = addPart(b, 'speaker', { x: -20, z: 34 }).bench;
  for (const l of TARGET.filter((l) => l.a.startsWith('amp:'))) {
    b = addWire(b, l.a.replace('amp:', 'amp2:'), l.b, 'blue');
  }
  for (const l of TARGET.filter((l) => l.a.startsWith('spk:'))) {
    b = addWire(b, l.a.replace('spk:', 'spk2:'), l.b.replace('amp:', 'amp2:'), 'blue');
  }
  const o = powerOn(b);
  assert.equal(o.amp, 'ok');
  assert.deepEqual(o.parts.spk2, { kind: 'speaker', playing: true });
  assert.deepEqual(o.parts.spk, { kind: 'speaker', playing: false }, 'the opening amp has no power');
  assert.deepEqual(o.parts.amp2, { kind: 'amp', path: 'ok' });
});
