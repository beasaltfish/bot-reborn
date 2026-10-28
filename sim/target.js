// The wiring the firmware expects (firmware/main/board.h), link by link, with
// the reason each one is there. The hint and the "does it work" check read it;
// the scene never does, so the bench can be wired wrongly on purpose.
//
// Points are "<instanceId>:<pinName>"; the ESP32's power pins are named as pins
// (esp:3V3, esp:5V, esp:GND), the same as any other. Every mic and amp
// instance gets its own set of links; speakers pair off with amps in order
// (spk with amp, spk2 with amp2…), so a second amp is wired the same way as
// the first (multi-screen spec §5.6).

import { screenById } from '../core/screens.js';
import { PARTS } from './parts.js';

/** @typedef {{ a: string, b: string, why: string }} Link */

/** @param {string} id @returns {Link[]} */
function micLinks(id) {
  return [
    { a: `${id}:VDD`, b: 'esp:3V3', why: 'The mic is rated 3.6 V at most, so it takes 3V3, not 5V.' },
    { a: `${id}:GND`, b: 'esp:GND', why: 'The mic needs a ground shared with the ESP32.' },
    { a: `${id}:L/R`, b: 'esp:GND', why: 'With L/R low the mic talks in the left slot, which is the one the firmware reads.' },
    { a: `${id}:SCK`, b: 'esp:GPIO12', why: 'The ESP32 clocks the mic bit by bit on BCLK, GPIO 12.' },
    { a: `${id}:WS`, b: 'esp:GPIO13', why: 'The word-select line, GPIO 13, tells the mic which slot is being read.' },
    { a: `${id}:SD`, b: 'esp:GPIO15', why: 'The mic sends its samples to the ESP32 on GPIO 15.' },
  ];
}

/** @param {string} id @returns {Link[]} */
function ampLinks(id) {
  return [
    { a: `${id}:Vin`, b: 'esp:5V', why: 'The amp runs on 5V on this build; 3V3 works too, only quieter.' },
    { a: `${id}:GND`, b: 'esp:GND', why: 'The amp needs a ground shared with the ESP32.' },
    { a: `${id}:BCLK`, b: 'esp:GPIO12', why: 'The amp shares the bit clock with the mic, so BCLK fans out to both.' },
    { a: `${id}:LRC`, b: 'esp:GPIO13', why: 'The amp shares the word-select line with the mic, so GPIO 13 goes to both.' },
    { a: `${id}:DIN`, b: 'esp:GPIO14', why: 'The ESP32 sends the sound to play to the amp on GPIO 14.' },
  ];
}

/** @param {string} spk @param {string} amp @returns {Link[]} */
function speakerLinks(spk, amp) {
  return [
    { a: `${spk}:+`, b: `${amp}:+`, why: 'The speaker goes through the amp screw terminal, plus to plus.' },
    { a: `${spk}:-`, b: `${amp}:-`, why: 'The speaker goes through the amp screw terminal, minus to minus.' },
  ];
}

/**
 * One screen's wires, taken from the model's own pin roles (multi-screen spec
 * §5.5): the firmware's pins on the ESP32 side, and the module's choice of
 * 3V3 or 5V on the power side. MISO, SD_CS and NC have no target.
 * @param {string} id
 * @param {string} modelId
 * @returns {Link[]}
 */
function screenLinks(id, modelId) {
  const model = screenById(modelId);
  if (!model) return [];
  /** @param {import('../core/screens.js').PinRole} role */
  const silk = (role) => model.pins.find((p) => p.role === role)?.silk;
  /** @type {Link[]} */
  const links = [];
  /** @param {import('../core/screens.js').PinRole} role @param {string} to @param {string} why */
  const add = (role, to, why) => {
    const name = silk(role);
    if (name) links.push({ a: `${id}:${name}`, b: to, why });
  };
  add('SCK', 'esp:GPIO11', 'The panel is clocked on GPIO 11.');
  add('MOSI', 'esp:GPIO10', 'The picture reaches the panel on GPIO 10.');
  add('CS', 'esp:GPIO9', 'Chip select is GPIO 9: the firmware drives the panel it finds there, and only one kind.');
  add('DC', 'esp:GPIO8', 'GPIO 8 tells the panel whether a byte is a pixel or an order.');
  add('RST', 'esp:GPIO18', 'GPIO 18 resets the panel, so the firmware can start it from scratch.');
  add('VCC', model.vcc === '5v' ? 'esp:5V' : 'esp:3V3', model.vcc === '5v'
    ? 'This module has its own regulator, so 5V is what it wants.'
    : 'This module takes 3V3 only; 5V would burn it.');
  add('GND', 'esp:GND', 'The panel needs the ESP32\'s ground.');
  add('BL', 'esp:3V3', 'The backlight is lit from 3V3; the board\'s own pull-up can do it, but a wire is sure.');
  return links;
}

/** The opening bench: the four instance names the diagram and the tests use. */
/** @type {Link[]} */
export const TARGET = [...micLinks('mic'), ...ampLinks('amp'), ...speakerLinks('spk', 'amp')];

/**
 * Every live instance's links. Instance order is by number, the bare name
 * first, so "spk2 with amp2" holds however the bench was built.
 * @param {import('./bench.js').Bench} b
 * @returns {Link[]}
 */
export function targetFor(b) {
  /** @param {import('./parts.js').PartDef['id']} part */
  const instances = (part) => b.placed
    .filter((p) => p.part === part)
    .sort((a, c) => number(a.id) - number(c.id));
  /** @param {string} id @returns {number} */
  const number = (id) => Number(/(\d+)$/.exec(id)?.[1] ?? 1);

  /** @type {Link[]} */
  const links = [];
  for (const p of instances('inmp441')) links.push(...micLinks(p.id));
  for (const p of instances('max98357a')) links.push(...ampLinks(p.id));
  const amps = instances('max98357a');
  instances('speaker').forEach((spk, i) => {
    const amp = amps[i];
    if (amp) links.push(...speakerLinks(spk.id, amp.id));
  });
  for (const p of b.placed.filter((q) => q.part.startsWith('screen-')).sort((a, c) => number(a.id) - number(c.id))) {
    const model = PARTS[p.part].model;
    if (model) links.push(...screenLinks(p.id, model));
  }
  return links;
}
