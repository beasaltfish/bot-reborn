// "Wire it for me" as data: a working bench described as the steps that build
// it (boards, parts, wires, USB), not as a finished picture. The scene plays
// the steps one at a time; applyStep is the same step with no animation, so
// the tests can build every recipe and ask the power-on rules if it works.
// Pure: nothing here knows about three.js or the DOM.

import { emptyBench, addBoard, addPart, place, addWire } from './bench.js';
import { targetFor } from './target.js';
import { JOIN } from './parts.js';
import { wireColor } from './wire-color.js';

/** @typedef {import('./bench.js').Bench} Bench */
/** @typedef {import('./parts.js').Rot} Rot */
/** @typedef {{ x: number, z: number }} At */
/**
 * @typedef {{ say: string } & (
 *   | { kind: 'board', id: string, at: At, rot: Rot }
 *   | { kind: 'part', id: string, part: import('./parts.js').PartDef['id'], at: At, rot: Rot, seated: boolean }
 *   | { kind: 'wire', a: string, b: string }
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
  { id: 'audio', name: 'Hear and speak', needs: 'any', ending: 'Say hello' },
  { id: 'screen', name: 'Hear, speak and show', needs: 'pet', ending: 'Say "Sit"' },
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

// The loose parts stand in one row below the second board, clear of the bin
// (x 43+) whatever the screen's width; `at` is a part's top-left corner.
const ROW_Z = 36;
const LOOSE = {
  spk: { part: /** @type {const} */ ('speaker'), at: { x: -50, z: ROW_Z } },
  amp: { part: /** @type {const} */ ('max98357a'), at: { x: -30, z: ROW_Z } },
  mic: { part: /** @type {const} */ ('inmp441'), at: { x: -20, z: ROW_Z } },
  scr: { at: { x: -12, z: ROW_Z } },
};

/**
 * The bench a recipe starts from: only the ESP32 remains, lying where it
 * opened, nothing wired, USB out. Boards stay as the caller has them; the
 * recipe's first steps lay down its own.
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
 * @param {Recipe['id']} recipeId
 * @param {string} [screenId]
 * @returns {Step[]}
 */
export function recipeSteps(recipeId, screenId = DEFAULT_SCREEN) {
  /** @type {Step[]} */
  const steps = [
    { kind: 'board', id: 'bb1', at: BB1, rot: 0, say: 'A breadboard to build on' },
    { kind: 'board', id: 'bb2', at: BB2, rot: 0, say: 'A second board: the ESP32 is too wide for one, so it sits across the seam' },
    { kind: 'part', id: 'esp', part: 'esp32', at: ESP_SEAT, rot: 0, seated: true, say: 'The ESP32 goes in across the seam, a row of pins on each board' },
    { kind: 'part', id: 'mic', part: LOOSE.mic.part, at: LOOSE.mic.at, rot: 0, seated: false, say: 'The microphone, which hears you' },
    { kind: 'part', id: 'amp', part: LOOSE.amp.part, at: LOOSE.amp.at, rot: 0, seated: false, say: 'The amplifier, which drives the speaker' },
    { kind: 'part', id: 'spk', part: LOOSE.spk.part, at: LOOSE.spk.at, rot: 0, seated: false, say: 'The speaker, which talks back' },
  ];
  if (recipeId === 'screen') {
    steps.push({
      kind: 'part', id: 'scr', part: `screen-${screenId}`, at: LOOSE.scr.at, rot: 0, seated: false,
      say: 'The screen, which shows the face',
    });
  }
  // The links depend on which parts stand on the table, so they are asked of
  // the bench the part steps make, not written down twice.
  const parts = steps.reduce(applyStep, startBench(emptyBench()));
  for (const l of targetFor(parts)) steps.push({ kind: 'wire', a: l.a, b: l.b, say: `${l.a} → ${l.b}: ${l.why}` });
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
      return addWire(b, s.a, s.b, wireColor(b, s.a, s.b));
    case 'usb':
      return { ...b, usb: true };
  }
}
