// The board's life: boot events on timers, the brain link, the screen link,
// and a generation that makes stale timers harmless. No DOM; the caller
// supplies the socket factory and the output callbacks.
import { bodyBoot } from './body-boot.js';
import { firmwareById } from './index.js';
import { rejectIsFinal } from './retry.js';

/** The screen socket that belongs to the same brain as the body socket. */
/** @param {string} bodyUrl @returns {string} */
export function screenUrl(bodyUrl) {
  if (!bodyUrl) return '';
  try {
    const url = new URL(bodyUrl);
    url.pathname = '/screen';
    return url.toString();
  } catch {
    return '';
  }
}

/**
 * @param {{
 *   board: import('../bench.js').BoardState,
 *   bench: import('../bench.js').Bench,
 *   outcome: Record<string, any>,
 *   profile?: unknown,
 *   brainUrl?: string,
 *   connect: (opts: any) => { close(): void, send(msg: object): void },
 *   openScreen?: (opts: any) => { stop(): void },
 *   onLine(line: string): void,
 *   onLed(mode: string): void,
 *   onDevice?(msg: any): void,
 *   now?: () => number,
 * }} o
 */
export function createBoardRuntime(o) {
  const firmware = o.board.firmware ? firmwareById(o.board.firmware) : undefined;
  const dialed = o.board.settings.url || o.brainUrl || '';
  const now = o.now ?? (() => Date.now());
  let generation = 0;
  /** @type {ReturnType<typeof setTimeout>[]} */ let timers = [];
  /** @type {ReturnType<typeof o.connect> | null} */ let conn = null;
  /** @type {ReturnType<NonNullable<typeof o.openScreen>> | null} */ let feed = null;
  let busySince = null;

  /** @param {{ blocked?: boolean, pendingFlash?: string | null }} [intent] */
  function mode(intent = {}) {
    if (intent.blocked) return 'blocked';
    if (intent.pendingFlash) return 'bootloader';
    return 'boot';
  }

  function stop() {
    generation += 1;
    for (const timer of timers) clearTimeout(timer);
    timers = [];
    conn?.close();
    conn = null;
    feed?.stop();
    feed = null;
  }

  function openLink() {
    if (!firmware?.link) return;
    conn = o.connect({
      url: dialed,
      token: o.board.settings.token,
      retryOnReject: (/** @type {string} */ reason) => {
        const t = now();
        if (busySince === null) busySince = t;
        if (rejectIsFinal(reason, busySince, t)) return false;
        o.onLine('busy: another body has this character, or the brain has not let go of the last connection; trying again');
        o.onLed('CONNECTING');
        return true;
      },
      onWelcome: (/** @type {string} */ name) => {
        busySince = null;
        o.onLine(`welcomed as ${name}`);
      },
      onMessage: (/** @type {any} */ msg) => o.onDevice?.(msg),
      onAudio: () => {},
      onLost: () => o.onLine(`lost ${dialed}; trying again`),
      onReject: (/** @type {string} */ reason) => {
        o.onLine(`rejected: ${reason} — fix it, then type reboot`);
        o.onLed('REJECTED');
      },
    });
  }

  function openScreen() {
    if (!firmware?.link?.screen || !dialed || !o.openScreen) return;
    feed = o.openScreen({ url: screenUrl(dialed), token: o.board.settings.token });
  }

  function start() {
    stop();
    if (!firmware) return;
    const gen = generation;
    const events = bodyBoot({ settings: o.board.settings, firmware, bench: o.bench, outcome: o.outcome, profile: o.profile, now: now() });
    for (const event of events) {
      const timer = setTimeout(() => {
        if (gen !== generation) return;
        if (event.line) o.onLine(event.line);
        if (event.led) o.onLed(event.led);
        if (event.link === 'open') openLink();
        if (event.link === 'screen') openScreen();
      }, event.afterMs);
      timers.push(timer);
    }
  }

  /** @returns {Record<string, string>} */
  function deviceStates() {
    if (!firmware || o.outcome.esp !== 'ok') return {};
    /** @type {Record<string, string>} */
    const states = {};
    for (const part of o.bench.placed) {
      if (part.part === 'esp32') continue;
      if (firmware.drivers.includes(part.part)) states[part.id] = 'active';
    }
    return states;
  }

  return {
    get generation() { return generation; },
    mode,
    start,
    stop,
    reboot: start,
    /** @param {object} msg */
    send(msg) { conn?.send(msg); },
    shake() { conn?.send({ type: 'shake' }); },
    deviceStates,
  };
}
