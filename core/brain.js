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
import { expand, expectationOf, fitsSchema, withoutWalked } from './actions.js';

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
 * the config, not the body, so no body may declare it as an action (spec §6.2,
 * rule 5). A template names it in `fixedTools`, and `toolsOf` appends it —
 * `server/check-api.js` asks a provider to accept the same list through that.
 * @type {Tool}
 */
export const SET_REPLY_LANGUAGE = {
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
 * The fixed tools a template may name in `fixedTools`. A name with no entry
 * here is skipped rather than invented: only `set_reply_language` exists, and
 * `bodies.js` chooses which templates get it.
 * @type {Record<string, Tool>}
 */
const FIXED_TOOLS = { set_reply_language: SET_REPLY_LANGUAGE };

/**
 * The tools a body is offered: one per action it carries, in its own order,
 * described by the words the body wrote, then the fixed tools its template
 * names (`fixedTools`). No branch on an id: a body that cannot pose is a body
 * with no pose action, and a pet that answers in clips is a body with no
 * `set_reply_language`.
 *
 * `set_reply_language` is a reserved name: a body action that claimed it is
 * skipped here rather than offered twice, so the fixed tool is never shadowed.
 * `bodyProblem` refuses such a body first, with the sentence a person can read;
 * this is the last-resort reservation for a file that skipped every check.
 * @param {import('./bodies.js').Body} body
 * @returns {Tool[]}
 */
export function toolsOf(body) {
  const tools = body.actions
    .filter((action) => action.name !== 'set_reply_language')
    .map((action) => ({
      type: /** @type {const} */ ('function'),
      function: {
        name: action.name,
        description: action.say,
        parameters: action.args ?? { type: 'object', properties: {} },
      },
    }));
  for (const name of body.fixedTools ?? []) {
    const fixed = FIXED_TOOLS[name];
    if (fixed) tools.push(fixed);
  }
  return tools;
}

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

/**
 * A returning call, with the decision already made: `handler` is null when the
 * call may not run (the refusal is then the result the model reads), and `args`
 * are the arguments as judged — the walked arrays pruned element by element.
 * @typedef {{
 *   handler: ((args: any, signal?: AbortSignal) => Promise<string> | string) | null,
 *   action: import('./bodies.js').Action | null,
 *   args: any,
 *   refusal: string[] | null,
 * }} ReturningPlan
 */

/** The executor's own step: the same three fields the wire frame has. */
/** @typedef {{ drive: string, steer: string, duration_ms: number }} MoveStep */

/**
 * Every action the five templates define, by name. A call is judged against the
 * body's own definition of it when the body carries one; this is the phrasebook
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
 *   actions are the only ones this validator authorises: a call to one the body
 *   does not carry is refused here, in the sentence the reference definition can
 *   still phrase (`draw: this body does not draw`). `REFERENCE_ACTIONS` is only
 *   that phrasebook — it never makes an action executable. A body is required:
 *   no body means no actions, and nothing but the fixed tool can run.
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
    // No body is no actions: a body is required, and without one nothing but
    // the fixed config tool may run. The reference catalogue still phrases the
    // refusal below — it never authorises a program.
    const action = call.name === 'set_reply_language' ? undefined : own.get(call.name);

    // A program with a `drive` is a movement attempt even when its arguments
    // are unreadable or every one of its steps is refused, and that is what
    // earns the "I could not do that" beep. A `halt` needs `move` too, but a
    // turn that only stops is not a failed move (design §4.3).
    if (action && drives(action.run ?? [])) hadMoveIntent = true;

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
      // The tool exists in the reference catalogue but not on this body; the
      // reference is allowed to phrase the refusal, not to run it. A name no
      // body has is still "no such tool".
      const reference = REFERENCE_ACTIONS.get(call.name);
      drop(reference ? referenceRefusal(reference) : `${call.name}: no such tool`);
      continue;
    }

    const checked = checkCall(action, args, body);
    if (checked.rejected) { drop(checked.rejected); continue; }
    for (const why of checked.reasons) drop(why);
    // Rule 4: if every step died, dispatch nothing.
    if (checked.steps.length > 0) actions.push({ name: action.name, steps: checked.steps });
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
  const walked = walkNames(action);
  for (const each of walked) {
    if (!Array.isArray(/** @type {any} */ (args)?.[each])) {
      return `${action.name}: no ${each} array — got ${JSON.stringify(args)}`;
    }
  }

  // The ROOT schema is the judge, through the one checker both modules share:
  // walking only `properties` missed a root `anyOf` (the verb's own union) and
  // accepted `{}` for an action that requires one of two shapes. The arrays a
  // step walks are replaced by "an array" first, so their elements stay
  // `usableArgs`' business — one bad element costs one step, not the call.
  //
  // The value handed to it is the one the model sent, whatever its shape: a
  // list is not turned into an object, so a root that only accepts objects
  // refuses `[]` exactly as it refuses `{}`. An action that takes nothing is
  // declared with an empty object schema, so a non-object argument is now
  // refused there too — it never read one to begin with.
  const root = withoutWalked(schema, walked);
  // A body may write `{ required, properties }` without `type`; the old walk
  // read that as an object schema, and `fitsSchema` alone calls a missing type
  // "cannot tell". An action's arguments are an object by contract, so it is
  // judged as one — beside any `anyOf` the root also carries.
  const judged = root.type === undefined && (root.properties !== undefined || root.required !== undefined)
    ? { ...root, type: 'object' }
    : root;
  return fitsSchema(args, judged) ? null : rejected;
}

/**
 * The names of the array arguments the action's program walks, once each.
 * @param {import('./bodies.js').Action} action
 * @returns {Set<string>}
 */
function walkNames(action) {
  /** @type {Set<string>} */
  const names = new Set();
  for (const step of Array.isArray(action.run) ? action.run : []) {
    if (step.each !== undefined) names.add(step.each);
  }
  return names;
}

/**
 * What this call would actually run, judged exactly once: the arguments
 * against the action's own (root) schema, the walked arrays element by element,
 * then the program expanded and each refused step phrased. Shared by `validate`
 * and the returning path so a handler is never run on arguments the validator
 * would refuse to give a program — a renamed draw would otherwise draw on an
 * array whose every element `validate` had just dropped.
 * @param {import('./bodies.js').Action} action
 * @param {any} args
 * @param {import('./bodies.js').Body} [body] the body whose commands and
 *   resources a command step expands against. Without it a body action that
 *   calls a command has nothing to run: the command is unknown, and its line
 *   is one drop.
 * @returns {{ rejected: string | null, steps: ProgramStep[], args: any, reasons: string[] }}
 */
function checkCall(action, args, body) {
  const wrong = argsProblem(action, args);
  if (wrong) return { rejected: wrong, steps: [], args, reasons: [] };

  const usable = usableArgs(action, args);
  const { steps, dropped } = expand(action, usable.args, {
    commands: body?.commands,
    resources: body?.resources,
  });
  /** @type {string[]} */
  const reasons = [...usable.reasons];
  for (const refused of dropped) reasons.push(refusalFor(action, refused));
  return { rejected: null, steps, args: usable.args, reasons };
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
  // Two steps may walk the same array; its elements are judged once. Judging
  // it per step counted the same bad element twice and wrote the same reason
  // twice — one refusal, two drops.
  const walkedOnce = new Set();
  for (const step of Array.isArray(action.run) ? action.run : []) {
    if (step.each === undefined || walkedOnce.has(step.each)) continue;
    walkedOnce.add(step.each);
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
 * Whether these steps include a `drive`. `hadMoveIntent` means this, and only
 * this: a `halt` needs the `move` capability too, but a turn that only stops is
 * not a movement attempt that failed (design §4.3).
 * @param {import('./actions.js').RunStep[]} steps
 * @returns {boolean}
 */
function drives(steps) {
  return steps.some((step) => step.verb === 'drive');
}

/**
 * The turn's steps in the order they run, sorted as steps rather than as
 * programs. Sorting whole programs was the bug: a `[voice, pose]` turn let the
 * pose's program go first and turn the bark into a second thing, and a
 * `[bark, pose+hold]` turn put the bark behind a hold. The rules are the verbs'
 * own flags:
 *
 * - a step that cancels the rest (a `halt`) anywhere makes the turn that step
 *   alone, whatever else was asked for — returning calls are carried out
 *   before this, so their programs are dropped here like any other;
 * - a step that runs before speech (`pose`) comes first, stable, so two keep
 *   the model's order and the face agrees with the words that follow;
 * - a holding `drive` (`ms: "hold"`) has no end of its own, so it must be last:
 *   anything the model put after it is dropped rather than deferred into the
 *   next turn (the reason the old program-level truncation existed).
 * @param {Program[]} programs
 * @returns {ProgramStep[]}
 */
function orderedSteps(programs) {
  /** @type {ProgramStep[]} */
  const flat = [];
  for (const program of programs) flat.push(...program.steps);

  const halt = flat.find((step) => VERB_TABLE[step.verb]?.cancelsRest);
  if (halt) return [halt];

  // The hold truncates FIRST, in the model's own order: a pose the model put
  // after a hold is dropped, not lifted in front of it by the pose partition.
  // That is the order the old program-level `#dispatch` had (the cruise slice,
  // then poses moved to the front), and it is why nothing may follow a hold.
  const hold = flat.findIndex((step) => holds(step));
  const kept = hold === -1 ? flat : flat.slice(0, hold + 1);

  // Then poses go first, stable, among what survived.
  const posed = kept.filter((step) => VERB_TABLE[step.verb]?.first);
  const rest = kept.filter((step) => !VERB_TABLE[step.verb]?.first);
  return [...posed, ...rest];
}

/**
 * Whether a step has no end of its own: `ms: "hold"`, the word `drive`'s schema
 * allows instead of a number (core/verbs.js). Awaiting one strands everything
 * behind it, so it is ordered last and nothing may follow it.
 * @param {ProgramStep | undefined} step
 * @returns {boolean}
 */
function holds(step) {
  return Boolean(step) && /** @type {any} */ (step).args?.ms === 'hold';
}

/**
 * The name a program is reported under: its old kind when the action has one
 * (`play_sound → sound`, `draw_card → draw`), else the action's own name. The
 * trace and the refusal sentence were frozen in the kinds, not the tool names.
 * @param {string} name
 * @returns {string}
 */
function kindOf(name) {
  if (name === 'play_sound') return 'sound';
  if (name === 'draw_card') return 'draw';
  return name;
}

/**
 * Why this body cannot carry out a reference action it does not have, in the
 * sentence the admin has been reading since a body became a config field. The
 * verb the action runs decides the words; the action's kind decides the
 * subject.
 * @param {import('./bodies.js').Action} action
 * @returns {string}
 */
function referenceRefusal(action) {
  const subject = kindOf(action.name);
  const steps = action.run ?? [];
  if (steps.some((step) => step.verb === 'draw')) return `${subject}: this body does not draw`;
  if (steps.some((step) => step.verb === 'pose')) return `${subject}: this body cannot pose`;
  // One sentence for everything else, verbatim as the old filter said it: a
  // sound is not moving either, and "cannot make a sound" was invented here.
  return `${subject}: this body cannot move`;
}

/**
 * Whether this call is a `halt` the turn can actually run. The judgement is
 * `validate`'s — the same expanded steps dispatch will see — so a stop whose
 * `each` list expands to nothing does not swallow a draw, and a malformed stop
 * does not either.
 * @param {{ name: string, args: any }} call
 * @param {import('./bodies.js').Body} body
 * @returns {boolean}
 */
function haltsCall(call, body) {
  const action = body.actions.find((candidate) => candidate.name === call.name);
  if (!action || action.returns || call.args === null) return false;
  const { rejected, steps } = checkCall(action, call.args, body);
  if (rejected) return false;
  return steps.some((step) => VERB_TABLE[step.verb]?.cancelsRest);
}

/**
 * Whether this call is one of the body's own returning actions. A halt
 * elsewhere in the turn is the whole turn, returning calls included — but an
 * injected returning tool is not a body action and keeps its mechanism.
 * @param {{ name: string }} call
 * @param {import('./bodies.js').Body} body
 * @returns {boolean}
 */
function bodyReturns(call, body) {
  return body.actions.some((action) => action.name === call.name && action.returns);
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

/**
 * A read's value as the tool-result text the model reads. JSON, not prose: a
 * pin level is `0` or `1` and a sensor's raw word is whatever the body sent,
 * and the model is the one that knows what to say about it. `undefined` is
 * written as `null` because a missing key in the request is not a value.
 * @param {unknown} value
 * @returns {string}
 */
function formatIoValue(value) {
  return value === undefined ? 'null' : JSON.stringify(value);
}

// --- One turn --------------------------------------------------------------

export class Brain {
  #llm; #executor; #tts; #earcon; #sound; #config; #onReplyLangChange; #onFault; #trace;
  #reflex;
  /** Returning tools this brain can run, by verb or injected tool name (tarot mode spec §4). @type {Record<string, ((args: any, signal?: AbortSignal) => Promise<string> | string) | undefined>} */
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
  /**
   * The generation of the commands in flight. Every dispatch that sends a
   * command — a `drive`, a `cruise`, a `halt`, an IO op — bumps it, and
   * `cancel()` bumps it; a step awaited behind one checks it after every await.
   * It is not the turn: a speak-only turn disturbs nothing, and a new dispatch
   * takes over only when it sends commands. A move that ends inside a LATER
   * turn wakes the old loop with a live signal, and only this can tell it that
   * the body has been taken.
   */
  #dispatchGen = 0;
  /** @type {object[]} */ #history = [];

  /**
   * @param {{
   *   llm: { chat(messages: object[], tools: object[], opts?: { signal?: AbortSignal }): Promise<{ text: string, toolCalls: any[], rawMessage: object }> },
   *   executor: { move(steps: MoveStep[]): Promise<void>, cruise(d: string, s: string): Promise<void>, stop(): Promise<void>,
   *               pose?(name: import('./poses.js').Pose): Promise<void>,
   *               io?(op: import('./io-program.js').Op): Promise<unknown>,
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
    // it, write its result back and ask again. The default is keyed by VERB,
    // because that is what a renamed draw action still expands to; injected
    // handlers keep their own names (`returningTools` may name a tool no body
    // carries). `returningTools` is injectable so a test can prove the
    // mechanism is not specific to one tool.
    this.#returning = { draw: () => this.#drawForTurn(), ...deps.returning };
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
  cancel() {
    // An explicit cancel takes the body even when the aborted turn dispatched
    // nothing: the stop button and the wake word must void a live queue.
    this.#dispatchGen++;
    this.#turn?.abort();
  }

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
    // A turn is not a command: a speak-only turn leaves whatever a previous
    // dispatch still has queued alone. `#dispatch` and `cancel()` take the body.
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
        // A body that answers in clips has no voice to say it with: the earcon
        // is its whole apology (design §4.4).
        if (body.reply !== 'clips') await this.#say(t(this.#config.lang, 'apiFailed'), turn, { kind: 'diagnostic' });
        return;
      }

      // Spec §6.4: keep the native assistant message, tool_calls and all.
      this.#history.push(reply.rawMessage);
      // Every call needs a paired `tool` message or the NEXT request is rejected —
      // including calls we are about to drop. A returning tool's is its result.
      // A halt anywhere in the reply is the whole turn; a body's own returning
      // action is carried out before dispatch, so it has to be withheld here
      // (design: returning calls included). An injected returning tool is not a
      // body action and keeps its own mechanism.
      const haltWins = reply.toolCalls.some((/** @type {any} */ c) => haltsCall(c, body));
      const handled = reply.toolCalls
        .map((/** @type {any} */ c) => ({
          call: c,
          plan: haltWins && bodyReturns(c, body) ? null : this.#returningPlan(c, body),
        }))
        .filter((/** @type {any} */ h) => h.plan !== null);
      const goOn = handled.length > 0 && round < MAX_TOOL_ROUNDS;
      // An abort in the middle of the calls must not leave the rest without a
      // result: the next request would be rejected until the history is
      // cleared. So every call gets one, the ones not run getting the
      // placeholder, and only then does the turn stop.
      let stopped = false;
      for (const call of reply.toolCalls) {
        const handledCall = handled.find((/** @type {any} */ h) => h.call === call);
        const content = !stopped && goOn && handledCall && handledCall.plan
          ? await this.#runReturning(call, handledCall.plan, turn)
          : 'ok';
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

      await this.#carryOut(reply, handled.map((/** @type {any} */ h) => h.call), turn, !goOn);
      if (!goOn) return;
    }
  }

  /**
   * How a call returns a result, if it does. A body action says `returns` and
   * what it runs, so the handler is chosen by the expanded **verb**: `draw`
   * draws a card, and a program of `io` steps runs them in order and hands back
   * the last op's value — a plugin reads a pin exactly the way a tarot body
   * draws a card, and the model is asked again with it. The action's arguments
   * are judged before the handler runs, with the same check `validate` uses.
   *
   * An injected `returningTools`/`returning` pair (the mechanism's own tests)
   * names tools that are not body actions; those still look up by name.
   * @param {{ name: string, args: any, rawArguments: string }} call
   * @param {import('./bodies.js').Body} body
   * @returns {ReturningPlan | null}
   */
  #returningPlan(call, body) {
    const returning = this.#returningTools ?? returningToolsOf(body);
    if (!returning.has(call.name)) return null;

    const action = body.actions.find((candidate) => candidate.name === call.name && candidate.returns);
    if (!action) {
      const byName = this.#returning[call.name];
      return byName ? { handler: byName, action: null, args: call.args, refusal: null } : null;
    }

    // The same judgement `validate` makes, element by element. A handler is not
    // run on arguments the validator would refuse to give a program: a renamed
    // draw whose `each` list is all bad would otherwise draw a card while
    // `validate` produced zero steps for it.
    const checked = call.args === null ? null : checkCall(action, call.args, body);
    if (!checked || checked.rejected || checked.steps.length === 0) {
      const refusal = checked?.rejected ? [checked.rejected] : checked?.reasons ?? [];
      return { handler: null, action, args: call.args, refusal };
    }
    const steps = checked.steps;
    // A command's program is carried whole: a returning command is "write,
    // then read" as often as a bare read, and the value is the last op's. Only
    // the FIRST was sent before, so the model read `null` for a legal shape.
    // A failed op throws; `#runReturning` turns that into the model's result —
    // a read that could not happen is something the model may say, not a dead
    // turn.
    if (steps.every((step) => step.verb === 'io')) {
      const ops = steps.map((step) => /** @type {import('./io-program.js').Op} */ (step.args));
      return {
        handler: async () => {
          /** @type {unknown} */
          let value;
          for (const op of ops) value = await this.#write(op);
          return formatIoValue(value);
        },
        action,
        args: checked.args,
        refusal: null,
      };
    }
    const handler = this.#returning[steps[0].verb] ?? this.#returning[call.name];
    return handler ? { handler, action, args: checked.args, refusal: null } : null;
  }

  /**
   * One returning tool's result as the text the model reads. A tool that throws
   * is not a failed turn: its message is the result, and the model says what
   * it likes about that. A body action whose arguments do not fit its own
   * schema — or whose program expands to no step at all — is not run; the model
   * reads the refusal as the result.
   * @param {{ name: string, args: any, rawArguments: string }} call
   * @param {{ handler: ((args: any, signal?: AbortSignal) => Promise<string> | string) | null,
   *           action: import('./bodies.js').Action | null,
   *           args: any, refusal: string[] | null }} plan
   * @param {AbortController} turn
   * @returns {Promise<string>}
   */
  async #runReturning(call, plan, turn) {
    if (call.args === null) return `error: the arguments were not valid JSON — ${call.rawArguments}`;
    if (plan.handler === null) {
      return `error: ${(plan.refusal ?? []).join('; ') || `${call.name}: nothing to run`}`;
    }
    try {
      return String(await plan.handler(plan.args, turn.signal));
    } catch (err) {
      // A thrown string is still a result to the model: `err.message` alone
      // made it read "error: undefined" and gave it nothing to say.
      return `error: ${err instanceof Error ? err.message : String(err)}`;
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
    // The validator already refused every action this body does not have, so
    // everything left is executable. What it cannot know is whether the body
    // can move at all: a body that was never offered moving does not beep about
    // a dropped move — that is the model going off-script, and the sentence
    // beside it is the answer (body motion spec §4.1 ④).
    if (!body.actions.some((action) => drives(action.run ?? []))) hadMoveIntent = false;

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
    // A body that answers in clips has no TTS to put words through, whatever
    // its id is (design §4.4).
    if (body.reply === 'clips') {
      if (reply.text) this.#trace(`[turn] ${body.id} does not speak: ${JSON.stringify(reply.text)}`);
      return;
    }
    if (speak && reply.text) await this.#say(reply.text, turn);
  }

  /** @returns {string} a template id, or a plugin body's id */
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
      if (!can.has(call.name)) {
        const subject = kindOf(call.name);
        this.#trace(`[reflex] ${subject} dropped: body "${id}" does not do ${subject}`);
      }
    }
    const { actions, reasons } = validate(calls.filter((call) => can.has(call.name)), body);
    for (const why of reasons) this.#trace(`[reflex] dropped — ${why}`);
    // A draw is the one reflex that does not end the turn: the card is the
    // reflex's answer, and the reading of it is still the model's (tarot mode
    // spec §3). Everything else a reflex fires is as it always was. A halt
    // anywhere is the whole turn, returning calls included.
    const returning = returningToolsOf(body);
    const halted = actions.some((action) => action.steps.some((step) => VERB_TABLE[step.verb]?.cancelsRest));
    const drawing = !halted && actions.some((action) => returning.has(action.name));
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
   * model for the reading once, with no tools, and say it. What a shake does is
   * the body's `triggers`, not its id: only a body whose shake reaches a
   * returning draw does this; for any other it is a line in the trace
   * (design §4.4).
   */
  async drawCard() {
    const body = this.#body();
    const shake = (body.triggers ?? []).find((trigger) => trigger.on === 'shake');
    const action = shake ? body.actions.find((candidate) => candidate.name === shake.action) : undefined;
    if (!action?.returns) {
      this.#trace('[tarot] drawCard ignored: this body has no shake trigger that draws');
      return;
    }
    this.#beeped = false;
    const turn = new AbortController();
    this.#turn = turn;
    // A draw sends no command, so it does not take the body; see #dispatch.
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
    // Sort the turn's STEPS, not its programs (design: `#dispatch` flattens
    // first). Program-level sorting turned `[voice, pose]` into a pose before
    // the bark and `[bark, pose+hold]` into a bark behind a hold; the steps
    // themselves are what the verb flags describe. The rules live in
    // `orderedSteps`.
    const ordered = orderedSteps(programs);

    // Which dispatch is live. The signal says the user cancelled; the
    // generation says a later command has taken the body, which the signal
    // cannot: a step that was awaiting a move wakes up inside a later turn, and
    // a turn nobody cancelled still must not drive there. Both are checked
    // after every await and before every command — checking only at the top of
    // the loop let `[move, cruise]` resume a cancelled turn and cruise after
    // the stop.
    //
    // A new dispatch takes over only when it sends commands: only `move`,
    // `cruise` and `stop` bump the generation. A turn that speaks, barks or
    // poses leaves a live queue alone, because it commands nothing; `cancel()`
    // bumps on its own for the explicit stop.
    let gen = this.#dispatchGen;
    let claimed = false;
    const live = () => gen === this.#dispatchGen && !signal?.aborted;
    const claim = () => {
      if (claimed) return;
      gen = ++this.#dispatchGen;
      claimed = true;
    };

    // Sequential inside, unawaited outside: each step still waits for the
    // previous one's motion to end (which is what restores the ordering the
    // awaited version had), while handle() returns immediately — the
    // non-blocking property test/brain.test.js pins.
    //
    // Consecutive numeric `drive` steps are ONE `executor.move([...])`. Sent
    // one at a time, a two-step `move` became two executor calls, so a `stop`
    // from a later turn cancelled only the first and the queued second step ran
    // afterwards — `move:left → stop → move:right`, reproduced. One call is one
    // thing for the generation counter to cancel. A hold-drive is
    // `executor.cruise`, has no end of its own, and is last by `orderedSteps`.
    //
    // The catch is here because nothing awaits this. The executor reports write
    // failures through its own onError; this only covers the unexpected, and
    // because it is unawaited the 'error' earcon can land AFTER the 'done'
    // earcon and after the spoken reply, whenever the rejection surfaces. That
    // is fine: a last-resort guard, not the normal error path.
    (async () => {
      /** @type {MoveStep[]} */
      let frames = [];
      const flush = async () => {
        if (frames.length === 0) return;
        if (!live()) { frames = []; return; }
        const batch = frames;
        frames = [];
        claim();
        await this.#executor.move(batch);
      };

      for (const step of ordered) {
        if (!live()) {
          // A stop voids the queue, including a batch not yet sent.
          frames = [];
          return;
        }
        const args = /** @type {any} */ (step.args);
        if (step.verb === 'drive' && args.ms !== 'hold') {
          frames.push({ drive: args.drive, steer: args.steer, duration_ms: args.ms });
          continue;
        }
        // No `await` when there is nothing to flush: the first step must run
        // synchronously, as the old loop did, or the 'done' beep would land
        // before the bark it is meant to follow.
        if (frames.length > 0) {
          await flush();
          // The await is where a cancel lands; the step behind it is the one
          // the emergency stop exists to prevent.
          if (!live()) return;
        }
        try {
          await this.#run(step, claim);
        } catch (err) {
          // An IO step is awaited inside this loop (unlike a move, whose end is
          // its own), so a command cannot half-run: the ops after a failed
          // write are never sent, and the turn keeps its sentence. Only `io` is
          // caught here — anything else is still the last-resort earcon below.
          if (step.verb !== 'io') throw err;
          this.#trace(`[turn] io failed — ${/** @type {Error} */ (err).message}`);
          return;
        }
      }
      await flush();
    })().catch(() => this.#earcon('error'));
  }

  /**
   * One step of a program, as the executor of today understands it. This is the
   * one place a verb's name meets a method: the executor still takes
   * `move(steps)` and `cruise(drive, steer)`, so a `drive` becomes one or the
   * other by its `ms`, and a numeric duration stays whole — the carrier slices
   * it, not this.
   * @param {ProgramStep} step
   * @param {() => void} claim take the body immediately before sending a command
   * @returns {Promise<void>}
   */
  #run(step, claim) {
    const args = /** @type {any} */ (step.args);
    switch (step.verb) {
      case 'drive':
        claim();
        return args.ms === 'hold'
          ? this.#executor.cruise(args.drive, args.steer)
          : this.#executor.move([{ drive: args.drive, steer: args.steer, duration_ms: args.ms }]);
      case 'halt':
        claim();
        return this.#executor.stop();
      case 'io':
        // A command writes the body's own pins: it takes the body exactly as a
        // move does, so a stop from a later turn voids what is still queued.
        // The answer belongs to the returning path; dispatch only waits for it.
        claim();
        return this.#write(/** @type {import('./io-program.js').Op} */ (args)).then(() => {});
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
   * One IO op, awaited by the dispatch loop. The body's answer is returned —
   * a read has a value and the returning path needs it; a write's answer is
   * ignored by the caller. A brain wired without a carrier refuses instead of
   * pretending the write happened, so the turn's trace says why nothing
   * reached the pins.
   * @param {import('./io-program.js').Op} op
   * @returns {Promise<unknown>}
   */
  async #write(op) {
    if (!this.#executor.io) throw new Error('this executor has no IO');
    return this.#executor.io(op);
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
