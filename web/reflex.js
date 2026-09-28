// The reflex layer's judge: is this transcript somebody barking at me?
// Reflex spec §3.
//
// JEV is a classifier, not a chat model: it answers typed questions about a
// piece of state with probabilities, and generates no text. It is asked
// BEFORE the LLM and only ever says fired / passed / skipped / failed — what
// to do about a bark is the ladder's business (ladder.js), not the model's.
//
// Every way this can go wrong ends in "ask the LLM as usual". The reflex is a
// shortcut; a robot whose shortcut is down must still answer.

/** Spec §3: provisional until a real-voice run confirms it (spec §9 step 2). */
export const FIRE_AT = 0.8;
/** Spec §2. Sequential, so this is the most a normal sentence can wait. */
export const TIMEOUT_MS = 1500;

/**
 * Measured 2026-09-28 as "v2": 6/9 teases fired, 0/13 false fires. JEV reads
 * characters, not sound, so it is told the homophones outright — and told, in
 * the same breath, which short replies are never noises. The second half is
 * what keeps 明白 after 你明白吗 from being eaten.
 */
export const INSTRUCTIONS =
  'A person is talking to a small pet-like robot. "Robot said" is the robot\'s last '
  + 'line, if any; "Person said" is a speech-recognition transcript of the reply. '
  + 'The transcript may use wrong characters with the same sound: a bark 汪汪 can '
  + 'arrive as 忘忘 or 往往, a meow 喵喵 as 苗苗. '
  + 'Only call it an animal noise when the sound is a repeated syllable that makes no '
  + 'sense as an answer to what the robot said. Short real words that answer the robot '
  + '(明白, 好的, 嗯嗯, 对对, 哈哈) are replies, never noises. '
  + 'What is the person doing?';

export const CRITERIA = {
  tease: 'Making an animal noise at the robot (bark, meow, howl) — a sound, not words',
  command: 'Telling the robot to move, turn, hurry or stop',
  reply: 'Answering, agreeing, laughing, or talking in real words',
};

const CJK = /\p{Script=Han}/gu;
const PUNCTUATION = /[\p{P}\p{S}]/gu;

/**
 * Spec §2: a length cut, not a word list. Animal noises transcribe short, and
 * a long sentence is not worth a second of waiting on the classifier.
 * @param {string} text
 */
export function shortEnough(text) {
  const bare = text.replace(PUNCTUATION, ' ').trim();
  if (!bare) return false;
  const cjk = bare.match(CJK);
  if (cjk) return cjk.length <= 6;
  return bare.split(/\s+/).length <= 3;
}

/** @param {string} heard @param {string} robotSaid */
export function buildState(heard, robotSaid) {
  return (robotSaid ? `Robot said: 「${robotSaid}」\n` : '') + `Person said: 「${heard}」`;
}

/** @typedef {{ verdict: 'fired'|'passed'|'skipped'|'failed', detail: string, ms: number }} Verdict */

export class Reflex {
  #cfg; #fetch; #timeoutMs; #now;

  /**
   * @param {{ baseURL: string, apiKey: string, model: string }} cfg
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
    if (!shortEnough(heard)) return { verdict: 'skipped', detail: 'too long', ms: 0 };

    const timeout = AbortSignal.timeout(this.#timeoutMs);
    const both = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await this.#fetch(`${this.#cfg.baseURL}/systemone`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.#cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.#cfg.model,
          state: buildState(heard, robotSaid),
          questions: { intent: { type: 'choice', instructions: INSTRUCTIONS, criteria: CRITERIA } },
        }),
        signal: both,
      });
      if (!response.ok) return { verdict: 'failed', detail: `HTTP ${response.status}`, ms: ms() };
      const intent = (await response.json())?.answers?.intent;
      const p = intent?.probabilities?.tease;
      if (typeof intent?.choice !== 'string' || typeof p !== 'number') {
        return { verdict: 'failed', detail: 'unexpected response', ms: ms() };
      }
      const detail = `${intent.choice} ${p.toFixed(2)}`;
      const fired = intent.choice === 'tease' && p >= FIRE_AT;
      return { verdict: fired ? 'fired' : 'passed', detail, ms: ms() };
    } catch (err) {
      const why = timeout.aborted && !signal?.aborted ? 'timeout' : /** @type {Error} */ (err).message;
      return { verdict: 'failed', detail: why, ms: ms() };
    }
  }
}
