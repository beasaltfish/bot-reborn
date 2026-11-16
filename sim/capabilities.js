// What a character can do in a demo, from its declared body. `needs` are
// actions (CAN_DO), never body names: a car character can still be plugged in
// for a screen demo; only the final pose is skipped.
import { CAN_DO } from '../core/config.js';

/** @param {string[]} needs @param {string} motion */
export function canDo(needs, motion) {
  const can = CAN_DO[/** @type {keyof typeof CAN_DO} */ (motion)] ?? [];
  return needs.every((need) => can.includes(need));
}
