// Adopting a module is one write, not a crawl through the editor: the body
// follows the module's body (`template`), and the actions the person confirmed
// are merged in by name. It lives here, apart from the panel, so the rule can be
// tested without a brain, a browser dialog or a rendered page.
import type { BodyAction } from './types';

/** The part of `config.body` a switch writes; every other key is left as it is. */
export interface BodyPatch {
  id?: string;
  template?: string;
  actions?: BodyAction[] | null;
}

/**
 * The body a character has after adopting a module.
 *
 * `template` is always the module, so the brain resolves the module's body and
 * its commands. `id` is rewritten only when it names a template: a body of one's
 * own (`my-dog`) keeps its name, exactly as switching template does. Actions are
 * merged by name, with an example winning a collision, and the order is the
 * person's own actions first — what they wrote stays where they left it. The
 * result is always an array: `null` means "inherit", which would put the old
 * body's actions back on the next read.
 * @param {BodyPatch} patch the body as it is now
 * @param {string} moduleId the body the module installs
 * @param {BodyAction[]} current the actions the character carries itself
 * @param {BodyAction[]} examples the module's examples, as confirmed
 * @param {(id: string) => boolean} isTemplate whether an id is a template name
 * @returns {{ body: BodyPatch }}
 */
export function adoptModule(
  patch: BodyPatch,
  moduleId: string,
  current: BodyAction[],
  examples: BodyAction[],
  isTemplate: (id: string) => boolean,
): { body: BodyPatch } {
  const merged = [...current];
  for (const example of examples) {
    const at = merged.findIndex((action) => action.name === example.name);
    if (at === -1) merged.push(example);
    else merged[at] = example;
  }
  const body: BodyPatch = { template: moduleId, actions: merged };
  if (typeof patch.id === 'string' && isTemplate(patch.id)) body.id = moduleId;
  return { body };
}
