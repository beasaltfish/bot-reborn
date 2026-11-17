// What a character can do in a demo, from its declared body. `needs` are
// actions (CAN_DO), never body names: a car character can still be plugged in
// for a screen demo; only the final pose is skipped.
import { CAN_DO } from '../core/config.js';
import { simText } from './ui/strings.js';

/** @param {string[]} needs @param {string} motion */
export function canDo(needs, motion) {
  const can = CAN_DO[/** @type {keyof typeof CAN_DO} */ (motion)] ?? [];
  return needs.every((need) => can.includes(need));
}

/** @param {string[]} needs @param {string} motion @param {'en'|'zh'} [lang] */
export function demoSkips(needs, motion, lang = 'en') {
  return needs.filter((need) => !canDo([need], motion)).map((need) => {
    const key = `demo.skip.${need}`;
    const text = simText(lang, key);
    return { need, text: text === key ? simText(lang, 'demo.skip.other') : text };
  });
}

/**
 * A character's capabilities are only knowable on this brain. A remote brain
 * or a missing name gives null, never a same-name guess.
 * @param {{ name: string, motion: string }[]} list @param {string} name @param {boolean} remote
 */
export function lookupCharacter(list, name, remote) {
  if (remote) return null;
  return list.find((c) => c.name === name) ?? null;
}
