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
      description: 'Move the car for a fixed duration. If the user wants the car to move you MUST call a tool — saying something does not substitute for calling it.',
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
      description: 'Stop the car immediately.',
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

export const SYSTEM_PROMPT = `You control a small toy car.
drive ∈ {forward, backward}, steer ∈ {left, right, straight}, combined.
There is no turning in place — steering must accompany forward or backward motion.

- If the user wants the car to move, you MUST call a tool. You may add a short
  sentence alongside the call, but that sentence does not substitute for calling it.
- Use \`move\` for a stated distance or duration; use \`cruise\` for open-ended
  instructions ("keep going", "drive slowly"). If there is no natural endpoint,
  call \`cruise\` — never invent a long duration to simulate it.
- If the user is chatting or asking a question, just answer. Do not call a tool.
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
 * @param {Array<{ id: string, name: string, args: object | null, rawArguments: string }>} toolCalls
 * @returns {{ actions: Action[], replyLang: 'zh'|'en'|'auto'|null, dropped: number, hadMoveIntent: boolean }}
 */
export function validate(toolCalls) {
  /** @type {Action[]} */
  const actions = [];
  /** @type {'zh'|'en'|'auto'|null} */
  let replyLang = null;
  let dropped = 0;
  let hadMoveIntent = false;

  for (const call of toolCalls) {
    if (call.name === 'move' || call.name === 'cruise' || call.name === 'stop') {
      hadMoveIntent = true;
    }
    const args = /** @type {any} */ (call.args);
    if (args === null) { dropped++; continue; }

    switch (call.name) {
      case 'move': {
        const raw = Array.isArray(args.steps) ? args.steps : [];
        const steps = [];
        // Rule 3: truncate rather than reject.
        for (const step of raw.slice(0, MAX_STEPS)) {
          if (isValidStep(step)) steps.push({
            drive: step.drive, steer: step.steer, duration_ms: step.duration_ms,
          });
          else dropped++;
        }
        // Rule 4: if every step died, dispatch nothing.
        if (steps.length > 0) actions.push({ kind: 'move', steps });
        break;
      }
      case 'cruise': {
        if (DRIVE_VALUES.includes(args.drive) && STEER_VALUES.includes(args.steer)) {
          actions.push({ kind: 'cruise', drive: args.drive, steer: args.steer });
        } else dropped++;
        break;
      }
      case 'stop':
        actions.push({ kind: 'stop' });
        break;
      case 'set_reply_language': {
        // Rule 5: it writes config, so it never becomes an action (spec §6.2).
        if (['zh', 'en', 'auto'].includes(args.lang)) replyLang = args.lang;
        else dropped++;
        break;
      }
      default:
        dropped++;
    }
  }

  return { actions, replyLang, dropped, hadMoveIntent };
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
  #llm; #executor; #tts; #earcon; #config; #onReplyLangChange;
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
   * }} deps
   */
  constructor(deps) {
    this.#llm = deps.llm;
    this.#executor = deps.executor;
    this.#tts = deps.tts;
    this.#earcon = deps.earcon;
    this.#config = deps.config;
    this.#onReplyLangChange = deps.onReplyLangChange ?? (() => {});
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
      this.#earcon('error');
      await this.#tts.speak(t(this.#config.lang, 'usbNotConnected'), { signal: turn.signal });
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
    } catch {
      // Cancelling is not failing. Without this line the `error` earcon and
      // "接口失败" would be the answer to the user changing their mind.
      if (turn.signal.aborted) return;
      this.#earcon('error');
      await this.#tts.speak(t(this.#config.lang, 'apiFailed'), { signal: turn.signal });
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

    const { actions, replyLang, hadMoveIntent } = validate(reply.toolCalls);

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
      this.#earcon('error');
    }

    if (reply.text) await this.#tts.speak(reply.text, { signal: turn.signal });
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
