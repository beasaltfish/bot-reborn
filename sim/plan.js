// One adapted plan for both authored projects and legacy recipes. The bench,
// evaluation and lessons stay as they are; guidance reads this shape.
import { emptyBench } from './bench.js';
import { RECIPES, DEFAULT_SCREEN, recipeSteps, benchSetupSteps, startBench, applyStep } from './recipes.js';
import { PROJECTS } from './projects.js';
import { targetFor } from './target.js';
import { LESSONS } from './lessons/index.js';
import { PARTS } from './parts.js';

/**
 * @typedef {{ id: string, part: string, at: { x: number, z: number }, rot: number, seated: boolean }} PlanPart
 * @typedef {{ recipeId: string, screenId?: string, wand?: boolean, steps?: import('./recipes.js').Step[] }} PlanLegacy
 * @typedef {{
 *   id: string, name: string, goalKey: string, needs?: string, ending?: string,
 *   parts: PlanPart[], links: import('./target.js').Link[],
 *   ignoredFaultCodes?: string[], lessonId?: string, legacy?: PlanLegacy,
 * }} Plan
 */

/** @param {import('./recipes.js').Step} step @returns {step is Extract<import('./recipes.js').Step, {kind:'part'}>} */
const isPartStep = step => step.kind === 'part';

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
  return derivedSteps(plan.parts, plan.links);
}
