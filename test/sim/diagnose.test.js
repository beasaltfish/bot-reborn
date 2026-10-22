import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyBench, place, addWire } from '../../sim/bench.js';
import { TARGET } from '../../sim/target.js';
import { powerOn } from '../../sim/power.js';
import { diagnose, nextHint } from '../../sim/diagnose.js';

/** @param {{ a: string, b: string }[]} links */
function wired(links = TARGET) {
  let b = { ...emptyBench(), usb: true };
  for (const l of links) b = addWire(b, l.a, l.b, 'red');
  return b;
}

/** TARGET minus the links starting at `drop`, plus `extra`. */
function tweak(/** @type {string[]} */ drop, /** @type {[string, string][]} */ extra = []) {
  return [...TARGET.filter((l) => !drop.includes(l.a)), ...extra.map(([a, b]) => ({ a, b }))];
}

test('GPIO 12 and 13 wired to each other\'s pins is called swapped', () => {
  const b = wired(tweak(['mic:SCK', 'mic:WS'], [['mic:SCK', 'esp:GPIO13'], ['mic:WS', 'esp:GPIO12']]));
  const [first] = diagnose(b, powerOn(b));
  assert.equal(first.kind, 'swapped');
  for (const s of ['SCK', 'WS', 'GPIO 12', 'GPIO 13']) assert.match(first.text, new RegExp(s));
  assert.deepEqual(first.points.sort(), ['esp:GPIO12', 'esp:GPIO13', 'mic:SCK', 'mic:WS']);
});

test('a wire on the pin next to the wanted one is a neighbour-pin', () => {
  const b = wired(tweak(['mic:SCK', 'mic:WS'], [['mic:WS', 'esp:GPIO12']]));
  const [first] = diagnose(b, powerOn(b));
  assert.equal(first.kind, 'neighbour-pin');
  assert.match(first.text, /WS/);
  assert.match(first.text, /SCK/);
});

test('a wire one column off the pin is off-by-one', () => {
  // The mic's top row lands in e18..e20: SCK sits in column 20.
  let b = wired(tweak(['mic:SCK']));
  b = place(b, 'mic', { x: 17, y: 7 }, 0);
  b = addWire(b, 'bb:b21', 'esp:GPIO12', 'red');
  const [first] = diagnose(b, powerOn(b));
  assert.equal(first.kind, 'off-by-one');
  assert.match(first.text, /SCK/);
  assert.match(first.text, /21/);
});

test('a wire one column off on the other half of the board is not off-by-one', () => {
  let b = wired(tweak(['mic:SCK']));
  b = place(b, 'mic', { x: 17, y: 7 }, 0);
  b = addWire(b, 'bb:g21', 'esp:GPIO12', 'red');
  assert.ok(!diagnose(b, powerOn(b)).some((h) => h.kind === 'off-by-one'));
});

test('a link nobody touches is missing; faults come before it', () => {
  const b = wired(tweak(['mic:SD']));
  const hints = diagnose(b, powerOn(b));
  assert.deepEqual(hints.map((h) => h.kind), ['fault', 'missing']);
  assert.deepEqual(hints[1].points, ['mic:SD', 'esp:GPIO15']);
});

test('a correct bench has no hints, and a crossed speaker is not a mistake', () => {
  assert.deepEqual(diagnose(wired(), powerOn(wired())), []);
  const b = wired(tweak(['spk:+', 'spk:-'], [['spk:+', 'amp:-'], ['spk:-', 'amp:+']]));
  assert.deepEqual(diagnose(b, powerOn(b)), []);
});

test('mic VDD on 5V explains the burn', () => {
  const b = wired(tweak(['mic:VDD'], [['mic:VDD', 'esp:5V']]));
  const fault = diagnose(b, powerOn(b)).find((h) => h.kind === 'fault');
  assert.match(fault?.text ?? '', /3\.6 V/);
  assert.match(fault?.text ?? '', /3V3/);
});

test('empty bench: the next hint is the mic power link', () => {
  const h = nextHint(emptyBench());
  assert.equal(h?.kind, 'missing');
  assert.deepEqual(h?.points, ['mic:VDD', 'esp:3V3']);
  assert.match(h?.text ?? '', /3\.6 V/);
});

test('nextHint walks TARGET order and is null once everything is wired', () => {
  const b = wired(TARGET.slice(1));
  assert.deepEqual(nextHint(b)?.points, ['mic:VDD', 'esp:3V3']);
  assert.equal(nextHint(wired()), null);
});

test('every fault code from the power-on rules has a text', () => {
  const codes = ['short-rails', 'mic-5v', 'mic-burnt', 'mic-unpowered', 'mic-right-slot', 'clocks-swapped', 'clock-missing',
    'mic-data', 'amp-unpowered', 'amp-data', 'amp-shutdown', 'speaker', 'pins-shorted'];
  const o = { ...powerOn(emptyBench()), faults: codes.map((code) => ({ code, points: ['mic:VDD'] })) };
  const hints = diagnose(wired(), o);
  assert.equal(hints.length, codes.length);
  for (const h of hints) {
    assert.equal(h.kind, 'fault');
    assert.ok(h.text.length > 10);
    assert.doesNotMatch(h.text, /Something is wrong/);
  }
});
