// What the body prints when the brain refuses it: each known reason names
// the fix, and anything unrecognised keeps the raw protocol line.
/** @type {Record<'en'|'zh', Record<string, string>>} */
const LINES = {
  en: {
    unconfigured: 'the brain will not take this character yet: it still needs Ears, Mind or Voice. Fill them in the admin page, then type reboot',
    token: 'this token belongs to no character on this brain. Pick the character in the serial panel below, send its token, then type reboot',
    bridge: 'this character runs plugin commands, which need a body that answers them (protocol 3); this one speaks protocol 2. Use the simulator, or a board with the bridge firmware',
  },
  zh: {
    unconfigured: '大脑还不能接这个角色：听、想、说里还有没填的。去管理页填好，再输入 reboot',
    token: '这个 token 不属于这台大脑上的任何角色。在下面的串口里选中角色、发送它的 token，再输入 reboot',
    bridge: '这个角色要用插件命令，需要能应答命令（协议 3）的身体；这块身体说的是协议 2。用模拟器，或刷带桥固件的板子',
  },
};

/**
 * @param {string} reason
 * @param {'en'|'zh'} [lang]
 * @returns {string}
 */
export function rejectCopy(reason, lang = 'en') {
  const lines = LINES[lang];
  // Own properties only: `constructor`, `toString` and friends are not reasons.
  if (lines && Object.hasOwn(lines, reason)) return lines[reason];
  return `rejected: ${reason} — fix it, then type reboot`;
}
