// The body a character has after adopting a module — one write, in `core/`,
// because two callers must give the same answer: the admin page beside the
// module card, and the brain behind `POST /api/bodies/:id/adopt`, which the
// workbench calls. No DOM, no dialog, no brain: just the rule.

/**
 * The part of `config.body` a switch writes; every other key is left as it is.
 * @typedef {{ id?: string, template?: string, actions?: any[] | null, triggers?: any[] | null }} BodyPatch
 */

/**
 * The body a character has after adopting a module.
 *
 * `template` is always the module, so the brain resolves the module's body and
 * its commands. `id` is rewritten only when it names a template: a body of one's
 * own (`my-dog`) keeps its name, exactly as switching template does.
 *
 * Actions are merged by name, with an example winning a collision, and the
 * person's own actions stay in their order. An example is the module's own
 * words and is always kept; a current action is kept only when `accepts` says
 * the module body can still run it. Testing one action at a time means what
 * survives does not depend on what was dropped before it. The names that did
 * not survive come back in `dropped`, so the caller can say which and why.
 *
 * The result always carries an actions array: `null` means "inherit", which
 * would put the old body's actions back on the next read.
 *
 * A character's own triggers are written back filtered to the actions that
 * survived. The actions editor reads raw triggers, so a trigger naming a
 * dropped action would make the next edit refuse the body. An absent or `null`
 * trigger list is left out entirely: `null` means "inherit", not "none".
 *
 * @param {BodyPatch} patch the body as it is now
 * @param {string} moduleId the body the module installs
 * @param {any[]} current the actions the character carries itself
 * @param {any[]} examples the module's examples, as confirmed
 * @param {(id: string) => boolean} isTemplate whether an id is a template name
 * @param {(actions: any[]) => string | null} accepts `bodyProblem` for the
 *   module's body carrying these actions, or null when it would take them
 * @returns {{ body: BodyPatch, dropped: string[] }}
 */
export function adoptModule(patch, moduleId, current, examples, isTemplate, accepts) {
  const merged = [...current];
  for (const example of examples) {
    const at = merged.findIndex((action) => action.name === example.name);
    if (at === -1) merged.push(example);
    else merged[at] = example;
  }

  const fromModule = new Set(examples.map((example) => example.name));
  /** @type {any[]} */
  const kept = [];
  /** @type {string[]} */
  const dropped = [];
  for (const action of merged) {
    if (fromModule.has(action.name)) {
      kept.push(action);
      continue;
    }
    if (accepts([...kept, action]) === null) kept.push(action);
    else dropped.push(action.name);
  }

  /** @type {BodyPatch} */
  const body = { template: moduleId, actions: kept };
  if (typeof patch.id === 'string' && isTemplate(patch.id)) body.id = moduleId;
  if (Array.isArray(patch.triggers)) {
    const names = new Set(kept.map((action) => action.name));
    body.triggers = patch.triggers.filter((trigger) => names.has(trigger.action));
  }
  return { body, dropped };
}
