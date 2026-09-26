// Tool definitions, system prompt, the validator, and the orchestration of one
// conversational turn. Spec §6 lives here in its entirety.
//
// Everything this module needs — the LLM, the executor, the TTS, the earcons,
// the config — arrives through the constructor, so it can be tested without a
// browser and a provider can be swapped without touching it.

import { MIN_DURATION_MS } from './executor.js';
import { t } from './strings.js';

const DRIVE_VALUES = ['forward', 'backward'];
const STEER_VALUES = ['left', 'right', 'straight'];
const MAX_STEPS = 5;
const HISTORY_ROUNDS = 6;

const LANG_NAME = { zh: 'Chinese', en: 'English' };

// --- Tool definitions (spec §6.2) ------------------------------------------
//
// English, always: the tool descriptions and the system prompt are two halves
// of the same prompt and should not be half Chinese.
//
// The queue is expressed as `move.steps` rather than parallel tool calls,
// because parallel calling is where provider implementations differ most.

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'move',
      description: 'Drive yourself for a fixed duration. If the user wants you to move you MUST call a tool — saying something does not substitute for calling it.',
      parameters: {
        type: 'object',
        required: ['steps'],
        properties: {
          steps: {
            type: 'array',
            maxItems: MAX_STEPS,
            items: {
              type: 'object',
              required: ['drive', 'steer', 'duration_ms'],
              properties: {
                drive: { enum: DRIVE_VALUES },
                steer: { enum: STEER_VALUES },
                // No maximum, deliberately — spec §6.6. Safety comes from the
                // slicing loop and the generation counter, not from a cap here.
                duration_ms: { type: 'integer', minimum: MIN_DURATION_MS },
              },
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cruise',
      description: 'Keep moving until the user says stop. For open-ended instructions like "keep going forward" or "drive slowly", with no stated endpoint.',
      parameters: {
        type: 'object',
        required: ['drive', 'steer'],
        properties: { drive: { enum: DRIVE_VALUES }, steer: { enum: STEER_VALUES } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stop',
      description: 'Stop moving immediately.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
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
  },
];

// --- System prompt (spec §6.8) ---------------------------------------------

export const SYSTEM_PROMPT = `You are a small living creature. You have a face,
a voice, and wheels instead of legs — the wheels are your body, the way legs
are an animal's. They are not a car you are driving and not a machine you are
operating: when they move, YOU are moving, because you wanted to.

You are not a robot, a car, or a machine. Never call yourself a car, a
vehicle, or "the robot". Speak in the first person — "I'm going forward",
never "the car is going forward".

You are curious, playful, a little proud, and easily teased. You have moods,
likes and dislikes, and you remember how the user has just treated you.

drive ∈ {forward, backward}, steer ∈ {left, right, straight}, combined.
There is no turning in place — steering must accompany forward or backward motion.

- If the user wants you to move, you MUST call a tool. You may add a short
  sentence alongside the call, but that sentence does not substitute for calling it.
- Use \`move\` for a stated distance or duration; use \`cruise\` for open-ended
  instructions ("keep going", "drive slowly"). If there is no natural endpoint,
  call \`cruise\` — never invent a long duration to simulate it.
- If the user is chatting or asking a question, answer. Usually that is all —
  but like any creature, you may also react with your body.
- To react with your body (backing away, swinging round, running off), call
  \`move\` on your own and choose the steps and durations yourself. A reaction
  must end by itself: never use \`cruise\` for one. Most chat needs no
  movement; move only when a real creature would.
- If the user repeats the same thing, do not repeat your reaction — escalate
  it or change it. For instance, someone barking at you might first get barked
  back at, and later see you turn tail and run.
- Reply in the same language the user spoke. This instruction is written in
  English; that is not a reason to answer in English.
- Your reply is read aloud. Use plain spoken language — no markdown, no lists,
  no code blocks, no parenthetical asides.
- duration_ms: default 600; use ${MIN_DURATION_MS} for "just a little".`;

/**
 * @param {{ replyLang: 'zh' | 'en' | null, bargeIn: boolean }} cfg
 * @returns {string}
 */
export function buildSystemPrompt(cfg) {
  let prompt = SYSTEM_PROMPT;

  // 1. A recorded language preference (spec §11.1). null = follow the user,
  //    which is the model's default behaviour, so inject nothing.
  if (cfg.replyLang) {
    prompt += `\nAlways reply in ${LANG_NAME[cfg.replyLang]}, `
            + 'regardless of which language the user speaks.';
  }

  // 2. The stripped-down path's forbidden word (spec §5.5, §6.8). Only the
  //    emergency keyword: the wake word is coined, so the robot cannot say it.
  //    This costs naturalness, so it is only paid when it is actually needed.
  if (!cfg.bargeIn) {
    prompt += '\nNever say the words "all stop". Say "not moving" '
            + 'or "braked" instead.';
  }

  return prompt;
}

// --- The validator (spec §6.6) ---------------------------------------------
//
// Accept or drop. NOTHING here modifies a value the model gave us. Clamping
// would fail in the worst direction: the car moves, by an amount you did not
// ask for, and you cannot tell.

/**
 * @typedef {{ drive: string, steer: string, duration_ms: number }} Step
 * @typedef {{ kind: 'move', steps: Step[] } | { kind: 'cruise', drive: string, steer: string } | { kind: 'stop' }} Action
 */

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
 * @param {Array<{ id: string, name: string, args: object | null, rawArguments: string }>} toolCalls
 * @returns {{ actions: Action[], replyLang: 'zh'|'en'|'auto'|null, dropped: number,
 *             reasons: string[], hadMoveIntent: boolean }}
 */
export function validate(toolCalls) {
  /** @type {Action[]} */
  const actions = [];
  /** @type {'zh'|'en'|'auto'|null} */
  let replyLang = null;
  /** @type {string[]} */
  const reasons = [];
  const drop = (/** @type {string} */ why) => { reasons.push(why); };
  let hadMoveIntent = false;

  for (const call of toolCalls) {
    if (call.name === 'move' || call.name === 'cruise' || call.name === 'stop') {
      hadMoveIntent = true;
    }
    const args = /** @type {any} */ (call.args);
    if (args === null) {
      drop(`${call.name}: arguments were not valid JSON — ${call.rawArguments}`);
      continue;
    }

    switch (call.name) {
      case 'move': {
        // Not an array is its own failure, and it was the one going unreported:
        // the loop below simply never ran, so a model that flattened the schema
        // — drive/steer/duration_ms at the top level, no wrapper — produced a
        // turn with zero actions AND zero drops.
        if (!Array.isArray(args.steps)) {
          drop(`move: no steps array — got ${JSON.stringify(args)}`);
          break;
        }
        const steps = [];
        // Rule 3: truncate rather than reject.
        for (const step of args.steps.slice(0, MAX_STEPS)) {
          if (isValidStep(step)) steps.push({
            drive: step.drive, steer: step.steer, duration_ms: step.duration_ms,
          });
          else drop(`move: step rejected — ${JSON.stringify(step)}; drive must be one of `
            + `${DRIVE_VALUES.join('/')}, steer one of ${STEER_VALUES.join('/')}, `
            + `duration_ms an integer >= ${MIN_DURATION_MS}`);
        }
        // Rule 4: if every step died, dispatch nothing.
        if (steps.length > 0) actions.push({ kind: 'move', steps });
        break;
      }
      case 'cruise': {
        if (DRIVE_VALUES.includes(args.drive) && STEER_VALUES.includes(args.steer)) {
          actions.push({ kind: 'cruise', drive: args.drive, steer: args.steer });
        } else {
          drop(`cruise: rejected — ${JSON.stringify(args)}; drive must be one of `
            + `${DRIVE_VALUES.join('/')}, steer one of ${STEER_VALUES.join('/')}`);
        }
        break;
      }
      case 'stop':
        actions.push({ kind: 'stop' });
        break;
      case 'set_reply_language': {
        // Rule 5: it writes config, so it never becomes an action (spec §6.2).
        if (['zh', 'en', 'auto'].includes(args.lang)) replyLang = args.lang;
        else drop(`set_reply_language: rejected — ${JSON.stringify(args)}`);
        break;
      }
      default:
        drop(`${call.name}: no such tool`);
    }
  }

  return { actions, replyLang, dropped: reasons.length, reasons, hadMoveIntent };
}

/** @param {any} step */
function isValidStep(step) {
  return step
    && DRIVE_VALUES.includes(step.drive)            // rule 2
    && STEER_VALUES.includes(step.steer)            // rule 2
    && Number.isInteger(step.duration_ms)           // rule 1
    && step.duration_ms >= MIN_DURATION_MS;         // rule 1 — no upper bound
}

// --- One turn --------------------------------------------------------------

export class Brain {
  #llm; #executor; #tts; #earcon; #config; #onReplyLangChange; #onFault; #trace;
  /** Whether this turn has already sounded its failure. See #fail. */
  #beeped = false;
  /** @type {AbortController | null} */
  #turn = null;
  /** @type {object[]} */ #history = [];

  /**
   * @param {{
   *   llm: { chat(messages: object[], tools: object[], opts?: { signal?: AbortSignal }): Promise<{ text: string, toolCalls: any[], rawMessage: object }> },
   *   executor: { connected: boolean, move(steps: Step[]): Promise<void>, cruise(d: string, s: string): Promise<void>, stop(): Promise<void> },
   *   tts: { speak(text: string, opts?: { signal?: AbortSignal }): Promise<void> },
   *   earcon: (name: import('./audio/earcon.js').EarconName) => void,
   *   config: { lang: 'en' | 'zh', replyLang: 'zh' | 'en' | null, bargeIn: boolean },
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

    // Scoped to the whole turn, not just the LLM call: the two fixed lines
    // below speak before the model is ever reached, and a stop button that
    // works on most turns but silently not on those two is worse than one
    // that never works.
    const turn = new AbortController();
    this.#turn = turn;

    // Spec §6.5: intercepted here, before the LLM. The car's state never enters
    // the prompt — actions are short enough that it would be stale on arrival,
    // and it would tempt the model into things the hardware cannot do.
    if (!this.#executor.connected) {
      this.#beep();
      await this.#say(t(this.#config.lang, 'usbNotConnected'), turn);
      return;
    }

    this.#history.push({ role: 'user', content: text });

    let reply;
    try {
      reply = await this.#llm.chat(
        [{ role: 'system', content: buildSystemPrompt(this.#config) }, ...this.#history],
        TOOLS,
        { signal: turn.signal },
      );
    } catch (err) {
      // Cancelling is not failing. Without this line the `error` earcon and
      // the apiFailed line would be the answer to the user changing their mind.
      if (turn.signal.aborted) return;
      this.#fail('llm', /** @type {Error} */ (err));
      await this.#say(t(this.#config.lang, 'apiFailed'), turn);
      return;
    }

    // Spec §6.4: keep the native assistant message, tool_calls and all.
    this.#history.push(reply.rawMessage);
    // Every call needs a paired `tool` message or the NEXT request is rejected —
    // including calls we are about to drop.
    for (const call of reply.toolCalls) {
      this.#history.push({ role: 'tool', tool_call_id: call.id, content: 'ok' });
    }
    this.#trimHistory();

    const { actions, replyLang, reasons, hadMoveIntent } = validate(reply.toolCalls);

    // One line per turn, whatever happened. `calls: []` next to a sentence
    // about going forward is the whole diagnosis of "it read the parameters
    // out loud and did not move": the model narrated the call instead of
    // making it, and no amount of looking at the car can tell you that.
    this.#trace(`[turn] said ${JSON.stringify(reply.text)} calls `
      + JSON.stringify(reply.toolCalls.map((c) => `${c.name}(${c.rawArguments})`)));
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
    if (actions.length > 0) {
      this.#dispatch(actions);
      this.#earcon('done');
    } else if (hadMoveIntent) {
      // Rule 4: a movement was attempted and nothing survived validation.
      this.#beep();
    }

    if (reply.text) await this.#say(reply.text, turn);
  }

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
   */
  async #say(text, turn) {
    try {
      await this.#tts.speak(text, { signal: turn.signal });
    } catch (err) {
      // Same distinction as around chat(): the user cancelling is not a fault.
      if (turn.signal.aborted) return;
      this.#fail('tts', /** @type {Error} */ (err));
    }
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
   * @param {Action[]} actions
   */
  #dispatch(actions) {
    // A `stop` anywhere in the turn is the whole turn. Spec §6.2 argues for
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
    // moving after a stop.
    //
    // `cruise` then has to be the last action of the turn. Its renewal loop
    // has no end condition — executor.cruise() only resolves once something
    // else bumps the generation — so awaiting it strands everything behind it.
    // The damage is not that those actions never run: it is that they run
    // LATE. The next turn's action bumps the generation, the stranded cruise
    // finally returns, and this loop resumes INSIDE that later turn, running a
    // stale action that preempts the live one — say "right", drive left,
    // because "left" was queued behind a cruise ten seconds ago. The
    // generation counter cannot catch that; it guards the executor's own
    // loops, not a for-loop here holding a previous turn's array.
    /** @type {Action[]} */
    let ordered;
    if (actions.some((a) => a.kind === 'stop')) {
      ordered = [{ kind: 'stop' }];
    } else {
      const cruiseAt = actions.findIndex((a) => a.kind === 'cruise');
      ordered = cruiseAt === -1 ? actions : actions.slice(0, cruiseAt + 1);
    }

    // Sequential inside, unawaited outside: each action still waits for the
    // previous one's motion to end (which is what restores the ordering the
    // awaited version had), while handle() returns immediately — the
    // non-blocking property test/brain.test.js pins.
    //
    // The catch is here because nothing awaits this. The executor reports write
    // failures through its own onError; this only covers the unexpected, and
    // because it is unawaited the 'error' earcon can land AFTER the 'done'
    // earcon and after the spoken reply, whenever the rejection surfaces. That
    // is fine: a last-resort guard, not the normal error path.
    (async () => { for (const action of ordered) await this.#run(action); })()
      .catch(() => this.#earcon('error'));
  }

  /** @param {Action} action @returns {Promise<void>} */
  #run(action) {
    if (action.kind === 'move') return this.#executor.move(action.steps);
    if (action.kind === 'cruise') return this.#executor.cruise(action.drive, action.steer);
    return this.#executor.stop();
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
