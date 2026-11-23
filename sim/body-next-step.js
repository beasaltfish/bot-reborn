// What the project panel says about the character on the other end: is this
// demo its body, and if not, what would settle it. Four states, because those
// are the four things a person can be looking at — and the button's words
// always name the body switch, never "add some actions".
//
// A pure function of three facts the page already has: the project's `body`,
// the character's body and actions, and whether the brain holds that body. The
// copy lives in `ui/strings.js`, so this returns a key and its numbers.

/**
 * @param {{
 *   body?: string | null,
 *   character?: { name: string, bodyId?: string, actionNames?: string[] } | null,
 *   installed?: boolean,
 *   examples?: number | string[],
 * }} input
 * @returns {{ key: string, params: Record<string, string | number>, action: 'install' | 'adopt' | null } | null}
 *   null for an empty bench: no body is being built, so nothing is being said.
 */
export function nextStep({ body, character, installed = false, examples = 0 }) {
  const exampleList = Array.isArray(examples) ? examples : null;
  if (!body) return null;
  const name = character?.name ?? '';
  if (!character) return { key: 'bodyNext.pair', params: {}, action: null };

  const hasBody = character.bodyId === body;
  const actions = Array.isArray(character.actionNames) ? character.actionNames : [];
  // The body's own examples are what tell the model when to use it. A body whose
  // character carries some other body's actions is a body the model cannot use,
  // so the question is which actions, not how many.
  const count = typeof examples === 'number' ? examples : examples.length;
  const hasTheirs = exampleList
    ? actions.some((name) => exampleList.includes(name))
    : actions.length > 0;
  if (hasBody && hasTheirs) {
    return { key: 'bodyNext.isBody', params: { name }, action: null };
  }
  if (hasBody) {
    return { key: 'bodyNext.needsActions', params: { name, n: count }, action: 'adopt' };
  }
  if (!installed) {
    return { key: 'bodyNext.notInstalled', params: { name, n: count }, action: 'install' };
  }
  return { key: 'bodyNext.otherBody', params: { name, n: count }, action: 'adopt' };
}
