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
    // NOT "wake it": this button opens the microphone. Whether the robot wakes
    // is up to whoever says its name.
    fabStart: 'Listen',
    fabKeys: 'Set me up',
    fabPair: 'Plug me in',
    fabSteer: 'Teach me left',
    // Composed with KEYWORDS[0] at render time, never stored joined — a fixed
    // line containing the wake word is a line TTS could read aloud, and the
    // robot would answer itself. test/strings.test.js enforces that.
    sayThis: 'Say',
    fabStop: 'STOP',
    sleepBtn: 'Let it sleep',
    settings: 'Settings',
    close: 'Close',
    back: 'Back',
    stepKeys: 'Give it a brain',
    stepCar: 'Give it a body',
    stepSteer: 'Teach it left and right',
    calTitle: 'Teach it left and right',
    calIntro: "I'll make one turn. Watch the car.",
    calGo: 'Go',
    calAsk: 'Which way did it go?',
    calLeft: '← Left',
    calRight: 'Right →',
    calAgain: 'Missed it — again',
    calDone: 'Got it. I know my left from my right now.',
    calNoCar: 'Plug the car in first.',
    // Kept for the fab's aria-label: the face says STOP, the screen reader
    // gets the whole phrase.
    emergencyStop: 'EMERGENCY STOP',
    booting: 'Loading the wake-word model…',
    micDenied: 'Microphone access was refused. Nothing can be heard without it.',
    keywordsInvalid: 'A keyword uses a token this model does not know: ',
    // The three instruments, named the way the setup sheet and the drawing
    // name them. Somebody who has to go and fix a key needs to read "its ears
    // stopped working", not "STT 401" — the acronym is the name of a part we
    // happened to buy. What follows each of these is the raw provider message,
    // which stays English on purpose: it is instrument reading, not copy.
    faultEars: 'Its ears stopped working: ',
    faultMind: 'Its mind stopped working: ',
    faultVoice: 'Its voice stopped working: ',
    faultUnknown: 'Something went wrong: ',
    usbNotPaired: 'This phone and the car have not met yet.',
    pairNow: 'Introduce them →',
    screenOffMissed: 'Your phone could not hear me while the screen was off. '
      + 'Keep the screen on if you want me listening.',
    // --- The setup sheet (spec §8 of the 2026-09-17 design) --------------
    // The three layers are named by what they do for the robot, not by their
    // acronyms. Somebody setting this up is giving a toy a sense; STT, LLM and
    // TTS are the names of the parts we happened to buy.
    settingsLanguage: 'Language',
    settingsSticky: 'What it picked up by voice',
    settingsForget: 'Forget it',
    settingsTools: 'Instruments',
    setupTitle: 'Give it a brain',
    setupEars: 'Ears',
    setupMind: 'Mind',
    setupVoice: 'Voice',
    setupEarsWhat: 'hears what you say',
    setupMindWhat: 'decides what to do',
    setupVoiceWhat: 'says it back',
    setupProvider: 'Provider',
    setupBaseUrl: 'Address',
    setupModel: 'Model',
    setupVoiceField: 'Voice',
    setupKey: 'Key',
    setupCustom: 'Other…',
    // NOT "the browser will speak instead": config.ttsPath keeps a
    // 'speechSynthesis' value that nothing in v1 ever selects (§7.2), and
    // app.js always builds the cloud provider. Leaving this empty does not
    // start a fallback, it starts a robot with nothing to speak with.
    setupVoiceOptional: 'It starts without this — and stays silent.',
    setupTest: 'Test',
    setupNeedKey: 'Paste a key first',
    setupSave: 'Save',
    setupSaved: 'Saved',
    // Shown under the Ears result. It is the honest limit of the shipped clip.
    setupHeardNote: 'That was a recording, not you — it only proves the key works.',
    setupEarsNote: 'Ears and Mind are the two it cannot start without.',
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
    fabStart: '开始听',
    fabKeys: '先设置一下',
    fabPair: '给我插上',
    fabSteer: '教我左右',
    sayThis: '说',
    fabStop: '停',
    sleepBtn: '让它睡觉',
    settings: '设置',
    close: '关闭',
    back: '返回',
    stepKeys: '给它一个大脑',
    stepCar: '给它一个身体',
    stepSteer: '教它左和右',
    calTitle: '教它左和右',
    calIntro: '我会拐一下，看着车。',
    calGo: '开始',
    calAsk: '它往哪边拐了？',
    calLeft: '← 左边',
    calRight: '右边 →',
    calAgain: '没看清，再来',
    calDone: '记住了。我分得清左右了。',
    calNoCar: '先把车插上。',
    emergencyStop: '急停',
    booting: '正在加载唤醒词模型…',
    micDenied: '麦克风被拒绝了。没有它什么都听不见。',
    keywordsInvalid: '关键词里有这个模型不认识的 token：',
    faultEars: '耳朵出问题了：',
    faultMind: '脑子出问题了：',
    faultVoice: '嗓子出问题了：',
    faultUnknown: '出了点问题：',
    usbNotPaired: '手机还没见过这台小车。',
    pairNow: '去认识一下 →',
    screenOffMissed: '你的手机黑屏之后听不见我。想让我一直听着，就别锁屏。',
    settingsLanguage: '语言',
    settingsSticky: '它从语音里记下的',
    settingsForget: '忘掉',
    settingsTools: '仪器',
    setupTitle: '给它一个大脑',
    setupEars: '耳朵',
    setupMind: '脑子',
    setupVoice: '嗓子',
    setupEarsWhat: '听见你说的话',
    setupMindWhat: '决定做什么',
    setupVoiceWhat: '说给你听',
    setupProvider: '服务商',
    setupBaseUrl: '地址',
    setupModel: '模型',
    setupVoiceField: '音色',
    setupKey: '密钥',
    setupCustom: '其它…',
    setupVoiceOptional: '不填也能启动，只是它不会出声。',
    setupTest: '测一下',
    setupNeedKey: '先把密钥贴进来',
    setupSave: '保存',
    setupSaved: '已保存',
    setupHeardNote: '这是一段录音，不是你——它只能证明密钥是通的。',
    setupEarsNote: '耳朵和脑子是它缺了就启动不了的两样。',
    stSleeping: '休眠',
    stListening: '在听',
    stCapturing: '听你说',
    stThinking: '在想',
    stSpeaking: '在说',
  },
};

/** @typedef {keyof typeof STRINGS.en} StringKey */

/**
 * Which part of the chain a failure came from.
 *
 * 'turn' is not an instrument: it is the last resort, for a throw nobody
 * expected. It has a name of its own because "something broke and we cannot
 * say what" still has to reach the screen — that case being silent is the
 * whole reason this type exists.
 *
 * @typedef {'stt' | 'llm' | 'tts' | 'turn'} FaultPart
 */

/** @type {Record<FaultPart, StringKey>} */
export const FAULT_LABEL = {
  stt: 'faultEars',
  llm: 'faultMind',
  tts: 'faultVoice',
  turn: 'faultUnknown',
};

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
