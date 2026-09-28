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
 * Whether a provider layer has everything a request to it needs.
 *
 * All of the fields, not just the address. "The baseURL is set" was the old
 * test for having a brain, and it passes for a layer with no key in it — a
 * robot that looks configured and fails on its first sentence. TTS carries a
 * fourth field (§8.2) and is recognised by having one, so the check does not
 * need to be told which layer it is looking at.
 *
 * @param {{ baseURL: string, apiKey: string, model: string, voice?: string, prompt?: string }} layer
 * @returns {boolean}
 */
export function layerReady(layer) {
  if (!layer?.baseURL || !layer.apiKey || !layer.model) return false;
  return !('voice' in layer) || Boolean(layer.voice);
}

/**
 * Whether the car has been taught which way is which — both answers, not one.
 *
 * Measured, not its value: `false` is a result ("I checked, it is not
 * reversed") and only `null` means nobody asked. Half an answer is the
 * dangerous state, so this is `&&` — a car that knows left from right but not
 * forward from backward drives into the wall behind it on the first command,
 * with the drawing and the checklist both saying it was ready.
 *
 * One function because two readers need the same answer: the parts the robot
 * is drawn without (robot.js) and the step the button offers (app.js).
 *
 * @param {Calibration} cal
 * @returns {boolean}
 */
export function directionsTaught(cal) {
  return cal.steerSwapped !== null && cal.driveSwapped !== null;
}

/**
 * @param {string} [_navLang] ignored since 2026-09-17; kept so the signature
 *   and its tests survive until a language switcher exists to justify reading
 *   it again.
 * @returns {Config}
 */
export function defaultConfig(_navLang = globalThis.navigator?.language) {
  return {
    // `prompt` is optional vocabulary for whisper, and empty means none is
    // sent — see the comment on #post in stt-openai-compat.js for why that is
    // the default. layerReady() does not ask for it.
    stt: { baseURL: '', apiKey: '', model: '', prompt: '' },
    llm: { baseURL: '', apiKey: '', model: '' },
    tts: { baseURL: '', apiKey: '', model: '', voice: '' },
    // English, always, as of 2026-09-17. This is an open-source project and the
    // default has to be the language its readers share; a Chinese phone landing
    // on a Chinese UI made the source's default and the running default two
    // different things, and only one of them is what anybody sees.
    //
    // The zh table stays. It is a locale, not dead code — spec §11.3 still
    // rules out a third language, and the switcher that selects this comes
    // with i18n proper. Until then nothing selects it, which is the point:
    // shipping a switcher is a decision, inferring one from the handset is not.
    lang: 'en',
    // null, NOT lang — see §11.1. "No preference recorded" is the default.
    replyLang: null,
    // Not guesses: waiting item ⑥ measured both on this phone (§8.2). A
    // different device may need §7.3's calibration to say otherwise.
    bargeIn: true,
    ttsPath: 'webaudio',
    // Off, as of 2026-09-27. Turning the screen on is already the robot being
    // called, the way opening an app is: the name on top of that is a second
    // knock on an open door. On, it brings back SLEEPING and §5.2's doze.
    wakeWord: false,

    /**
     * What has been measured about THIS car (spec §7 of the 2026-09-17 design;
     * items ① and ② of the main spec's §12).
     *
     * `null` means "never measured" and the reader falls back to the constant
     * in executor.js / ftdi.js, so an untouched config behaves byte for byte
     * as the product did before any of this existed.
     *
     * Not `false`, which is a measurement — "I checked, it is not reversed".
     * Defaulting to it would tick the checklist for a car nobody has touched,
     * and ① is precisely the step that, skipped, makes the car turn the wrong
     * way on its first drive.
     *
     * steerSwapped is a boolean and never a byte: "is it reversed" is all ①
     * can answer, and 0x40 in a settings file is a protocol detail nobody
     * reading it could check. driveSwapped is the same answer about the other
     * driver — see ①b in docs/hardware.md.
     */
    calibration: {
      /** @type {boolean | null} */ steerSwapped: null,
      /** @type {boolean | null} */ driveSwapped: null,
      /** @type {number | null} */ bytesPerMs: null,
    },
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
      wakeWord: p.wakeWord ?? d.wakeWord,
      // Spread over the default, so a config stored before this field existed
      // loads as "never measured" rather than as undefined. Reading
      // undefined.steerSwapped throws at startup, and the product would refuse
      // to open over a field whose entire meaning is "nothing is known yet".
      // The spread reaches inside the object too, which is what carries a
      // config calibrated before ①b existed: steerSwapped kept, driveSwapped
      // null rather than undefined.
      calibration: { ...d.calibration, ...p.calibration },
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
 *   stt: Layer & { prompt: string },
 *   llm: Layer,
 *   tts: Layer & { voice: string },
 *   lang: 'en' | 'zh',
 *   replyLang: 'en' | 'zh' | null,
 *   bargeIn: boolean,
 *   ttsPath: 'webaudio' | 'loopback' | 'speechSynthesis',
 *   wakeWord: boolean,
 *   calibration: Calibration,
 * }} Config
 *
 * @typedef {{
 *   steerSwapped: boolean | null,
 *   driveSwapped: boolean | null,
 *   bytesPerMs: number | null,
 * }} Calibration
 */
