// What the tarot screen is showing, one frame at a time (tarot mode spec §8).
//
// Four states: the card back at rest (idle), a shuffle that loops until the
// reading is ready (at least SHUFFLE_MIN_MS), a flip through the narrowed back
// to the face, and the card held until the next draw. Pure logic, no sockets
// and no timers of its own: `show` is whatever puts a JPEG on the wire and
// `after` is whatever schedules the next frame, so it runs under a fake clock.

/** @typedef {import('../pet/frames.js').FramePick} FramePick */

/** The shuffle plays at least this long, however fast the reading is. */
export const SHUFFLE_MIN_MS = 1500;
/** How long the narrowed card back shows between the back and the face. */
const FLIP_MS = 120;
/**
 * At rest, and while a card is held, the current picture is sent again this
 * often. A screen can connect after the body, reconnect on its own, or have a
 * frame dropped for a busy socket (screen-link drops, never queues), and none
 * of them would otherwise see anything until the next draw. The pet's idle
 * does the same by ticking; this one is slower because nothing is moving.
 */
export const REFRESH_MS = 1000;

export class TarotAnimator {
  /** @type {import('./frames.js').TarotFrames} */ #frames;
  /** @type {(pick: FramePick) => void} */ #show;
  /** @type {(ms: number, fn: () => void) => () => void} */ #after;
  /** @type {(line: string) => void} */ #log;
  /** @type {() => 'zh' | 'en'} */ #lang;
  #running = false;
  /** @type {'idle' | 'shuffle' | 'flip' | 'hold'} */ #state = 'idle';
  #index = 0;
  #minDone = false;
  #wantReveal = false;
  /** @type {import('../../core/tarot.js').Draw | null} */ #draw = null;
  /** @type {Array<() => void>} */ #cancels = [];
  /** What the screen is showing now, for the refresh. @type {FramePick | null} */
  #current = null;
  /** @type {(() => void) | null} */ #cancelRefresh = null;

  /**
   * @param {{
   *   frames: import('./frames.js').TarotFrames,
   *   show: (pick: FramePick) => void,
   *   after?: (ms: number, fn: () => void) => () => void,
   *   log?: (line: string) => void,
   *   lang?: () => 'zh' | 'en',
   * }} deps `lang` is asked when the card turns over, so a language changed
   *   during the shuffle is the one the name is written in.
   */
  constructor({ frames, show, after, log = () => {}, lang = () => 'en' }) {
    this.#frames = frames;
    this.#show = show;
    this.#after = after ?? ((ms, fn) => {
      const timer = setTimeout(fn, ms);
      return () => clearTimeout(timer);
    });
    this.#log = log;
    this.#lang = lang;
  }

  /** A body connected: the card back, and nothing moving. */
  start() {
    this.stop();
    this.#running = true;
    this.#showBack();
    this.#scheduleRefresh();
  }

  /** The body is gone. The screen keeps its last frame; we just stop feeding it. */
  stop() {
    this.#running = false;
    this.#clear();
    this.#cancelRefresh?.();
    this.#cancelRefresh = null;
    this.#current = null;
    this.#state = 'idle';
    this.#draw = null;
  }

  /**
   * A card was drawn: shuffle until `reveal`. Whatever was showing, a held card
   * included, is replaced at once.
   * @param {import('../../core/tarot.js').Draw} card
   */
  draw(card) {
    if (!this.#running) return;
    this.#clear();
    this.#draw = card;
    this.#state = 'shuffle';
    this.#minDone = false;
    this.#wantReveal = false;
    this.#index = 0;
    if (this.#frames.shuffleCount === 0) {
      this.#log('tarot: no shuffle frames — the card back stays up until the reveal');
      this.#showBack();
    } else {
      this.#emitShuffle();
      this.#scheduleTick();
    }
    this.#cancels.push(this.#after(SHUFFLE_MIN_MS, () => {
      this.#minDone = true;
      if (this.#wantReveal) this.#flip();
    }));
  }

  /** The reading is ready (or has failed): turn the card over, not before the minimum. */
  reveal() {
    if (!this.#running || this.#state !== 'shuffle') return;
    if (this.#minDone) this.#flip();
    else this.#wantReveal = true;
  }

  #clear() {
    for (const cancel of this.#cancels) cancel();
    this.#cancels = [];
  }

  /** Put a picture on the screen, and remember it for the refresh. @param {FramePick} pick */
  #put(pick) {
    this.#current = pick;
    this.#show(pick);
  }

  #showBack() {
    const frames = this.#frames;
    this.#put((size) => frames.back(size));
  }

  #emitShuffle() {
    const frames = this.#frames;
    const i = this.#index;
    this.#put((size) => frames.shuffle(size)[i]);
  }

  /** Every REFRESH_MS, send again what is up, but only when nothing else is moving the picture. */
  #scheduleRefresh() {
    this.#cancelRefresh?.();
    this.#cancelRefresh = this.#after(REFRESH_MS, () => {
      if (!this.#running) return;
      if ((this.#state === 'idle' || this.#state === 'hold') && this.#current) this.#show(this.#current);
      this.#scheduleRefresh();
    });
  }

  #scheduleTick() {
    this.#cancels.push(this.#after(1000 / this.#frames.fps, () => {
      if (!this.#running || this.#state !== 'shuffle') return;
      this.#index = (this.#index + 1) % this.#frames.shuffleCount;
      this.#emitShuffle();
      this.#scheduleTick();
    }));
  }

  /** The back narrows, then the face: the card is turned over. */
  #flip() {
    const draw = /** @type {import('../../core/tarot.js').Draw} */ (this.#draw);
    this.#clear();
    this.#state = 'flip';
    const frames = this.#frames;
    this.#put((size) => frames.backNarrow(size));
    const lang = this.#lang();
    this.#cancels.push(this.#after(FLIP_MS, () => {
      if (!this.#running) return;
      this.#state = 'hold';
      this.#put((size) => frames.card(size, draw, lang));
    }));
  }
}
