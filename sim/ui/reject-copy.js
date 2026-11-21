// What the body prints when the brain refuses it: each known reason names
// the fix, and anything unrecognised keeps the raw protocol line.
/** @type {Record<'en'|'zh', Record<string, string>>} */
const LINES = {
  en: {
    unconfigured: 'the brain will not take this character yet: it still needs Ears, Mind or Voice. Fill them in the admin page, then type reboot',
    token: 'this token belongs to no character on this brain. Copy it again from the admin page, then type reboot',
  },
  zh: {
    unconfigured: '大脑还不能接这个角色：听、想、说里还有没填的。去管理页填好，再输入 reboot',
    token: '这个 token 不属于这台大脑上的任何角色。去管理页重新复制一次，再输入 reboot',
  },
};

/**
 * @param {string} reason
 * @param {'en'|'zh'} [lang]
 * @returns {string}
 */
export function rejectCopy(reason, lang = 'en') {
  return LINES[lang]?.[reason] ?? `rejected: ${reason} — fix it, then type reboot`;
}
