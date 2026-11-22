// The only module in the app that touches localStorage.
//
// Spec §8.2: one group per provider layer, with the preferences FLAT alongside
// them — not nested under {providers, prefs}. Nesting would make "which of
// these are sticky state" a structural fact; STICKY below buys the same thing
// in one line, and flat stays backward compatible: a config written before a
// field existed is simply missing that key.

import { TEMPLATE_IDS, TEMPLATES } from './bodies.js';

export const CONFIG_KEY = 'voicebot.config';

/**
 * Every action some body can carry out, derived from the templates rather
 * than listed a second time. It is no longer what a reflex is filtered
 * against: the body is not known when a reflex is parsed, and "this body does
 * not have that action" is answered against `body.actions` when the trigger
 * fires. Kept as the answer to "can any body do this at all?".
 */
export const REFLEX_TOOLS = [
  ...new Set(Object.values(TEMPLATES).flatMap((body) => body.actions.map((a) => a.name))),
];

/** The format beasaltfish/robot-simple-commands was trained on (spec §2.4). */
export const DEFAULT_STATE = 'Robot said: "{robot}"\nPerson said: "{person}"';
export const DEFAULT_THRESHOLD = 0.8;

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
 * What the reflex still needs before it could run, in the order the admin
 * page asks for them. Empty means complete, switched on or not: the page's
 * Try reads this, so a reflex can be tried while it is off.
 * @param {ReflexLayer} r
 * @returns {Array<'baseURL' | 'apiKey' | 'model' | 'question'>}
 */
export function reflexMissing(r) {
  /** @type {Array<'baseURL' | 'apiKey' | 'model' | 'question'>} */
  const missing = [];
  for (const k of /** @type {const} */ (['baseURL', 'apiKey', 'model'])) if (!r[k]) missing.push(k);
  if (r.question === null) missing.push('question');
  return missing;
}

/**
 * The reflex runs only with somewhere to ask AND something to ask, and only
 * while switched on. A layer with a key but no question is a character that
 * has not picked one yet; one switched off keeps its question for later.
 * @param {ReflexLayer} r
 */
export function reflexReady(r) {
  return r.enabled !== false && reflexMissing(r).length === 0;
}

const isPlain = (/** @type {unknown} */ v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The configurable half of a body, copied key by key and only when the shape
 * allows it. Never invent a key: an absent one means "follow the template",
 * and an empty list a file did not contain is not the same thing. Anything
 * wrong deeper than this is `bodyProblem`'s job, when the body is written.
 * @param {any} p
 * @returns {BodyPatch}
 */
function patchOf(p) {
  /** @type {BodyPatch} */
  const patch = {};
  if (typeof p.template === 'string') patch.template = p.template;
  if (isPlain(p.label)) patch.label = p.label;
  const prompts = promptsOf(p.prompts);
  if (prompts) patch.prompts = prompts;
  if (Array.isArray(p.actions)) patch.actions = p.actions;
  if (Array.isArray(p.triggers)) patch.triggers = p.triggers;
  return patch;
}

/**
 * A stored `prompts` patch, or undefined when its shape is wrong.
 *
 * The prompt is assembled straight from these strings (`buildSystemPrompt`
 * joins `rules`), so `rules: 'one paragraph'` would throw there and surface as
 * an LLM failure with nothing on screen to explain it. This is the load path,
 * where nobody is at hand to be asked, so the whole `prompts` key is dropped
 * and the template's own words apply — the same deal as `normalizeReflex`:
 * one bad value costs that value, not the character.
 *
 * `resolveBody` deliberately keeps a bad shape, because `bodyProblem` must be
 * able to refuse a body a person typed in the editor. This check belongs to
 * the save file, not to resolution.
 * @param {any} p
 * @returns {Partial<import('./bodies.js').Prompts> | undefined}
 */
function promptsOf(p) {
  if (!isPlain(p)) return undefined;
  /** @type {Partial<import('./bodies.js').Prompts>} */
  const prompts = {};
  if ('voice' in p) {
    if (typeof p.voice !== 'string' || p.voice.trim() === '') return undefined;
    prompts.voice = p.voice;
  }
  if ('rules' in p) {
    if (!Array.isArray(p.rules) || p.rules.some((/** @type {unknown} */ r) => typeof r !== 'string')) return undefined;
    prompts.rules = p.rules;
  }
  return prompts;
}

/**
 * Which body this character has, from a file that may predate the field. The
 * result is the patch, not a resolved body: `resolveBody` belongs to the brain
 * and the admin, which are the only places that know a template's actions.
 *
 * The three cases differ on purpose:
 * - no `body` key at all — every character written before this field existed
 *   was a car, so it is a toy;
 * - an id the templates know (or the old `car`) — that id and the rest of the
 *   patch, as saved;
 * - an id nobody knows — kept when it is a string and the patch carries
 *   `actions` or `template` (a body of one's own), otherwise `none` plus the
 *   patch keys whose shape is right. A typo must not claim wheels; a body of
 *   one's own is told apart by carrying `actions`, not by its id, and an id
 *   that is not a string is no id at all.
 *
 * `motion` was the old name for the same five values, so an old file loads
 * unchanged.
 * @param {unknown} body
 * @returns {BodyConfig}
 */
function bodyOf(body) {
  if (body === undefined) return { id: 'toy' };
  const p = /** @type {any} */ (isPlain(body) ? body : {});
  // `car` was this body's id until 2026-11-20: what you own is a toy you
  // tapped the motors of, not a category. A saved character keeps working.
  const raw = p.id ?? p.motion;
  const id = raw === 'car' ? 'toy' : raw;
  const patch = patchOf(p);
  // An unknown id is a typo only when nothing else says it is a body of one's
  // own. `actions` (its own program) or `template` (the base it copied) is
  // that claim; without either the id must not claim wheels. Keeping the id is
  // what lets the admin show "my-dog" instead of rewriting it to "Voice only".
  //
  // The id must be a string to be kept. A file with `actions` and no id used
  // to yield `{ id: undefined }`, which the brain reads as `toy`
  // (`body?.id ?? 'toy'`) and the admin as `none` (`resolveBody`) — one file,
  // two bodies. No id, nothing to keep: the fallback is the same one a typo
  // gets. Tested on `raw` because that is the value as stored; `car` has
  // already become a string above.
  if (typeof raw === 'string'
    && (TEMPLATE_IDS.includes(id) || patch.actions !== undefined || patch.template !== undefined)) {
    return { id, ...patch };
  }
  return { id: 'none', ...patch };
}

/**
 * Spec §2.3: field by field, so one bad value costs that value and not the
 * reflex. Options and actions are dropped one at a time for the same reason.
 * @param {unknown} raw
 * @returns {ReflexLayer}
 */
export function normalizeReflex(raw) {
  const d = defaultConfig().reflex;
  const p = /** @type {any} */ (isPlain(raw) ? raw : {});
  const t = p.threshold;
  return {
    ...d,
    ...p,
    // Only an explicit false is off: every reflex saved before the switch was on.
    enabled: p.enabled !== false,
    threshold: typeof t === 'number' && t >= 0 && t <= 1 ? t : d.threshold,
    state: typeof p.state === 'string' && p.state.includes('{person}') ? p.state : d.state,
    question: normalizeQuestion(p.question),
  };
}

/** @param {any} q @returns {ReflexQuestion | null} */
function normalizeQuestion(q) {
  if (!isPlain(q) || typeof q.name !== 'string' || !q.name
    || typeof q.instructions !== 'string' || !Array.isArray(q.options)) return null;
  const seen = new Set();
  /** @type {ReflexOption[]} */
  const options = [];
  for (const o of q.options) {
    if (!isPlain(o) || typeof o.choice !== 'string' || !o.choice || seen.has(o.choice)
      || typeof o.description !== 'string') continue;
    seen.add(o.choice);
    const actions = (Array.isArray(o.actions) ? o.actions : [])
      // Shape only. Whether this body has the action is a trigger-time
      // question (and the editor's); dropping it here would lose the saved
      // option for good when the user switches body and back.
      .filter((/** @type {any} */ a) => isPlain(a) && typeof a.name === 'string' && a.name !== '' && isPlain(a.args))
      .map((/** @type {any} */ a) => ({ name: a.name, args: a.args }));
    options.push({ choice: o.choice, description: o.description, actions });
  }
  return options.length >= 2 ? { name: q.name, instructions: q.instructions, options } : null;
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
    // Configurable reflex spec §2. Off until it has both a provider and a
    // question: reflexReady() asks for the three connection fields AND a
    // question, so no key, or no preset picked, means today's robot exactly.
    reflex: { baseURL: '', apiKey: '', model: '', enabled: true, threshold: DEFAULT_THRESHOLD, state: DEFAULT_STATE, question: null },
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
    // No body until somebody picks one: a new character is not a car by
    // accident. A file that predates the field still reads as the car it was
    // (`bodyOf`), so old characters keep working.
    body: { id: 'none' },
    // Who it is, in the admin's words; empty is brain.js's DEFAULT_PERSONA.
    // Only this part of the system prompt is theirs (see buildSystemPrompt).
    persona: '',

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
      reflex: normalizeReflex(p.reflex),
      // `??`, never `||`: a stored `false` for bargeIn is a calibration result,
      // and `||` would silently promote it back to true.
      lang: p.lang ?? d.lang,
      replyLang: p.replyLang ?? d.replyLang,
      bargeIn: p.bargeIn ?? d.bargeIn,
      ttsPath: p.ttsPath ?? d.ttsPath,
      wakeWord: p.wakeWord ?? d.wakeWord,
      // The patch as saved: `bodyOf` normalises the id over a leftover
      // `motion` and keeps the rest of the patch, but does not resolve a body.
      body: bodyOf(p.body),
      persona: typeof p.persona === 'string' ? p.persona : d.persona,
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
 *
 * One stored reflex action. `name` is whatever the file says: `normalizeReflex`
 * keeps any non-empty name, because a body of one's own may carry an action
 * the five templates do not, and the reflex must survive a switch of body and
 * back. Whether an action exists is a question about the body, answered
 * against `body.actions` when the trigger fires; the six names an editor
 * offers are that editor's candidate list, not a fact about this type.
 * @typedef {{ name: string, args: Record<string, unknown> }} ReflexCall
 * @typedef {{ choice: string, description: string, actions: ReflexCall[] }} ReflexOption
 * @typedef {{ name: string, instructions: string, options: ReflexOption[] }} ReflexQuestion
 * @typedef {Layer & { enabled: boolean, threshold: number, state: string, question: ReflexQuestion | null }} ReflexLayer
 * @typedef {{
 *   stt: Layer & { prompt: string },
 *   llm: Layer,
 *   tts: Layer & { voice: string },
 *   reflex: ReflexLayer,
 *   lang: 'en' | 'zh',
 *   replyLang: 'en' | 'zh' | null,
 *   bargeIn: boolean,
 *   ttsPath: 'webaudio' | 'loopback' | 'speechSynthesis',
 *   wakeWord: boolean,
 *   body: BodyConfig,
 *   persona: string,
 *   calibration: Calibration,
 * }} Config
 *
 * @typedef {import('./bodies.js').BodyPatch} BodyPatch
 * @typedef {BodyPatch & { id: string }} BodyConfig
 * @typedef {import('./bodies.js').BodyId} Motion
 *
 * @typedef {{
 *   steerSwapped: boolean | null,
 *   driveSwapped: boolean | null,
 *   bytesPerMs: number | null,
 * }} Calibration
 */
