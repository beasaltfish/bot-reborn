// "Wire it for me" as data: a working bench described as the steps that build
// it (boards, parts, wires, USB), not as a finished picture. The scene plays
// the steps one at a time; applyStep is the same step with no animation, so
// the tests can build every recipe and ask the power-on rules if it works.
// Pure: nothing here knows about three.js or the DOM.

import { emptyBench, addBoard, addPart, place, addWire } from './bench.js';
import { targetFor } from './target.js';
import { JOIN } from './parts.js';
import { name as pointName } from './diagnose.js';
import { wireColor } from './wire-color.js';
import { wireEnd } from './snap.js';

/** @typedef {import('./bench.js').Bench} Bench */
/** @typedef {import('./parts.js').Rot} Rot */
/** @typedef {{ x: number, z: number }} At */
/**
 * @typedef {{ say: string } & (
 *   | { kind: 'board', id: string, at: At, rot: Rot }
 *   | { kind: 'part', id: string, part: import('./parts.js').PartDef['id'], at: At, rot: Rot, seated: boolean }
 *   | { kind: 'wire', a: string, b: string, named?: [string, string] }
 *   | { kind: 'usb' }
 * )} Step
 */

/**
 * What a recipe is: `needs` says what the character has to be able to do
 * ('pet' = it has a screen to show), `ending` is what to say to try the
 * finished bench.
 * @typedef {{ id: 'audio' | 'screen', name: string, needs: 'any' | 'pet', ending: string }} Recipe
 */

/** @type {Recipe[]} */
export const RECIPES = [
  { id: 'audio', name: 'Audio only', needs: 'any', ending: 'Say hello' },
  { id: 'screen', name: 'Audio + screen', needs: 'pet', ending: 'Say "Sit"' },
];

/** The screen a recipe wires when the character has not named a model. */
export const DEFAULT_SCREEN = 'ili9341-ips';

/** The ESP32's opening spot on the table (where emptyBench puts it). */
const ESP_HOME = { x: -10.5, z: 16 };

// Coordinates, found with snapPart/pinPoints and pinned here so the tests
// guard them. The DevKitC is too wide for one board (a pin row would land in a
// power rail), so it straddles two joined on the long side: its top row (y 0)
// is in bb1's last row, j (z 5), and its bottom row (y 10) in bb2's first row,
// a (z 15). Column 6 keeps the 22 pins clear of both ends.
const BB1 = { x: -31, z: -9 };
const BB2 = { x: BB1.x, z: BB1.z + JOIN.long };
const ESP_SEAT = { x: -25, z: 5 };

// The mic and amp are plugged into bb1's free half, columns well clear of the
// ESP32's (6-27) so no pin shares a strip with another part's. The mic's two
// pin rows are 3 apart, so it straddles the centre gap: rows e (z -2) and f
// (z 1), columns 30-32. The amp's seven pins are one row, c (z -4), columns
// 40-46: one column each, so none are joined.
const MIC_SEAT = { x: -1, z: -2 };
const AMP_SEAT = { x: 9, z: -4 };

// The speaker and screen lie loose in one row below the second board, clear
// of the bin (x 43+) whatever the screen's width; `at` is a part's top-left corner.
const ROW_Z = 36;
const LOOSE = {
  spk: { at: { x: -50, z: ROW_Z } },
  scr: { at: { x: -12, z: ROW_Z } },
  // The wand lies loose one row further down, clear of the screen whatever its width.
  imu: { at: { x: -50, z: ROW_Z + 30 } },
};

/**
 * The bench a recipe starts from: only the ESP32 remains, lying where it
 * opened, nothing wired, USB out. No boards either: the recipe's first steps
 * lay down its own, so they land where its coordinates expect.
 * @param {Bench} b
 * @returns {Bench}
 */
export function startBench(b) {
  const esp = b.placed.find((p) => p.id === 'esp');
  if (!esp) throw new Error('the bench has no ESP32');
  return {
    ...b,
    boards: [],
    placed: [{ ...esp, at: { ...ESP_HOME }, rot: 0, seated: false, burnt: false }],
    wires: [],
    usb: false,
  };
}

/**
 * The steps that build a working bench, in the order a person would: boards,
 * the ESP32 across them, the other parts, one wire per target link, USB.
 * Wire steps carry `named`, the pins they stand for, since their ends may be
 * holes beside a seated pin (which say nothing about power or ground).
 * @param {Recipe['id']} recipeId
 * @param {string} [screenId]
 * @param {boolean} [wand] also lay and wire the tarot wand (MPU6050)
 * @returns {Step[]}
 */
export function recipeSteps(recipeId, screenId = DEFAULT_SCREEN, wand = false) {
  /** @type {Step[]} */
  const steps = [
    { kind: 'board', id: 'bb1', at: BB1, rot: 0, say: 'A breadboard to build on' },
    { kind: 'board', id: 'bb2', at: BB2, rot: 0, say: 'A second board: the ESP32 is too wide for one, so it sits across the seam' },
    { kind: 'part', id: 'esp', part: 'esp32', at: ESP_SEAT, rot: 0, seated: true, say: 'The ESP32 goes in across the seam, a row of pins on each board' },
    { kind: 'part', id: 'mic', part: 'inmp441', at: MIC_SEAT, rot: 0, seated: true, say: 'The microphone, which hears you, clicks into the board' },
    { kind: 'part', id: 'amp', part: 'max98357a', at: AMP_SEAT, rot: 0, seated: true, say: 'The amplifier, which drives the speaker, clicks into the board' },
    { kind: 'part', id: 'spk', part: 'speaker', at: LOOSE.spk.at, rot: 0, seated: false, say: 'The speaker, which talks back' },
  ];
  if (recipeId === 'screen') {
    steps.push({
      kind: 'part', id: 'scr', part: `screen-${screenId}`, at: LOOSE.scr.at, rot: 0, seated: false,
      say: 'The screen, which shows the face',
    });
  }
  if (wand) {
    steps.push({
      kind: 'part', id: 'imu', part: 'mpu6050', at: LOOSE.imu.at, rot: 0, seated: false,
      say: 'The wand, which feels how you shake it',
    });
  }
  // The links depend on which parts stand on the table, so they are asked of
  // the bench the part steps make, not written down twice.
  const parts = steps.reduce(applyStep, startBench(emptyBench()));
  // A pin seated in a board is under its part, so its wire ends in a free hole
  // of the pin's strip, as a hand's would; each hole takes one wire.
  /** @type {Set<string>} */
  const taken = new Set();
  /** @param {string} point */
  const end = (point) => {
    const at = wireEnd(parts, point, taken);
    if (!at) throw new Error(`no free hole on the strip of ${point}`);
    taken.add(at);
    return at;
  };
  for (const l of targetFor(parts)) {
    steps.push({ kind: 'wire', a: end(l.a), b: end(l.b), named: [l.a, l.b], say: `${pointName(l.a)} → ${pointName(l.b)}: ${l.why}` });
  }
  steps.push({ kind: 'usb', say: 'Plug in USB: the bench has power' });
  return steps;
}

/**
 * One step, done at once.
 * @param {Bench} b
 * @param {Step} s
 * @returns {Bench}
 */
export function applyStep(b, s) {
  switch (s.kind) {
    case 'board': {
      const { bench, id } = addBoard(b, s.at, s.rot);
      if (id !== s.id) throw new Error(`expected board ${s.id}, got ${id}`);
      return bench;
    }
    case 'part': {
      if (b.placed.some((p) => p.id === s.id)) return place(b, s.id, s.at, s.rot, s.seated);
      const { bench, id } = addPart(b, s.part, s.at);
      if (id !== s.id) throw new Error(`expected ${s.id}, got ${id}`);
      return place(bench, id, s.at, s.rot, s.seated);
    }
    case 'wire':
      return addWire(b, s.a, s.b, wireColor(b, ...(s.named ?? [s.a, s.b])));
    case 'usb':
      return { ...b, usb: true };
  }
}
