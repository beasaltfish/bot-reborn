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
 *
 * Deliberately NOT annotated as Record<string, string>: that annotation would
 * widen the key type back to `string` and quietly undo StringKey below, whose
 * whole job is to make a misspelled key a compile error instead of something
 * TTS reads out loud.
 */
export const STRINGS = {
  en: {
    // --- Fixed TTS lines: spoken aloud, bypassing the LLM (§6.8) -----------
    usbNotConnected: 'The car is not plugged in yet.',
    didNotCatch: 'Sorry, I did not catch that.',
    apiFailed: 'I could not reach the server.',
    deviceDisconnected: 'The car came unplugged. I have braked.',
    sessionTimedOut: 'Going to sleep.',
    // --- On-screen copy: never spoken -------------------------------------
    // The fab carries one word at a time and the screen has no other copy, so
    // these are short on purpose — §11 budgets the whole main screen at ten
    // words. None is ever spoken: the fab is a button, not a line.
    fabStart: 'Wake it',
    fabStop: 'STOP',
    sleepBtn: 'Let it sleep',
    settings: 'Settings',
    // Kept for the fab's aria-label: the face says STOP, the screen reader
    // gets the whole phrase.
    emergencyStop: 'EMERGENCY STOP',
    booting: 'Loading the wake-word model…',
    micDenied: 'Microphone access was refused. Nothing can be heard without it.',
    keywordsInvalid: 'A keyword uses a token this model does not know: ',
    usbNotPaired: 'This phone has never been paired with the car. '
      + 'Open the connectivity test once to pair it.',
    screenOffMissed: 'Your phone could not hear me while the screen was off. '
      + 'Keep the screen on if you want me listening.',
    stSleeping: 'asleep',
    stListening: 'listening',
    stCapturing: 'hearing you',
    stThinking: 'thinking',
    stSpeaking: 'speaking',
  },
  zh: {
    usbNotConnected: '小车还没连上。',
    didNotCatch: '没听清。',
    apiFailed: '连不上服务器。',
    deviceDisconnected: '小车断开了，我已经刹住。',
    sessionTimedOut: '我先休息了。',
    fabStart: '叫醒它',
    fabStop: '停',
    sleepBtn: '让它睡觉',
    settings: '设置',
    emergencyStop: '急停',
    booting: '正在加载唤醒词模型…',
    micDenied: '麦克风被拒绝了。没有它什么都听不见。',
    keywordsInvalid: '关键词里有这个模型不认识的 token：',
    usbNotPaired: '这台手机还没和小车配过对。先去连通性测试页连一次。',
    screenOffMissed: '你的手机黑屏之后听不见我。想让我一直听着，就别锁屏。',
    stSleeping: '休眠',
    stListening: '在听',
    stCapturing: '听你说',
    stThinking: '在想',
    stSpeaking: '在说',
  },
};

/** @typedef {keyof typeof STRINGS.en} StringKey */

/**
 * @param {'en' | 'zh'} lang
 * @param {StringKey} key a misspelling is a typecheck error now; the runtime
 *   fallback below guards `lang`, which comes from storage, not `key`, which
 *   comes from source.
 * @returns {string}
 */
export function t(lang, key) {
  return STRINGS[lang]?.[key] ?? key;
}
