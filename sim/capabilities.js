// What a character can do in a demo, from its declared body. `needs` are
// actions (CAN_DO), never body names: a car character can still be plugged in
// for a screen demo; only the final pose is skipped.
import { CAN_DO } from '../core/config.js';

/** @param {string[]} needs @param {string} motion */
export function canDo(needs, motion) {
  const can = CAN_DO[/** @type {keyof typeof CAN_DO} */ (motion)] ?? [];
  return needs.every((need) => can.includes(need));
}

const SKIP = {
  pose: ['This character cannot pose; the pet stays off.', '这个角色不能摆姿势；宠物不会出现。'],
  move: ['This character cannot move; the toy stays still.', '这个角色不能移动；小车不会动。'],
  draw: ['This character cannot draw a card.', '这个角色不能抽牌。'],
};

/** @param {string[]} needs @param {string} motion @param {'en'|'zh'} [lang] */
export function demoSkips(needs, motion, lang = 'en') {
  return needs.filter((need) => !canDo([need], motion)).map((need) => ({
    need,
    text: (SKIP[/** @type {keyof typeof SKIP} */ (need)] ?? ['This step is skipped.', '这一步已跳过。'])[lang === 'zh' ? 1 : 0],
  }));
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
