// The only module in the app that touches localStorage.
//
// Spec §8.2: one group per provider layer, with the preferences FLAT alongside
// them — not nested under {providers, prefs}. Nesting would make "which of
// these are sticky state" a structural fact; STICKY below buys the same thing
// in one line, and flat stays backward compatible: a config written before a
// field existed is simply missing that key.

export const CONFIG_KEY = 'voicebot.config';

/**
 * Spec §11.1: state that got set by voice and is invisible afterwards. The
 * settings page walks this list to show and reset them — a state that can be
 * entered but not left is a trap.
 */
export const STICKY = /** @type {const} */ (['ttsPath', 'replyLang']);

/**
 * @param {string} [navLang] defaults to the browser's language; passed in so
 *   this is testable, since node has no navigator.language.
 * @returns {Config}
 */
export function defaultConfig(navLang = globalThis.navigator?.language) {
  return {
    stt: { baseURL: '', apiKey: '', model: '' },
    llm: { baseURL: '', apiKey: '', model: '' },
    tts: { baseURL: '', apiKey: '', model: '', voice: '' },
    // Spec §11.3: no third language. Anything that is not Chinese gets the
    // product default, which is English.
    lang: String(navLang ?? '').startsWith('zh') ? 'zh' : 'en',
    // null, NOT lang — see §11.1. "No preference recorded" is the default.
    replyLang: null,
    // Not guesses: waiting item ⑥ measured both on this phone (§8.2). A
    // different device may need §7.3's calibration to say otherwise.
    bargeIn: true,
    ttsPath: 'webaudio',
  };
}

/**
 * @param {StorageLike} [storage]
 * @returns {Config}
 */
export function loadConfig(storage = globalThis.localStorage) {
  const d = defaultConfig();
  try {
    const raw = storage?.getItem(CONFIG_KEY);
    if (!raw) return d;
    const p = JSON.parse(raw);
    return {
      stt: { ...d.stt, ...p.stt },
      llm: { ...d.llm, ...p.llm },
      tts: { ...d.tts, ...p.tts },
      // `??`, never `||`: a stored `false` for bargeIn is a calibration result,
      // and `||` would silently promote it back to true.
      lang: p.lang ?? d.lang,
      replyLang: p.replyLang ?? d.replyLang,
      bargeIn: p.bargeIn ?? d.bargeIn,
      ttsPath: p.ttsPath ?? d.ttsPath,
    };
  } catch {
    return d;
  }
}

/** @param {Config} cfg @param {StorageLike} [storage] */
export function saveConfig(cfg, storage = globalThis.localStorage) {
  storage?.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

/** @param {Config} cfg @returns {Config} */
export function resetSticky(cfg) {
  const d = defaultConfig(cfg.lang);
  return { ...cfg, ttsPath: d.ttsPath, replyLang: d.replyLang };
}

/**
 * Only the two methods this module actually calls. Narrower than `Storage` on
 * purpose: it is what makes the storage injectable, and node has no Storage.
 * @typedef {{
 *   getItem(key: string): string | null,
 *   setItem(key: string, value: string): void,
 * }} StorageLike
 *
 * @typedef {{ baseURL: string, apiKey: string, model: string }} Layer
 * @typedef {{
 *   stt: Layer,
 *   llm: Layer,
 *   tts: Layer & { voice: string },
 *   lang: 'en' | 'zh',
 *   replyLang: 'en' | 'zh' | null,
 *   bargeIn: boolean,
 *   ttsPath: 'webaudio' | 'loopback' | 'speechSynthesis',
 * }} Config
 */
