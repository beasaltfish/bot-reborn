// The reflex layer's judge: one typed question to a decision model, asked
// before the LLM. Configurable reflex spec §3.1.
//
// A decision model (JEV, or one trained with Unsloth and served at
// /v1/systemone) is a classifier, not a chat model: it answers a typed
// question about a piece of state with probabilities, and generates no text.
// WHICH question, and what each answer does, are the character's: the admin
// writes both. Here is only how to ask and how to read the answer.
//
// Every way this can go wrong ends in "ask the LLM as usual". The reflex is a
// shortcut; a robot whose shortcut is down must still answer.

/** Sequential, so this is the most a normal sentence can wait. */
export const TIMEOUT_MS = 1500;

/**
 * Spec §2.4. A line naming {robot} goes when the robot has said nothing yet,
 * which is how the training data writes a first sentence. One pass over the
 * template, so braces inside what was said stay as they were.
 * @param {string} template @param {string} heard @param {string} robotSaid
 */
export function fillState(template, heard, robotSaid) {
  return template
    .split('\n')
    .filter((line) => robotSaid || !line.includes('{robot}'))
    .join('\n')
    .replace(/\{(robot|person)\}/g, (_, k) => (k === 'robot' ? robotSaid : heard));
}

/** @param {import('./config.js').ReflexQuestion} q @returns {Record<string, string>} */
export function criteriaOf(q) {
  return Object.fromEntries(q.options.map((o) => [o.choice, o.description]));
}

/**
 * `calls` only on a fire: the chosen option's actions in validate()'s input
 * shape, so they become Actions by exactly the rules the LLM's do.
 * @typedef {{ name: string, args: any, rawArguments: string }} ToolCall
 * @typedef {{ verdict: 'fired'|'passed'|'failed', detail: string, ms: number, calls?: ToolCall[] }} Verdict
 */

export class Reflex {
  #cfg; #fetch; #timeoutMs; #now;

  /**
   * @param {import('./config.js').ReflexLayer} cfg
   * @param {{ fetch?: typeof fetch, timeoutMs?: number, now?: () => number }} [opts]
   */
  constructor(cfg, opts = {}) {
    this.#cfg = cfg;
    this.#fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
    this.#now = opts.now ?? (() => Date.now());
  }

  /**
   * Never rejects: a verdict of `failed` is how every error arrives.
   * @param {string} heard
   * @param {string} robotSaid
   * @param {AbortSignal} [signal] the turn's; cancelling the turn cancels this
   * @returns {Promise<Verdict>}
   */
  async judge(heard, robotSaid, signal) {
    const start = this.#now();
    const ms = () => this.#now() - start;
    const { question, threshold, state } = this.#cfg;
    if (!question) return { verdict: 'failed', detail: 'no question', ms: 0 };

    // Inside the try, both: AbortSignal.any is Chrome 116+, and an engine
    // without it must fail this verdict, not reject — handle() does not catch.
    /** @type {AbortSignal | null} */ let timeout = null;
    try {
      timeout = AbortSignal.timeout(this.#timeoutMs);
      const both = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const response = await this.#fetch(`${this.#cfg.baseURL}/systemone`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.#cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.#cfg.model,
          state: fillState(state, heard, robotSaid),
          questions: { [question.name]: { type: 'choice', instructions: question.instructions, criteria: criteriaOf(question) } },
        }),
        signal: both,
      });
      if (!response.ok) return { verdict: 'failed', detail: `HTTP ${response.status}`, ms: ms() };
      const answer = (await response.json())?.answers?.[question.name];
      const choice = answer?.choice;
      const p = typeof answer?.probabilities?.[choice] === 'number' ? answer.probabilities[choice] : answer?.confidence;
      if (typeof choice !== 'string' || typeof p !== 'number') {
        return { verdict: 'failed', detail: 'unexpected response', ms: ms() };
      }
      const detail = `${choice} ${p.toFixed(2)}`;
      const option = question.options.find((o) => o.choice === choice);
      if (!option || option.actions.length === 0 || p < threshold) return { verdict: 'passed', detail, ms: ms() };
      const calls = option.actions.map((a) => ({
        name: a.name, args: structuredClone(a.args), rawArguments: JSON.stringify(a.args),
      }));
      return { verdict: 'fired', detail, ms: ms(), calls };
    } catch (err) {
      const why = timeout?.aborted && !signal?.aborted ? 'timeout' : /** @type {Error} */ (err).message;
      return { verdict: 'failed', detail: why, ms: ms() };
    }
  }
}
