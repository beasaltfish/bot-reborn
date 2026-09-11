// UI copy and fixed TTS lines. Spec §11.1: this table — and only this table —
// follows `lang`. The voice chain (STT → LLM → TTS) never reads it.

/**
 * Spec §5.5. Both keywords are English and independent of `lang`; they identify
 * *this device* and control it physically, so they are not part of the UI's
 * language at all.
 */
export const KEYWORDS = /** @type {const} */ (['hey steven', 'all stop']);

/**
 * NOTE: every value here may be read aloud by TTS, bypassing the LLM. None of
 * them may contain a keyword — see spec §6.8 and test/strings.test.js.
 * @type {{ en: Record<string, string>, zh: Record<string, string> }}
 */
export const STRINGS = {
  en: {
    usbNotConnected: 'The car is not plugged in yet.',
    didNotCatch: 'Sorry, I did not catch that.',
    apiFailed: 'I could not reach the server.',
    deviceDisconnected: 'The car came unplugged. I have braked.',
    sessionTimedOut: 'Going to sleep.',
  },
  zh: {
    usbNotConnected: '小车还没连上。',
    didNotCatch: '没听清。',
    apiFailed: '连不上服务器。',
    deviceDisconnected: '小车断开了，我已经刹住。',
    sessionTimedOut: '我先休息了。',
  },
};

/**
 * @param {'en' | 'zh'} lang
 * @param {string} key
 * @returns {string}
 */
export function t(lang, key) {
  return STRINGS[lang]?.[key] ?? key;
}
