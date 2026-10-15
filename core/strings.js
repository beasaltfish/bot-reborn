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
    fabBrain: 'Find my brain',
    fabPair: 'Plug me in',
    fabSteer: 'Teach me which way',
    // Composed with KEYWORDS[0] at render time, never stored joined — a fixed
    // line containing the wake word is a line TTS could read aloud, and the
    // robot would answer itself. test/strings.test.js enforces that.
    sayThis: 'Say',
    fabStop: 'STOP',
    // The microphone icon's two readings. Off is a status, not an offer —
    // nothing is said about tapping it, because tapping it does nothing.
    micOn: 'Listening — tap to stop',
    micOff: 'Not listening',
    settings: 'Settings',
    // In a tab only. Installed, it opens full screen and sideways.
    install: 'Install as app',
    close: 'Close',
    back: 'Back',
    stepBrain: 'Give it a brain',
    stepCar: 'Give it a body',
    stepSteer: 'Teach it directions',
    calTitle: 'Teach it directions',
    // Two questions, and forward comes first: the turn below is driven
    // forward, so on a car wired backwards it is a reversing car being asked
    // which way it turned — and that answer comes out the other way round.
    calDriveIntro: "I'll drive straight for a moment. Watch the car.",
    calDriveAsk: 'Did it go forward or backward?',
    calForward: '↑ Forward',
    calBack: '↓ Backward',
    calIntro: "Now I'll make one turn. Watch the car.",
    calGo: 'Go',
    calAsk: 'Which way did it go?',
    calLeft: '← Left',
    calRight: 'Right →',
    calAgain: 'Missed it — again',
    calDone: 'Got it. I know forward from back and left from right now.',
    calNoCar: 'Plug the car in first.',
    // Kept for the fab's aria-label: the face says STOP, the screen reader
    // gets the whole phrase.
    emergencyStop: 'EMERGENCY STOP',
    booting: 'Waking up…',
    // After the screen comes back on, if the browser wants a fresh tap before
    // it will let the robot hear again.
    needsTap: 'Tap Listen and I will hear you again.',
    micDenied: 'Microphone access was refused. Nothing can be heard without it.',
    // The three instruments, named the way the admin page and the drawing
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
    // The body's own failures. The brain's (a key, a provider) are spoken by
    // the brain; these are the ones only the phone can see.
    brainHow: 'Open the admin page on the computer and scan this robot’s code with this phone.',
    linkLost: 'Lost its brain. Looking for it again…',
    rejectToken: 'Its brain does not know this phone any more. Scan the code again.',
    rejectBusy: 'Another body is using this brain right now.',
    rejectUnconfigured: 'Its brain is not set up yet. Fill in its keys on the admin page.',
    rejectProtocol: 'This page and its brain are different versions. Reload the page.',
    rejectOrigin: 'Its brain refused this page.',
    // Plain http without the Chrome flag: the browser hides the car and the
    // microphone, and nothing else on the screen would say why.
    insecure: 'Chrome is not treating this page as secure, so it cannot reach the car or the microphone. The admin page shows how to fix it.',
    settingsBrain: 'Brain',
    settingsBrainLinked: 'Linked',
    settingsForgetBrain: 'Forget it',
    settingsLanguage: 'Language',
    settingsTools: 'Instruments',
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
    fabPair: '给我插上',
    fabSteer: '教我方向',
    sayThis: '说',
    fabStop: '停',
    micOn: '在听——点一下收工',
    micOff: '没在听',
    install: '安装成应用',
    settings: '设置',
    close: '关闭',
    back: '返回',
    stepCar: '给它一个身体',
    stepSteer: '教它方向',
    calTitle: '教它方向',
    calDriveIntro: '我会直着开一下，看着车。',
    calDriveAsk: '它是往前开还是往后退？',
    calForward: '↑ 往前',
    calBack: '↓ 往后',
    calIntro: '接下来我会拐一下，看着车。',
    calGo: '开始',
    calAsk: '它往哪边拐了？',
    calLeft: '← 左边',
    calRight: '右边 →',
    calAgain: '没看清，再来',
    calDone: '记住了。前后左右我都分得清了。',
    calNoCar: '先把车插上。',
    emergencyStop: '急停',
    booting: '正在醒来…',
    needsTap: '点一下「开始听」，我就又能听见了。',
    micDenied: '麦克风被拒绝了。没有它什么都听不见。',
    faultEars: '耳朵出问题了：',
    faultMind: '脑子出问题了：',
    faultVoice: '嗓子出问题了：',
    faultUnknown: '出了点问题：',
    usbNotPaired: '手机还没见过这台小车。',
    pairNow: '去认识一下 →',
    fabBrain: '找到我的大脑',
    stepBrain: '给它一个大脑',
    brainHow: '在电脑上打开管理页面，用这台手机扫这个机器人的二维码。',
    linkLost: '和大脑断开了，正在重新找…',
    rejectToken: '大脑不认识这台手机了，请重新扫码。',
    rejectBusy: '已经有别的身体在用这个大脑。',
    rejectUnconfigured: '大脑还没设置好，先在管理页面把 key 填上。',
    rejectProtocol: '这个页面和大脑版本不一致，请刷新页面。',
    rejectOrigin: '大脑拒绝了这个页面。',
    insecure: 'Chrome 没把这个页面当成安全页面，所以碰不到小车和麦克风。管理页面上有设置方法。',
    settingsBrain: '大脑',
    settingsBrainLinked: '已连接',
    settingsForgetBrain: '忘掉它',
    settingsLanguage: '语言',
    settingsTools: '仪器',
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
