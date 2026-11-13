// One adapted plan for both authored projects and legacy recipes. The bench,
// evaluation and lessons stay as they are; guidance reads this shape.
import { emptyBench } from './bench.js';
import { RECIPES, DEFAULT_SCREEN, recipeSteps, benchSetupSteps, startBench, applyStep } from './recipes.js';
import { PROJECTS } from './projects.js';
import { targetFor } from './target.js';
import { LESSONS } from './lessons/index.js';
import { PARTS } from './parts.js';
import { wireEnd } from './snap.js';

/**
 * @typedef {{ id: string, part: string, at: { x: number, z: number }, rot: number, seated: boolean }} PlanPart
 * @typedef {{ recipeId: string, screenId?: string, wand?: boolean, steps?: import('./recipes.js').Step[] }} PlanLegacy
 * @typedef {{
 *   id: string, name: string, goalKey: string, needs?: string, ending?: string,
 *   parts: PlanPart[], links: import('./target.js').Link[],
 *   ignoredFaultCodes?: string[], lessonId?: string, legacy?: PlanLegacy, steps?: import('./recipes.js').Step[],
 * }} Plan
 */

/** @param {import('./recipes.js').Step} step @returns {step is Extract<import('./recipes.js').Step, {kind:'part'}>} */
const isPartStep = step => step.kind === 'part';

// Fixed on-board holes for project parts, following the recipe layout: the
// ESP32 occupies columns 6-27, so project modules start at x -1 (column 31)
// and use the right of the ESP32's body (x 9, like the recipe amp), one row
// per group, never sharing the ESP's strips.
const SEAT_ROWS = [-4, -2, -6, 15, 17];
const SEAT_GAP = 2;
const BOARD_LEFT = 9;
const BOARD_RIGHT = 28;
/** @param {import('./recipes.js').Step[]} steps @returns {import('./recipes.js').Step[]} */
function seatSteps(steps) {
  /** @type {{ index: number, width: number }[]} */
  const seats = [];
  steps.forEach((step, index) => {
    if (step.kind !== 'part') return;
    const def = PARTS[step.part];
    if (!def?.onBoard || def.id === 'esp32' || def.pins.every(pin => pin.wireOnly)) return;
    seats.push({ index, width: Math.max(...def.pins.map(pin => pin.x)) + 1 });
  });
  /** @type {Map<number, { x: number, z: number }>} */
  const positions = new Map();
  let rowIndex = 0;
  let cursor = 0;
  while (cursor < seats.length) {
    const row = [];
    let used = 0;
    while (cursor < seats.length) {
      const next = seats[cursor];
      const needed = (row.length ? SEAT_GAP : 0) + next.width;
      if (row.length && used + needed > BOARD_RIGHT - BOARD_LEFT) break;
      row.push(next);
      used += needed;
      cursor += 1;
    }
    let x = BOARD_LEFT;
    const z = SEAT_ROWS[rowIndex] ?? SEAT_ROWS[SEAT_ROWS.length - 1];
    for (const seat of row) {
      positions.set(seat.index, { x, z });
      x += seat.width + SEAT_GAP;
    }
    rowIndex += 1;
  }
  return steps.map((step, index) => {
    const at = positions.get(index);
    return at ? { ...step, at, seated: true } : step;
  });
}

/** @param {PlanPart[]} parts @param {import('./target.js').Link[]} links @returns {import('./recipes.js').Step[]} */
function derivedSteps(parts, links) {
  /** @type {import('./recipes.js').Step[]} */
  const steps = [
    ...benchSetupSteps(),
    ...parts.map(part => /** @type {import('./recipes.js').Step} */ ({ kind: 'part', id: part.id, part: /** @type {any} */ (part.part), at: part.at, rot: /** @type {any} */ (part.rot), seated: part.seated, say: `Place ${part.part}.` })),
  ];
  for (const link of links) steps.push({ kind: 'wire', a: link.a, b: link.b, named: [link.a, link.b], say: link.why });
  // Project builds stay unplugged so the plug, powered state and diagnostics agree.
  return steps;
}

/** @param {import('./projects.js').Project} project @returns {Plan} */
export function planFromProject(project) {
  const lesson = LESSONS.find(item => item.projectId === project.id) ?? null;
  const parts = project.steps.filter(isPartStep).filter(step => step.part !== 'esp32').map(step => ({
    id: step.id, part: step.part, at: step.at, rot: step.rot, seated: step.seated,
  }));
  return {
    id: project.id,
    name: project.name,
    goalKey: `goal.${project.id}`,
    needs: project.needs,
    ending: project.ending,
    parts,
    links: project.links,
    ignoredFaultCodes: project.ignoredFaultCodes,
    steps: project.steps,
    ...(lesson ? { lessonId: lesson.id } : {}),
  };
}

/** @param {string} recipeId @param {{screenId?: string, wand?: boolean}} [options] @returns {Plan|null} */
export function planFromRecipe(recipeId, options = {}) {
  const recipe = RECIPES.find(item => item.id === recipeId);
  if (!recipe) return null;
  const screenId = options.screenId ?? DEFAULT_SCREEN;
  const wand = options.wand === true;
  const steps = recipeSteps(recipe.id, screenId, wand);
  const bench = steps.reduce(applyStep, startBench(emptyBench()));
  const parts = steps.filter(isPartStep).filter(step => step.part !== 'esp32').map(step => ({
    id: step.id, part: step.part, at: step.at, rot: step.rot, seated: step.seated,
  }));
  return {
    id: recipe.id,
    name: recipe.name,
    goalKey: `goal.${recipe.id}`,
    needs: recipe.needs,
    ending: recipe.ending,
    parts,
    links: targetFor(bench),
    legacy: { recipeId: recipe.id, screenId, wand, steps },
  };
}

/** @param {string} id @param {{screenId?: string, wand?: boolean}} [options] @returns {Plan|null} */
export function planById(id, options) {
  if (RECIPES.some(recipe => recipe.id === id)) return planFromRecipe(id, options);
  const project = PROJECTS.find(item => item.id === id);
  return project ? planFromProject(project) : null;
}

/** Prefer the screen model actually placed on the bench. @param {import('./bench.js').Bench} bench @param {{screenId?:string,wand?:boolean}} [options] */
export function planOptionsFor(bench, options = {}) {
  const screen = bench.placed.find(part => part.part.startsWith('screen-'));
  const model = screen ? PARTS[screen.part]?.model : undefined;
  return { ...options, ...(model ? { screenId: model } : {}) };
}

/** A plan's identity, including a recipe's screen/wand variant. @param {Plan} plan */
export function planId(plan) {
  return plan.legacy ? `${plan.id}:${plan.legacy.screenId ?? ''}:${plan.legacy.wand ? 'wand' : 'nowand'}` : plan.id;
}

/** @param {Plan} plan @returns {import('./recipes.js').Step[]} */
export function planSteps(plan) {
  if (plan.legacy?.steps) return plan.legacy.steps;
  if (plan.steps) {
    const setup = plan.steps.some(step => step.kind === 'board') ? plan.steps : [...benchSetupSteps(), ...plan.steps];
    const parts = seatSteps(setup).filter(step => step.kind === 'board' || step.kind === 'part');
    const bench = parts.reduce(applyStep, startBench(emptyBench()));
    const taken = new Set();
    const wires = plan.links.map(link => {
      // A pin seated in the board is under its part, so the jumper goes into a
      // free hole on its strip, exactly as the recipe builds do.
      const a = wireEnd(bench, link.a, taken) ?? link.a;
      taken.add(a);
      const b = wireEnd(bench, link.b, taken) ?? link.b;
      taken.add(b);
      return /** @type {import('./recipes.js').Step} */ ({ kind: 'wire', a, b, named: [link.a, link.b], say: link.why });
    });
    return [...parts, ...wires];
  }
  return derivedSteps(plan.parts, plan.links);
}
