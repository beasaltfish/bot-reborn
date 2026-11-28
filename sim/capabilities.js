// What a character can do in a demo, from the verbs its body can run. `needs`
// are verbs — pose, draw, move — never body names and never action names: a car
// character can still be plugged in for a screen demo; only the final pose is
// skipped.
import { simText } from './ui/strings.js';

/**
 * A demo's word for a verb. `move` is what a recipe asks for when it wants the
 * thing to go somewhere, and `drive` is the verb that does it — `halt` alone
 * only stops a body that was already moving.
 * @type {Record<string, string>}
 */
const NEED_VERB = { move: 'drive' };

/**
 * Whether a body can run every verb a demo needs. `verbs` is the summary's
 * `verbs` list (core/actions.js `verbsOf`), so the question is what the body can
 * do, not what its actions are called. An old page without the field sends an
 * empty list, and every demo step is then explained as skipped.
 * @param {string[]} needs
 * @param {string[]} verbs
 */
export function canDo(needs, verbs) {
  return needs.every((need) => verbs.includes(NEED_VERB[need] ?? need));
}

/** @param {string[]} needs @param {string[]} verbs @param {'en'|'zh'} [lang] */
export function demoSkips(needs, verbs, lang = 'en') {
  return needs.filter((need) => !canDo([need], verbs)).map((need) => {
    const key = `demo.skip.${need}`;
    const text = simText(lang, key);
    return { need, text: text === key ? simText(lang, 'demo.skip.other') : text };
  });
}

/**
 * A character's capabilities are only knowable on this brain. A remote brain
 * or a missing name gives null, never a same-name guess. `verbs` is what the
 * bench asks about; `motion` stays because a brain that predates the field
 * still sends it.
 * @param {{ id?: string, name: string, motion: string, verbs?: string[] }[]} list @param {string} name @param {boolean} remote
 */
export function lookupCharacter(list, name, remote) {
  if (remote) return null;
  return list.find((c) => c.name === name) ?? null;
}
