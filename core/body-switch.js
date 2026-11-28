// The body a character has after adopting a module or switching to a demo's
// body — one write, in `core/`, because more than one caller must give the same
// answer: the admin page beside the module card, and the brain behind
// `POST /api/bodies/:id/adopt`, which the workbench calls. No DOM, no dialog, no
// brain: just the rule.
//
// A module brings example actions of its own, so its adoption always writes an
// actions array. A template brings none, and its own actions are the ones the
// character should inherit; switching to it writes `actions: null` instead.

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

/**
 * The body a character has after switching to a body that brings no examples of
 * its own: a built-in template, or a body installed by hand. This is the rule
 * the workbench uses when a demo says "this is my body".
 *
 * The template's actions are inherited by writing `actions: null`, not an empty
 * list: `resolveBody` reads null as "follow the template", while `[]` would
 * leave the model with no tools at all. A character carrying actions of its own
 * keeps the ones the new body can run and gets the rest named in `dropped`, the
 * same rule as a module's adoption.
 * @param {BodyPatch} patch the body as it is now
 * @param {string} bodyId the body to follow
 * @param {any[]} current the actions the character carries itself
 * @param {(id: string) => boolean} isTemplate whether an id is a template name
 * @param {(actions: any[]) => string | null} accepts `bodyProblem` for the new
 *   body carrying these actions, or null when it would take them
 * @returns {{ body: BodyPatch, dropped: string[] }}
 */
export function switchBody(patch, bodyId, current, isTemplate, accepts) {
  /** @type {BodyPatch} */
  const body = { template: bodyId };
  if (typeof patch.id === 'string' && isTemplate(patch.id)) body.id = bodyId;

  /** @type {any[]} */
  const kept = [];
  /** @type {string[]} */
  const dropped = [];
  for (const action of current) {
    if (accepts([...kept, action]) === null) kept.push(action);
    else dropped.push(action.name);
  }
  // `null` inherits; `[]` would suppress the template's own actions.
  body.actions = current.length > 0 ? kept : null;
  // Only a carried action can make a trigger stale. With no actions of its own
  // the character still inherits the template's triggers (tarot's shake), so a
  // list is written back only when there was one to filter.
  if (current.length > 0 && Array.isArray(patch.triggers)) {
    const names = new Set(kept.map((action) => action.name));
    body.triggers = patch.triggers.filter((trigger) => names.has(trigger.action));
  }
  return { body, dropped };
}
