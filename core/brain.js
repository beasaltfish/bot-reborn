// Tool definitions, system prompt, the validator, and the orchestration of one
// conversational turn. Spec §6 lives here in its entirety.
//
// Everything this module needs — the LLM, the executor, the TTS, the earcons,
// the config — arrives through the constructor, so it can be tested without a
// browser and a provider can be swapped without touching it.

import { t } from './strings.js';
import { TEMPLATES, resolveBody } from './bodies.js';
import { drawRandom, describeDraw } from './tarot.js';
import { VERBS } from './verbs.js';
import { expand, expectationOf } from './actions.js';

const HISTORY_ROUNDS = 6;

/**
 * How many times a turn may go back to the model with a returning tool's
 * result (tarot mode spec §4). Past it the turn simply ends: a model that
 * keeps asking is not going to be answered by one more result.
 */
export const MAX_TOOL_ROUNDS = 2;

/**
 * How long a drawn card waits for its reading before the screen gives up and
 * turns it over anyway (tarot mode spec §8): a shuffle that spins forever
 * looks like a hang, and a card with an apology is at least an answer.
 */
export const READING_TIMEOUT_MS = 20000;

const LANG_NAME = { zh: 'Chinese', en: 'English' };

// --- Tool definitions (spec §6.2) ------------------------------------------
//
// English, always: the tool descriptions and the system prompt are two halves
// of the same prompt and should not be half Chinese.
//
// The list itself is the body's: one tool per action it carries, described by
// the words the body wrote. Nothing here decides by id, and there is nothing to
// add when a new action is invented — the body says it, and the model sees it.
//
// A queue is still expressed as `move.steps` rather than parallel tool calls,
// because parallel calling is where provider implementations differ most.

/**
 * One tool as the provider sees it (spec §6.2): a name, the words the body
 * wrote for it, and the arguments it takes. Providers reject fields they do not
 * know, so nothing else may be added here.
 * @typedef {{
 *   type: 'function',
 *   function: { name: string, description: string, parameters: import('./verbs.js').JsonSchemaSubset },
 * }} Tool
 */

/**
 * The one tool that is not an action. It writes the language preference into
 * the config, not the body, so every body is offered it and no body can add one
 * (spec §6.2, rule 5).
 * @type {Tool}
 */
const SET_REPLY_LANGUAGE = {
  type: 'function',
  function: {
    name: 'set_reply_language',
    description: 'Record a LASTING preference for which language to reply in. Call this ONLY when the user explicitly asks you to always use a language ("from now on speak Chinese", "stop speaking English"). Do NOT call it for a one-off request like "say that again in English" — just do that directly without calling anything. Use "auto" to go back to following whatever language the user speaks.',
    parameters: {
      type: 'object',
      required: ['lang'],
      properties: { lang: { enum: ['zh', 'en', 'auto'] } },
    },
  },
};

/**
 * The tools a body is offered: one per action it carries, in its own order,
 * described by the words the body wrote, plus `set_reply_language`. No branch
 * on an id: a body that cannot pose is a body with no pose action.
 * @param {import('./bodies.js').Body} body
 * @returns {Tool[]}
 */
export function toolsOf(body) {
  return [
    ...body.actions.map((action) => ({
      type: /** @type {const} */ ('function'),
      function: {
        name: action.name,
        description: action.say,
        parameters: action.args ?? { type: 'object', properties: {} },
      },
    })),
    SET_REPLY_LANGUAGE,
  ];
}

/**
 * The toy's tools. Kept as a name because the admin's Test button
 * (`server/check-api.js`) asks a provider to accept the tools a toy is offered
 * and has no body of its own to hand. `toolsOf` is what the brain asks.
 */
export const TOOLS = toolsOf(resolveBody('toy'));

/**
 * Tools whose result goes back to the model, which is asked again with it
 * (tarot mode spec §4). Every other tool is an action: done, and forgotten.
 * Derived from the body: an action says `returns`, and that is the whole list.
 * @param {import('./bodies.js').Body} body
 * @returns {ReadonlySet<string>}
 */
function returningToolsOf(body) {
  return new Set(body.actions.filter((action) => action.returns).map((action) => action.name));
}

// --- System prompt (spec §6.8) ---------------------------------------------
//
// The prompt is assembled, not written. Who it is comes from the admin (or the
// default below); what its body is and what it may call come from
// `core/bodies.js` — `prompts.voice`, the ordered `prompts.rules`, and whatever
// rules each action carries. Nothing here decides by id: a body that cannot
// move says so in its own voice, and the rules stay data so a persona cannot
// talk the model out of calling a tool.

/** Who it is when the admin has written nothing. Its face is here, not in the body part: not every body has one. */
// One line per paragraph, unlike the rest: the admin page shows it in a box.
export const DEFAULT_PERSONA = 'You are a small living creature with a face and a voice. '
  + 'You are not a robot or a machine. Never call yourself "the robot". Speak in the first person.\n\n'
  + 'You are curious, playful, a little proud, and easily teased. You have moods, '
  + 'likes and dislikes, and you remember how the user has just treated you.';

/** A persona longer than this is cut: it is a description, not a second prompt. */
export const MAX_PERSONA = 4000;

/**
 * Persona, then the body's voice, then its rules in the order the body keeps
 * them (each action's rules after those, in `actions` order), then the line the
 * speaker depends on. The language line belongs to a body that speaks: one that
 * answers in clips has no reply to put in a language, and a model reading such
 * a line would only learn to write one.
 *
 * `body` is a resolved body (`resolveBody`), not an id. No body at all is the
 * toy, which is what this prompt was before a body became a setting.
 *
 * @param {{ replyLang: 'zh' | 'en' | null, persona?: string, body?: import('./bodies.js').Body }} cfg
 * @returns {string}
 */
export function buildSystemPrompt(cfg) {
  const body = cfg.body ?? resolveBody('toy');
  const persona = cfg.persona?.trim().slice(0, MAX_PERSONA) || DEFAULT_PERSONA;
  // The rules are data, taken whole and in the order the body keeps them; each
  // action's rules follow, in `actions` order.
  //
  // Note what is NOT assembled here: the "your reply is read aloud" paragraph
  // is one of the template's `prompts.rules` (RULES_SPOKEN), not a sentence
  // derived from `body.reply`. It has to stay there because the frozen golden
  // puts it between the driving rules and the `duration_ms` line. So a body
  // written from scratch without it gets no such paragraph, and `reply` below
  // decides only the language line — the one thing that cannot be data,
  // because it depends on the user's recorded preference.
  const rules = body.prompts.rules.slice();
  for (const action of body.actions) if (action.rules) rules.push(action.rules);

  let prompt = [persona, body.prompts.voice, rules.join('\n')].join('\n\n');

  // 1. A recorded language preference (spec §11.1). null = follow the user,
  //    which is the model's default behaviour, so inject nothing.
  if (body.reply === 'tts' && cfg.replyLang) {
    prompt += `\nAlways reply in ${LANG_NAME[cfg.replyLang]}, `
            + 'regardless of which language the user speaks.';
  }

  return prompt;
}

/** The default creature on wheels, as the tests read it. */
export const SYSTEM_PROMPT = buildSystemPrompt({ replyLang: null, body: resolveBody('toy') });
/** The default creature with no body that moves (body motion spec §3, §4.1 ②). */
export const SYSTEM_PROMPT_STILL = buildSystemPrompt({ replyLang: null, body: resolveBody('none') });
/** The tarot reader on a screen (tarot mode spec §7). */
export const SYSTEM_PROMPT_TAROT = buildSystemPrompt({ replyLang: null, body: resolveBody('tarot') });
/** The cartoon dog on a screen (pet screen spec §4.3). */
export const SYSTEM_PROMPT_PET = buildSystemPrompt({ replyLang: null, body: resolveBody('pet') });

// --- The validator (spec §6.6) ---------------------------------------------
//
// Accept or drop. NOTHING here modifies a value the model gave us. Clamping
// would fail in the worst direction: the car moves, by an amount you did not
// ask for, and you cannot tell.

/**
 * One step of an action's program, as `core/actions.js` expands it: a verb and
 * the arguments the verb was given. `drive` carries `ms` — a number of
 * milliseconds, or the word `hold` (core/verbs.js).
 * @typedef {import('./actions.js').Step} ProgramStep
 */

/**
 * One thing the model asked for, as this body would run it: the action's name
 * and the program its arguments expanded to. Steps that could not run are not
 * here; they are in `reasons`.
 * @typedef {{ name: string, steps: ProgramStep[] }} Program
 */

/** The executor's own step: the same three fields the wire frame has. */
/** @typedef {{ drive: string, steer: string, duration_ms: number }} MoveStep */

/**
 * Every action the five templates define, by name. A call is judged against the
 * body's own definition of it when the body carries one; this is the fallback
 * for a call to an action the body does not have, which is still refused where
 * the body's answer is known — "this body cannot move" is a better sentence
 * than "no such tool" when the tool exists and this body simply dropped it.
 * @type {Map<string, import('./bodies.js').Action>}
 */
const REFERENCE_ACTIONS = new Map();
for (const body of Object.values(TEMPLATES)) {
  for (const action of body.actions) {
    if (!REFERENCE_ACTIONS.has(action.name)) REFERENCE_ACTIONS.set(action.name, action);
  }
}

/** An action that takes no arguments, for the tools that say nothing. */
/** @type {import('./verbs.js').JsonSchemaSubset} */
const NO_ARGS = { type: 'object', properties: {} };

/**
 * Every drop says why.
 *
 * `dropped` used to be a bare count, and the count was the whole report: a
 * turn that spoke its sentence and never moved looked, from outside, exactly
 * like a turn where the model simply chose not to call anything. The reasons
 * are diagnostics and go to the console in English — nobody is meant to read
 * them on the screen, and the one thing worth knowing about a refused command
 * is WHICH field this robot refused.
 *
 * Accept or drop. NOTHING here modifies a value the model gave us: clamping
 * would fail in the worst direction — the car moves, by an amount you did not
 * ask for, and you cannot tell.
 *
 * @param {Array<{ id?: string, name: string, args: object | null, rawArguments: string }>} toolCalls
 * @param {import('./bodies.js').Body} [body] the body the turn runs on. Its own
 *   definition of an action decides the action's arguments and program; a call
 *   to one it does not carry falls back to the reference definition, so the
 *   refusal below can say what was wrong with it and the caller can say that
 *   this body does not do it. No body at all judges every known action, which is
 *   what a caller with no turn (a saved reflex, a test) needs.
 * @returns {{ actions: Program[], replyLang: 'zh'|'en'|'auto'|null, dropped: number,
 *             reasons: string[], hadMoveIntent: boolean }}
 */
export function validate(toolCalls, body) {
  /** @type {Program[]} */
  const actions = [];
  /** @type {'zh'|'en'|'auto'|null} */
  let replyLang = null;
  /** @type {string[]} */
  const reasons = [];
  const drop = (/** @type {string} */ why) => { reasons.push(why); };
  let hadMoveIntent = false;

  /** @type {Map<string, import('./bodies.js').Action>} */
  const own = new Map((body?.actions ?? []).map((action) => [action.name, action]));

  for (const call of toolCalls) {
    const action = call.name === 'set_reply_language'
      ? undefined
      : own.get(call.name) ?? REFERENCE_ACTIONS.get(call.name);

    // An action that asks the body to go somewhere is a movement attempt even
    // when its arguments are unreadable or every one of its steps is refused,
    // and that is what earns the "I could not do that" beep. A pose is not: its
    // steps need no `move`.
    if (action && (action.run ?? []).some((step) => VERB_TABLE[step.verb]?.needs === 'move')) {
      hadMoveIntent = true;
    }

    if (call.args === null) {
      drop(`${call.name}: arguments were not valid JSON — ${call.rawArguments}`);
      continue;
    }
    const args = /** @type {any} */ (call.args);

    if (call.name === 'set_reply_language') {
      // Rule 5: it writes config, so it never becomes an action (spec §6.2).
      if (['zh', 'en', 'auto'].includes(args.lang)) replyLang = args.lang;
      else drop(`set_reply_language: rejected — ${JSON.stringify(args)}`);
      continue;
    }

    if (!action) {
      drop(`${call.name}: no such tool`);
      continue;
    }

    const wrong = argsProblem(action, args);
    if (wrong) { drop(wrong); continue; }

    const usable = usableArgs(action, args);
    for (const why of usable.reasons) drop(why);
    const { steps, dropped } = expand(action, usable.args);
    for (const refused of dropped) drop(refusalFor(action, refused));
    // Rule 4: if every step died, dispatch nothing.
    if (steps.length > 0) actions.push({ name: action.name, steps });
  }

  return { actions, replyLang, dropped: reasons.length, reasons, hadMoveIntent };
}

/**
 * Why these arguments cannot be this action's, in today's words, or null.
 *
 * A call is judged twice, and each judge knows something the other does not:
 * the action's schema knows an argument is one of five poses, and the verb's
 * schema knows a duration is an integer. This answers the first — a required
 * field missing, a walked argument that is not a list, or a value outside an
 * enum the action narrowed — because `expand` answers the second for every value
 * it fills, and it says so in the verb's own words.
 * @param {import('./bodies.js').Action} action
 * @param {any} args
 * @returns {string | null}
 */
function argsProblem(action, args) {
  const schema = action.args ?? NO_ARGS;
  const rejected = `${action.name}: rejected — ${JSON.stringify(args)}; ${expectationOf(schema)}`;

  // A walked argument is judged element by element by `expand`. What belongs
  // here is only whether it is a list at all — and the sentence says what came
  // instead, which is the one failure that used to go unreported: a model that
  // flattens the schema (drive/steer/duration_ms at the top level, no wrapper)
  // produced a turn with zero actions AND zero drops.
  for (const step of Array.isArray(action.run) ? action.run : []) {
    if (step.each === undefined) continue;
    if (!Array.isArray(/** @type {any} */ (args)?.[step.each])) {
      return `${action.name}: no ${step.each} array — got ${JSON.stringify(args)}`;
    }
  }

  // An action that takes nothing (`stop`, `draw_card`) ignores what came: it
  // never read its arguments, and a validator that refuses an empty list now
  // where it accepted one before is a refusal nobody asked for.
  const properties = schema.properties ?? {};
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return Object.keys(properties).length > 0 || (schema.required ?? []).length > 0 ? rejected : null;
  }

  for (const key of schema.required ?? []) {
    if (!(key in args)) return rejected;
  }
  for (const [key, sub] of Object.entries(properties)) {
    if (!(key in args)) continue;
    if (isWalked(action, key)) continue;
    if (!fitsSchema(args[key], sub)) return rejected;
  }
  return null;
}

/**
 * Whether an argument is the one a program walks, element by element. Its
 * elements are `expand`'s to refuse; the top level has nothing to add.
 * @param {import('./bodies.js').Action} action
 * @param {string} key
 * @returns {boolean}
 */
function isWalked(action, key) {
  return (Array.isArray(action.run) ? action.run : []).some((step) => step.each === key);
}

/**
 * The call's arguments with every element that does not fit the action's own
 * schema taken out, and one reason for each. `expand` walks what is left: it
 * knows how to fill a program, but it judges a step by the verb, and an action
 * may promise more than its verb does (`duration_ms` has a floor that `ms` does
 * not). Over-length is truncated, not refused, exactly as `expand` does it.
 * @param {import('./bodies.js').Action} action
 * @param {any} args
 * @returns {{ args: any, reasons: string[] }}
 */
function usableArgs(action, args) {
  /** @type {string[]} */
  const reasons = [];
  const out = { ...args };
  for (const step of Array.isArray(action.run) ? action.run : []) {
    if (step.each === undefined) continue;
    const list = /** @type {any[]} */ (args[step.each]);
    const walked = action.args?.properties?.[step.each];
    const max = walked?.maxItems;
    const elements = typeof max === 'number' ? list.slice(0, max) : list;
    out[step.each] = elements.filter((element) => {
      if (fitsSchema(element, walked?.items)) return true;
      reasons.push(`${action.name}: step rejected — ${JSON.stringify(element)}; ${expectationOf(walked?.items)}`);
      return false;
    });
  }
  return { args: out, reasons };
}

/**
 * Whether a value fits a schema of the subset the actions are written in. The
 * same vocabulary `core/actions.js` reads, kept here because a call is judged
 * against the action's own schema — which can be stricter than the verb it runs
 * (`duration_ms` starts at 300; `drive.ms` at 1). A schema that says nothing is
 * "cannot tell", not "no": `expand` still applies the verb.
 * @param {unknown} value
 * @param {import('./verbs.js').JsonSchemaSubset | undefined} schema
 * @returns {boolean}
 */
function fitsSchema(value, schema) {
  if (!schema || typeof schema !== 'object') return true;
  if (Array.isArray(schema.anyOf)) return schema.anyOf.some((branch) => fitsSchema(value, branch));
  if (schema.const !== undefined) return value === schema.const;
  if (Array.isArray(schema.enum)) return schema.enum.includes(/** @type {string | number} */ (value));

  switch (schema.type) {
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const obj = /** @type {Record<string, unknown>} */ (value);
      for (const key of schema.required ?? []) if (!(key in obj)) return false;
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        if (key in obj && !fitsSchema(obj[key], sub)) return false;
      }
      return true;
    }
    case 'array': {
      if (!Array.isArray(value)) return false;
      return schema.items ? value.every((item) => fitsSchema(item, schema.items)) : true;
    }
    case 'integer': {
      if (!Number.isInteger(value)) return false;
      const n = /** @type {number} */ (value);
      return (schema.minimum === undefined || n >= schema.minimum)
        && (schema.maximum === undefined || n <= schema.maximum);
    }
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'string': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    default: return true;
  }
}

/**
 * One of `expand`'s refusals, in the model's own words: the value it sent, then
 * what was expected of it. `args` is the whole call and `steps[N]` is one
 * element of an array argument — and, for a program that cannot run at all, one
 * of its own lines, which only reach here from an action `bodyProblem` already
 * refuses.
 * @param {import('./bodies.js').Action} action
 * @param {import('./actions.js').Drop} refused
 * @returns {string}
 */
function refusalFor(action, refused) {
  const shape = refused.where === 'args' ? 'rejected' : 'step rejected';
  return `${action.name}: ${shape} — ${JSON.stringify(refused.value)}; ${refused.expect}`;
}

// --- What the steps say about the order they take ---------------------------
//
// Every question below is answered by the verb table, not by a name written out
// here: a step is a movement because the capability it needs carries movement,
// it takes the turn because its verb cancels the rest, and it goes first
// because its verb says so. `hold` is a word in `drive`'s schema, so a program
// that ends on it is the one with no end of its own.

/**
 * The verb table, seen as a lookup that may miss: `VERBS` is typed as a total
 * record of the five names, and a hand-edited body may name a sixth (which
 * `bodyProblem` refuses before a turn exists).
 * @type {Record<string, import('./verbs.js').Verb | undefined>}
 */
const VERB_TABLE = VERBS;

/**
 * Whether these steps ask the body to go somewhere. An action that does is a
 * movement attempt — it earns the "done" beep when it runs and the "I could
 * not" beep when it is refused — and one that does not (a bark, a pose) has
 * already answered in its own way.
 * @param {Array<{ verb: string }>} steps a program's steps, or an action's run
 * @returns {boolean}
 */
function moves(steps) {
  return steps.some((step) => VERB_TABLE[step.verb]?.needs === 'move');
}

/**
 * The step that voids the rest of the turn, as a program of one step, or null.
 * The first one wins: a turn that says "stop" anywhere means "stop".
 * @param {Program[]} programs
 * @returns {Program | null}
 */
function halting(programs) {
  for (const program of programs) {
    const step = program.steps.find((s) => VERB_TABLE[s.verb]?.cancelsRest);
    if (step) return { name: program.name, steps: [step] };
  }
  return null;
}

/**
 * Whether a program opens the turn: one of its steps runs before the reply is
 * spoken, so the face agrees with the words.
 * @param {Program} program
 * @returns {boolean}
 */
function aims(program) {
  return program.steps.some((step) => VERB_TABLE[step.verb]?.first);
}

/**
 * Whether a step has no end of its own: `ms: "hold"`, the word `drive`'s schema
 * allows instead of a number (core/verbs.js). Awaiting one strands everything
 * behind it, so a program that ends on one is dispatched last.
 * @param {ProgramStep | undefined} step
 * @returns {boolean}
 */
function holds(step) {
  return Boolean(step) && /** @type {any} */ (step).args?.ms === 'hold';
}

/**
 * What the trace says about an action this body does not carry: today's
 * sentence, with the action's own name. A pose is not moving, so it says it
 * cannot pose; everything else says it cannot move.
 * @param {Program} program
 * @returns {string}
 */
function refusalOf(program) {
  const trick = program.steps.some((step) => step.verb === 'pose');
  return `${program.name}: this body cannot ${trick ? 'pose' : 'move'}`;
}

/**
 * One program as the trace says it: its name, then what each step was given —
 * `move forward/left 600ms`, `play_sound bark`, `cruise forward/straight`.
 * @param {Program} program
 * @returns {string}
 */
function describeProgram(program) {
  const detail = program.steps.map(stepDetail).filter(Boolean).join(', ');
  return detail ? `${program.name} ${detail}` : program.name;
}

/** @param {ProgramStep} step @returns {string} */
function stepDetail(step) {
  const args = /** @type {any} */ (step.args);
  switch (step.verb) {
    case 'drive':
      return `${args.drive}/${args.steer}${typeof args.ms === 'number' ? ` ${args.ms}ms` : ''}`;
    case 'voice': return String(args.clip);
    case 'pose': return String(args.pose);
    default: return '';
  }
}

// --- One turn --------------------------------------------------------------

export class Brain {
  #llm; #executor; #tts; #earcon; #sound; #config; #onReplyLangChange; #onFault; #trace;
  #reflex;
  /** Returning tools this brain can run: name → handler (tarot mode spec §4). @type {Record<string, (args: any, signal?: AbortSignal) => Promise<string> | string>} */
  #returning;
  /** The body's returning tools, when the caller named them; else read from the body. @type {ReadonlySet<string> | null} */
  #returningTools;
  /** @type {() => number} */ #rng;
  /** @type {(ms: number, fn: () => void) => () => void} */ #after;
  /** The card this turn already drew: a second draw_card in a turn gets this one back. @type {import('./tarot.js').Draw | null} */
  #turnCard = null;
  /** Whether the screen is shuffling a card that has not been turned over yet. */
  #shuffling = false;
  /** @type {(() => void) | null} */ #cancelGiveUp = null;
  /** Whether this turn has already sounded its failure. See #fail. */
  #beeped = false;
  /** @type {AbortController | null} */
  #turn = null;
  /** @type {object[]} */ #history = [];

  /**
   * @param {{
   *   llm: { chat(messages: object[], tools: object[], opts?: { signal?: AbortSignal }): Promise<{ text: string, toolCalls: any[], rawMessage: object }> },
   *   executor: { move(steps: MoveStep[]): Promise<void>, cruise(d: string, s: string): Promise<void>, stop(): Promise<void>,
   *               pose?(name: import('./poses.js').Pose): Promise<void>,
   *               draw?(card: import('./tarot.js').Draw): Promise<void>,
   *               reveal?(): Promise<void> },
   *   tts: { speak(text: string, opts?: { signal?: AbortSignal, kind?: 'reply' | 'diagnostic' }): Promise<void> },
   *   earcon: (name: import('./audio/earcon.js').EarconName) => void,
   *   sound?: (name: import('./audio/sfx.js').SoundName) => Promise<void>,
   *   reflex?: { judge(heard: string, robotSaid: string, signal?: AbortSignal):
   *              Promise<import('./reflex.js').Verdict> } | null,
   *   returning?: Record<string, (args: any, signal?: AbortSignal) => Promise<string> | string>,
   *   returningTools?: ReadonlySet<string>,
   *   rng?: () => number,
   *   after?: (ms: number, fn: () => void) => () => void,
   *   config: { lang: 'en' | 'zh', replyLang: 'zh' | 'en' | null, bargeIn: boolean,
   *             body?: import('./config.js').BodyConfig, persona?: string },
   *   onReplyLangChange?: (lang: 'en' | 'zh' | null) => void,
   *   onFault?: (part: import('./strings.js').FaultPart, err: Error) => void,
   *   trace?: (line: string) => void,
   * }} deps
   */
  constructor(deps) {
    this.#llm = deps.llm;
    this.#executor = deps.executor;
    this.#tts = deps.tts;
    this.#earcon = deps.earcon;
    // Resolves when the sound ends, so a move queued behind it starts after.
    this.#sound = deps.sound ?? (async () => {});
    // Optional: without a configured reflex the server passes null and every
    // turn goes to the LLM exactly as before.
    this.#reflex = deps.reflex ?? null;
    // What a returning tool does is the caller's: the Brain only knows to run
    // it, write its result back and ask again. `returningTools` is injectable
    // so a test can prove the mechanism is not specific to one tool.
    this.#returning = { draw_card: () => this.#drawForTurn(), ...deps.returning };
    this.#rng = deps.rng ?? Math.random;
    this.#after = deps.after ?? ((ms, fn) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    });
    this.#returningTools = deps.returningTools ?? null;
    this.#config = deps.config;
    this.#onReplyLangChange = deps.onReplyLangChange ?? (() => {});
    this.#onFault = deps.onFault ?? (() => {});
    // Console by default, injectable so the tests are not a wall of turns.
    // This is the only channel that can answer "it said the words and did not
    // move": on screen there is a robot and one sentence, by design, and the
    // three ways that turn can end look identical from there.
    this.#trace = deps.trace ?? ((line) => console.log(line));
  }

  get history() { return this.#history; }

  /**
   * Spec §8.1: the session layer aborts the turn in flight. Three events do
   * it — a wake word heard during THINKING, the user talking over the reply
   * when `bargeIn` is on, and the emergency stop button (§4.1 layer 2).
   */
  cancel() { this.#turn?.abort(); }

  /** Spec §6.4: cleared when the session times out back to SLEEPING. */
  resetHistory() { this.#history = []; }

  /** @param {string} userText */
  async handle(userText) {
    this.#beeped = false;
    const text = userText.trim();
    if (text === '') { this.#earcon('huh'); return; }

    // Scoped to the whole turn, not just the LLM call: the reflex below runs
    // before the model is ever reached and the apiFailed line after it fails,
    // and a stop button that works on most turns but silently not on those is
    // worse than one that never works.
    const turn = new AbortController();
    this.#turn = turn;
    this.#turnCard = null;

    // Configurable reflex spec §3: asked before the LLM, never beside it.
    // Anything but a fire falls through to the LLM below, untouched.
    if (this.#reflex) {
      const v = await this.#reflex.judge(text, this.#lastRobotLine(), turn.signal);
      this.#trace(`[reflex] ${text} → ${v.verdict} ${v.detail} (${v.ms}ms)`);
      if (turn.signal.aborted) return;
      if (v.verdict === 'fired') return await this.#reflexTurn(text, v.calls ?? []);
    }

    this.#pushUser(text);
    await this.#converse(turn);
  }

  /**
   * Ask the model, and keep asking while it calls a returning tool: run the
   * tool, write its real result into the history, go again — up to
   * MAX_TOOL_ROUNDS times. Every other tool is an action: done and forgotten,
   * with the placeholder result the request format needs. Only the last
   * reply is spoken: words that came with a returning call are the model
   * thinking aloud, and the reading it is about to give would repeat them.
   * @param {AbortController} turn
   * @param {{ tools?: object[] }} [opts] `tools` replaces what the body is
   *   offered: a reading of a card already drawn is asked for with none, so
   *   the model cannot go and draw another.
   */
  async #converse(turn, { tools } = {}) {
    for (let round = 0; ; round++) {
      const body = this.#body();
      let reply;
      try {
        reply = await this.#llm.chat(
          [{
            role: 'system',
            content: buildSystemPrompt({
              replyLang: this.#config.replyLang,
              persona: this.#config.persona,
              body,
            }),
          }, ...this.#history],
          tools ?? toolsOf(body),
          { signal: turn.signal },
        );
      } catch (err) {
        // A card is never left face down: cancelled, failed or timed out, the
        // screen turns it over.
        await this.#reveal();
        // Cancelling is not failing. Without this line the `error` earcon and
        // the apiFailed line would be the answer to the user changing their mind.
        if (turn.signal.aborted) return;
        this.#fail('llm', /** @type {Error} */ (err));
        // A pet has no voice to say it with: the earcon is its whole apology.
        if (this.#bodyId() !== 'pet') await this.#say(t(this.#config.lang, 'apiFailed'), turn, { kind: 'diagnostic' });
        return;
      }

      // Spec §6.4: keep the native assistant message, tool_calls and all.
      this.#history.push(reply.rawMessage);
      // Every call needs a paired `tool` message or the NEXT request is rejected —
      // including calls we are about to drop. A returning tool's is its result.
      const returning = this.#returningTools ?? returningToolsOf(body);
      const handled = reply.toolCalls.filter((/** @type {{ name: string }} */ c) => returning.has(c.name) && this.#returning[c.name]);
      const goOn = handled.length > 0 && round < MAX_TOOL_ROUNDS;
      // An abort in the middle of the calls must not leave the rest without a
      // result: the next request would be rejected until the history is
      // cleared. So every call gets one, the ones not run getting the
      // placeholder, and only then does the turn stop.
      let stopped = false;
      for (const call of reply.toolCalls) {
        const content = !stopped && goOn && handled.includes(call) ? await this.#runReturning(call, turn) : 'ok';
        this.#history.push({ role: 'tool', tool_call_id: call.id, content });
        if (turn.signal.aborted) stopped = true;
      }
      this.#trimHistory();
      if (stopped) {
        // A card is never left face down, and a give-up timer must not fire
        // later and apologise for a turn the user cancelled.
        await this.#reveal();
        return;
      }

      await this.#carryOut(reply, handled, turn, !goOn);
      if (!goOn) return;
    }
  }

  /**
   * One returning tool's result as the text the model reads. A tool that throws
   * is not a failed turn: its message is the result, and the model says what
   * it likes about that.
   * @param {{ name: string, args: any, rawArguments: string }} call
   * @param {AbortController} turn
   * @returns {Promise<string>}
   */
  async #runReturning(call, turn) {
    if (call.args === null) return `error: the arguments were not valid JSON — ${call.rawArguments}`;
    try {
      return String(await this.#returning[call.name](call.args, turn.signal));
    } catch (err) {
      return `error: ${/** @type {Error} */ (err).message}`;
    }
  }

  /**
   * What one reply does: its actions, its language change, its sentence.
   * `handled` are the returning calls this brain ran itself, which are not
   * actions and must not be validated again. `speak` is false for a reply the
   * model is about to follow up.
   * @param {any} reply
   * @param {any[]} handled
   * @param {AbortController} turn
   * @param {boolean} speak
   */
  async #carryOut(reply, handled, turn, speak) {
    const body = this.#body();
    const checked = validate(reply.toolCalls.filter((/** @type {any} */ c) => !handled.includes(c)), body);
    const { replyLang, reasons } = checked;
    let { actions, hadMoveIntent } = checked;
    // Every body carries out what its actions say it does and nothing else
    // (body motion spec §4.1 ④). A body was offered no moving and a model that
    // moves anyway is dropped like any other refused call. Not a refusal the
    // person should hear: the sentence beside it is the answer.
    const can = new Set(body.actions.map((action) => action.name));
    const refused = actions.filter((action) => !can.has(action.name));
    if (refused.length > 0) {
      // The wording is the car's, kept: "this body cannot move" is what the
      // admin has been reading since a body became a config field. A pose is
      // not moving, so it says its own name.
      for (const action of refused) reasons.push(refusalOf(action));
      actions = actions.filter((action) => can.has(action.name));
      // A body that was never offered moving does not beep about a dropped
      // move: it is the model going off-script.
      if (!body.actions.some((action) => moves(action.run ?? []))) hadMoveIntent = false;
    }

    // One line per turn, whatever happened. `calls: []` next to a sentence
    // about going forward is the whole diagnosis of "it read the parameters
    // out loud and did not move": the model narrated the call instead of
    // making it, and no amount of looking at the car can tell you that.
    this.#trace(`[turn] said ${JSON.stringify(reply.text)} calls `
      + JSON.stringify(reply.toolCalls.map((/** @type {any} */ c) => `${c.name}(${c.rawArguments})`)));
    for (const why of reasons) this.#trace(`[turn] dropped — ${why}`);

    if (replyLang !== null) {
      // 'auto' is the escape hatch: it means "no recorded preference", i.e. null.
      const next = replyLang === 'auto' ? null : replyLang;
      this.#config.replyLang = next;
      // The caller owns persistence. Brain must not know that a config lives in
      // localStorage — but it must also not be the reason a state §11.1 calls
      // sticky quietly fails to stick.
      this.#onReplyLangChange(next);
    }

    // Spec §6.3: actions and content are not mutually exclusive. Dispatch
    // first, then speak — the beep says an instruction ran, the sentence says
    // WHICH one, and that difference is how a misheard command gets caught.
    // A pose is not a move either: it is the pet's answer, the way a bark is,
    // and a beep on top of it would be a third thing in the room.
    const moved = actions.some((action) => moves(action.steps));
    if (actions.length > 0) this.#dispatch(actions, turn.signal);
    // done says "an instruction for the car ran". A turn that only made a
    // sound has already answered out loud, and a beep would land on it.
    if (moved) this.#earcon('done');
    // Rule 4: a movement was attempted and nothing survived validation. Asked
    // about motion, not about `actions`: a sound beside a refused move used to
    // make the list non-empty and the refusal silent.
    else if (hadMoveIntent) this.#beep();

    // The reading is ready: turn the card over as the words begin.
    if (speak) await this.#reveal();

    // The user's call (pet screen spec §4.3): a dog barks, it does not talk.
    // The reply is not shown or spoken anywhere; the trace is the only place
    // that can answer "the model wrote a sentence, why is it silent".
    if (this.#bodyId() === 'pet') {
      if (reply.text) this.#trace(`[turn] pet does not speak: ${JSON.stringify(reply.text)}`);
      return;
    }
    if (speak && reply.text) await this.#say(reply.text, turn);
  }

  /** @returns {import('./config.js').Motion} */
  #bodyId() { return this.#config.body?.id ?? 'toy'; }

  /**
   * The body this turn runs on, resolved once per use: what the model is
   * offered, what a call is judged against, and what a program may run are all
   * read from it, so editing the body edits all three.
   * @returns {import('./bodies.js').Body}
   */
  #body() { return resolveBody(this.#bodyId(), this.#config.body); }

  /**
   * Every spoken line goes through here.
   *
   * It used to be a bare `await this.#tts.speak(...)`, and a TTS that threw
   * took the whole turn with it: handle() rejected, session.js's
   * `void this.#turn(samples)` swallowed the rejection, and a robot whose
   * voice had just died was indistinguishable from one that had heard
   * nothing. The earcon is the half of the report that still works when the
   * thing that broke IS the mouth.
   *
   * @param {string} text
   * @param {AbortController} turn
   * @param {{ kind?: 'reply' | 'diagnostic' }} [opts] diagnostic lines are
   *   apologies, not answers: the mouth tags them so they cannot tick
   *   "the robot has answered" in the first-run guide.
   */
  async #say(text, turn, opts = {}) {
    try {
      await this.#tts.speak(text, { signal: turn.signal, kind: opts.kind });
    } catch (err) {
      // Same distinction as around chat(): the user cancelling is not a fault.
      if (turn.signal.aborted) return;
      this.#fail('tts', /** @type {Error} */ (err));
    }
  }

  /**
   * The robot's last spoken line, for the reflex's context. Tool-only turns
   * have null content and are skipped: the question is what it SAID.
   * @returns {string}
   */
  #lastRobotLine() {
    for (let i = this.#history.length - 1; i >= 0; i--) {
      const m = /** @type {any} */ (this.#history[i]);
      if (m.role === 'assistant' && typeof m.content === 'string' && m.content) return m.content;
    }
    return '';
  }

  /**
   * Spec §3.2. The fired option's calls become Actions by the LLM's own rules
   * (validate), then only what this body's actions say it does survives. What
   * cannot be done is not done: the admin chose both the body and the actions,
   * and the trace is where they find out the two disagree. The LLM is not
   * asked instead.
   *
   * Written down as plain text on the user's side — what was heard, then a
   * bracketed note of what the body did. Not as the model's own tool calls:
   * those tie the next request to each provider's id and pairing rules. Not as
   * assistant text either, or the model learns to narrate its actions instead
   * of calling them.
   * @param {string} text
   * @param {import('./reflex.js').ToolCall[]} calls
   */
  async #reflexTurn(text, calls) {
    const body = this.#body();
    const id = this.#bodyId();
    // The admin chose both the body and the actions; the trace is where they
    // find out the two disagree. A name this body does not carry is dropped
    // before it is judged: an action of another body is not a malformed call.
    const can = new Set(body.actions.map((action) => action.name));
    for (const call of calls) {
      if (!can.has(call.name)) this.#trace(`[reflex] ${call.name} dropped: body "${id}" does not do ${call.name}`);
    }
    const { actions, reasons } = validate(calls.filter((call) => can.has(call.name)), body);
    for (const why of reasons) this.#trace(`[reflex] dropped — ${why}`);
    // A draw is the one reflex that does not end the turn: the card is the
    // reflex's answer, and the reading of it is still the model's (tarot mode
    // spec §3). Everything else a reflex fires is as it always was.
    const returning = returningToolsOf(body);
    const drawing = actions.some((action) => returning.has(action.name));
    const others = actions.filter((action) => !returning.has(action.name));
    const did = others.map(describeProgram);
    if (drawing) {
      if (others.length > 0) this.#dispatch(others, this.#turn?.signal);
      const card = await this.#startDraw();
      const also = did.length ? ` and did: ${did.join('; ')}` : '';
      this.#pushUser(`${text}\n[Before you could think, your reflexes drew a card${also}]\n${describeDraw(card)}`);
      this.#trimHistory();
      await this.#converse(/** @type {AbortController} */ (this.#turn), { tools: [] });
      return;
    }
    this.#pushUser(`${text}\n[Before you could think, your reflexes answered: ${did.length ? did.join('; ') : 'nothing'}]`);
    this.#trimHistory();
    if (actions.length === 0) return;
    this.#dispatch(actions, this.#turn?.signal);
    // The same rule as an LLM turn: done says an instruction for the car ran.
    // A bark has already answered out loud, and a pose is the pet's answer.
    if (actions.some((action) => moves(action.steps))) this.#earcon('done');
  }

  // --- Tarot (tarot mode spec §4, §8) ---------------------------------------

  /**
   * Draw a card for this turn and start the screen shuffling it. The reading
   * has until READING_TIMEOUT_MS: after that the card is turned over anyway.
   * @returns {Promise<import('./tarot.js').Draw>}
   */
  async #startDraw() {
    const card = drawRandom(this.#rng);
    this.#turnCard = card;
    this.#shuffling = true;
    this.#trace(`[tarot] drew ${card.id}${card.reversed ? ' (reversed)' : ''}`);
    const turn = this.#turn;
    this.#cancelGiveUp?.();
    this.#cancelGiveUp = this.#after(READING_TIMEOUT_MS, () => { void this.#giveUp(turn); });
    await this.#executor.draw?.(card);
    return card;
  }

  /**
   * The model's draw_card, as a returning tool. A second one in the same turn
   * gets the same card back: "never look for a better card" is the prompt's
   * rule, and this is the code that keeps it when the model forgets.
   * @returns {Promise<string>}
   */
  async #drawForTurn() {
    if (!this.#body().actions.some((action) => action.returns)) return 'error: this body does not draw cards';
    return describeDraw(this.#turnCard ?? await this.#startDraw());
  }

  /** Turn the card over, once, and stop waiting for a reading. */
  async #reveal() {
    this.#cancelGiveUp?.();
    this.#cancelGiveUp = null;
    if (!this.#shuffling) return;
    this.#shuffling = false;
    await this.#executor.reveal?.();
  }

  /**
   * No reading in time: drop the model's request, turn the card over, and say
   * what any failed turn says. Spoken on a fresh controller, because the turn's
   * own is the one just aborted and a stop button should still work on the
   * apology.
   * @param {AbortController | null} turn
   */
  async #giveUp(turn) {
    if (turn !== this.#turn || !this.#shuffling) return;
    const apology = new AbortController();
    this.#turn = apology;
    turn?.abort();
    await this.#reveal();
    this.#fail('llm', new Error(`no reading within ${READING_TIMEOUT_MS / 1000} s`));
    await this.#say(t(this.#config.lang, 'apiFailed'), apology, { kind: 'diagnostic' });
  }

  /**
   * A card with no one speaking: the wand was shaken. Draw, shuffle, ask the
   * model for the reading once, with no tools, and say it. Only a tarot body
   * does this; for any other it is a line in the trace.
   */
  async drawCard() {
    if (this.#bodyId() !== 'tarot') {
      this.#trace('[tarot] drawCard ignored: this body is not a tarot reader');
      return;
    }
    this.#beeped = false;
    const turn = new AbortController();
    this.#turn = turn;
    this.#turnCard = null;
    const card = await this.#startDraw();
    this.#pushUser(`[The person shook the wand and drew a card.]\n${describeDraw(card)}`);
    this.#trimHistory();
    await this.#converse(turn, { tools: [] });
  }

  /**
   * A reflex turn ends on a user message, so the next one would make two in a
   * row — which chat templates that insist on alternation reject. Merged.
   * @param {string} content
   */
  #pushUser(content) {
    const last = /** @type {any} */ (this.#history.at(-1));
    if (last?.role === 'user') last.content += `\n${content}`;
    else this.#history.push({ role: 'user', content });
  }

  /**
   * Report a failure once, in both channels this robot has.
   *
   * At most one earcon per turn, which is what #beeped is for: a turn can fail
   * twice — the LLM goes down, and then the line saying so cannot be spoken
   * either — and two low two-tones back to back say "two things broke" when
   * the second is only a consequence of the first. The written report has no
   * such limit; both faults reach onFault, and the caller decides what the
   * screen shows.
   *
   * @param {import('./strings.js').FaultPart} part
   * @param {Error} err
   */
  #fail(part, err) {
    this.#onFault(part, err);
    this.#beep();
  }

  /** @see #fail for why this is at most once per turn. */
  #beep() {
    if (this.#beeped) return;
    this.#beeped = true;
    this.#earcon('error');
  }

  /**
   * Spec §6.3: dispatch, then beep, then speak — without waiting for the car to
   * finish moving. executor.move() resolves when the MOTION ends, not when the
   * command is sent, so awaiting it would hold the spoken reply hostage for the
   * whole duration. That matters because §6.6 removed the upper bound on
   * duration_ms and justified it on exactly this: a runaway move announces itself
   * out loud while there is still time to react. Awaiting turns the warning into
   * a post-mortem.
   *
   * The order is not written here: it is what the steps say about themselves —
   * `cancelsRest`, `first`, and an `ms` of `hold` (core/verbs.js).
   *
   * @param {Program[]} programs
   * @param {AbortSignal} [signal] the turn's. Checked before each step, so a
   *   cancel — the stop button, the wake word, the user talking over it —
   *   drops what is still queued. Found in review: with a bark first, the loop
   *   sat on the sound, nothing cancelled that, and the move behind it drove
   *   the car after the emergency stop.
   */
  #dispatch(programs, signal) {
    // A step that cancels the rest is the whole turn. Spec §6.2 argues for
    // `move.steps` over parallel tool calls but never says what happens when a
    // provider emits parallel calls anyway — and they do. The loop used to
    // start every action without awaiting the previous one, and
    // executor.move() runs synchronously all the way to device.transferOut()
    // before it yields, so a [move, stop] turn put a full MAX_COAST_MS of
    // forward bytes on the bus BEFORE the purge. The generation counter bumped,
    // the renewal loop died, and the car drove a second anyway: a hole in
    // §4.4's guarantee reachable from ordinary LLM output. Dropping the rest is
    // right rather than merely ordering them — a turn that says both "go" and
    // "stop" is a turn whose only safe reading is "stop". It deliberately does
    // not look at WHERE the stop sits: `[stop, move]` run in order is safe by
    // itself, but "the user said stop and the model helpfully appended a move"
    // has exactly that shape, and dropping one extra action costs less than
    // moving after a stop. A program that both drives and halts becomes the
    // halt alone for the same reason.
    //
    // A program that ends on a holding step then has to be the last thing of
    // the turn. Its renewal loop has no end condition — executor.cruise() only
    // resolves once something else bumps the generation — so awaiting it
    // strands everything behind it. The damage is not that those steps never
    // run: it is that they run LATE. The next turn's action bumps the
    // generation, the stranded hold finally returns, and this loop resumes
    // INSIDE that later turn, running a stale step that preempts the live one —
    // say "right", drive left, because "left" was queued behind a hold ten
    // seconds ago. The generation counter cannot catch that; it guards the
    // executor's own loops, not a for-loop here holding a previous turn's
    // array.
    /** @type {Program[]} */
    let ordered;
    const halted = halting(programs);
    if (halted) {
      ordered = [halted];
    } else {
      const last = programs.findIndex((program) => holds(program.steps.at(-1)));
      ordered = last === -1 ? programs : programs.slice(0, last + 1);
    }

    // A step that runs before speech goes first (pet screen spec §4.6): a trick
    // and its bark are one gesture, and a bark that lands a second before the
    // dog sits reads as two unrelated things. Stable, so two of them keep the
    // model's order.
    ordered = [...ordered.filter(aims), ...ordered.filter((program) => !aims(program))];

    // Sequential inside, unawaited outside: each step still waits for the
    // previous one's motion to end (which is what restores the ordering the
    // awaited version had), while handle() returns immediately — the
    // non-blocking property test/brain.test.js pins.
    //
    // The catch is here because nothing awaits this. The executor reports write
    // failures through its own onError; this only covers the unexpected, and
    // because it is unawaited the 'error' earcon can land AFTER the 'done'
    // earcon and after the spoken reply, whenever the rejection surfaces. That
    // is fine: a last-resort guard, not the normal error path.
    (async () => {
      for (const program of ordered) {
        for (const step of program.steps) {
          if (signal?.aborted) return;
          await this.#run(step);
        }
      }
    })().catch(() => this.#earcon('error'));
  }

  /**
   * One step of a program, as the executor of today understands it. This is the
   * one place a verb's name meets a method: the executor still takes
   * `move(steps)` and `cruise(drive, steer)`, so a `drive` becomes one or the
   * other by its `ms`, and a numeric duration stays whole — the carrier slices
   * it, not this.
   * @param {ProgramStep} step
   * @returns {Promise<void>}
   */
  #run(step) {
    const args = /** @type {any} */ (step.args);
    switch (step.verb) {
      case 'drive':
        return args.ms === 'hold'
          ? this.#executor.cruise(args.drive, args.steer)
          : this.#executor.move([{ drive: args.drive, steer: args.steer, duration_ms: args.ms }]);
      case 'halt':
        return this.#executor.stop();
      case 'voice':
        return this.#sound(args.clip);
      case 'pose':
        return this.#executor.pose?.(args.pose) ?? Promise.resolve();
      // A draw is carried out by #startDraw before anything is dispatched; one
      // that reaches here must not fall through to `stop`.
      default:
        return Promise.resolve();
    }
  }

  /**
   * Keep the last HISTORY_ROUNDS user turns and everything after each of them.
   * Cutting at a user message is what keeps assistant/tool pairs intact.
   */
  #trimHistory() {
    /** @type {number[]} */
    const userIndices = [];
    this.#history.forEach((m, i) => { if (/** @type {any} */ (m).role === 'user') userIndices.push(i); });
    if (userIndices.length > HISTORY_ROUNDS) {
      this.#history = this.#history.slice(userIndices[userIndices.length - HISTORY_ROUNDS]);
    }
  }
}
