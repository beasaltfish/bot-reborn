// Local behaviors: the bounded rules a body runs on its own, without asking
// the brain. A rule watches one input resource, or a clock, and runs commands.
// It is deliberately smaller than a program: no expressions, no loops, no
// verbs, no returned values. The closed shape is what lets the same manifest
// run on the workbench and, later, in the firmware.
//
// A behavior is data; the executor lives in `sim/behavior-runtime.js` today and
// in the firmware when the bridge lands. This module only says whether one is
// well formed, so a manifest is refused at load instead of at the first press.

/** How many rules one body may carry. A rule engine is a promise; keep it small. */
export const BEHAVIOR_LIMIT = 16;

const LEVELS = /** @type {const} */ (['low', 'high']);
const EDGES = /** @type {const} */ (['down', 'up', 'change']);

/**
 * One local rule, as the manifest carries it.
 * @typedef {{
 *   on: {
 *     resource?: string,
 *     level?: 'low' | 'high',
 *     edge?: 'down' | 'up' | 'change',
 *     everyMs?: number,
 *   },
 *   run: { command: string }[],
 * }} Behavior
 */

/**
 * @typedef {{
 *   kind?: string,
 *   name: string,
 *   direction?: string,
 * }} BehaviorResource
 * @typedef {{
 *   name: string,
 *   returns?: boolean,
 * }} BehaviorCommand
 * @typedef {{
 *   resources?: BehaviorResource[],
 *   commands?: BehaviorCommand[],
 * }} BehaviorContext
 */

/**
 * One rule, or the sentence that says what is wrong with it.
 * @param {any} behavior
 * @param {BehaviorContext} [context]
 * @returns {string | null}
 */
export function behaviorProblem(behavior, context = {}) {
  const resources = Array.isArray(context.resources) ? context.resources : [];
  const commands = Array.isArray(context.commands) ? context.commands : [];
  if (!behavior || typeof behavior !== 'object' || Array.isArray(behavior)) {
    return 'a behavior is an object';
  }
  const on = behavior.on;
  if (!on || typeof on !== 'object' || Array.isArray(on)) {
    return 'a behavior needs an "on" trigger';
  }

  const named = typeof on.resource === 'string' && on.resource !== '';
  const every = Object.hasOwn(on, 'everyMs');
  if (named && every) return 'a behavior has either a resource or everyMs, not both';
  if (!named && !every) return 'a behavior trigger needs a resource or everyMs';

  if (every) {
    if (!Number.isInteger(on.everyMs) || on.everyMs < 50) {
      return 'everyMs must be an integer of at least 50';
    }
    if (Object.hasOwn(on, 'level') || Object.hasOwn(on, 'edge')) {
      return 'everyMs takes no level or edge';
    }
  } else {
    const resource = resources.find((entry) => entry?.name === on.resource);
    if (!resource) return `no resource called ${on.resource}`;
    if (resource.kind !== 'gpio') return `resource ${on.resource} is not a gpio`;
    if (resource.direction !== 'input') return `resource ${on.resource} is not an input`;
    const level = Object.hasOwn(on, 'level');
    const edge = Object.hasOwn(on, 'edge');
    if (level === edge) return 'a resource trigger needs exactly one of level or edge';
    if (level && !LEVELS.includes(on.level)) return 'level must be low or high';
    if (edge && !EDGES.includes(on.edge)) return 'edge must be down, up or change';
  }

  if (!Array.isArray(behavior.run) || behavior.run.length === 0) {
    return 'a behavior runs at least one command';
  }
  for (const step of behavior.run) {
    if (!step || typeof step !== 'object' || Array.isArray(step)) return 'a behavior step is an object';
    if (Object.hasOwn(step, 'args')) return 'a behavior step takes no arguments yet';
    if (typeof step.command !== 'string') return 'a behavior step is a command';
    const command = commands.find((entry) => entry?.name === step.command);
    if (!command) return `no command called ${step.command}`;
    if (command.returns === true) {
      return `command ${step.command} returns a value; a behavior cannot use it yet`;
    }
  }
  return null;
}

/**
 * Every rule in a body, or the first sentence that refuses the list.
 * @param {unknown} behaviors
 * @param {BehaviorContext} [context]
 * @returns {string | null}
 */
export function behaviorsProblem(behaviors, context = {}) {
  if (behaviors === undefined) return null;
  if (!Array.isArray(behaviors)) return 'behaviors must be a list';
  if (behaviors.length > BEHAVIOR_LIMIT) {
    return `a body may have at most ${BEHAVIOR_LIMIT} behaviors`;
  }
  for (const [index, behavior] of behaviors.entries()) {
    const problem = behaviorProblem(behavior, context);
    if (problem) return `behaviors[${index}]: ${problem}`;
  }
  return null;
}
