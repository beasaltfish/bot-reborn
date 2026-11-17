// The board's life: boot events on timers, the brain link, the screen link,
// and a generation that makes stale timers harmless. No DOM; the caller
// supplies the socket factory and the output callbacks.
import { bodyBoot } from './body-boot.js';
import { firmwareFor } from './index.js';
import { compile } from './lang/index.js';
import { createMachine } from './lang/index.js';
import { createSketchRunner } from './sketch.js';
import { rejectIsFinal } from './retry.js';

/** The screen socket that belongs to the same brain as the body socket. */
/** @param {string} bodyUrl @returns {string} */
export function screenUrl(bodyUrl) {
  if (!bodyUrl) return '';
  try {
    const url = new URL(bodyUrl);
    url.pathname = '/screen';
    // The body's hello query belongs to /body; the screen link has none.
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

/** What a USB insert should do. `pendingFlash` wins over a normal boot. */
/** @param {{ blocked?: boolean, pendingFlash?: string | null }} [intent] */
export function bootMode(intent = {}) {
  if (intent.blocked) return 'blocked';
  if (intent.pendingFlash) return 'bootloader';
  return 'boot';
}

/**
 * @param {{
 *   board: import('../bench.js').BoardState,
 *   bench: import('../bench.js').Bench,
 *   outcome: Record<string, any>,
 *   profile?: unknown,
 *   brainUrl?: string,
 *   connect: (opts: any) => { close(): void, send(msg: object): void, sendAudio(pcm: Int16Array): void },
 *   openScreen?: (opts: any) => { stop(): void },
 *   ownership?: Record<string, 'board'|'circuit'|'unknown'>,
 *   initDevices?: (ids: string[]) => Record<string, 'active'|'init-failed'>,
 *   bootInitMs?: number,
 *   sketch?: { ctx: () => any, render?: () => void, onTrace?: (records: any[]) => void, onTiming?: (ms: number) => void, intervalMs?: number },
 *   onLine(line: string): void,
 *   onLed(mode: string): void,
 *   onDevice?(msg: any): void,
 *   audio?: {
 *     attach(send: (pcm: Int16Array) => void): unknown,
 *     downlink(bytes: ArrayBuffer): void,
 *     hush?(): void,
 *     stop?(): void,
 *   },
 *   now?: () => number,
 * }} o
 */
export function createBoardRuntime(o) {
  const firmware = o.board.firmware ? firmwareFor(o.board) : undefined;
  const dialed = o.board.settings.url || o.brainUrl || '';
  const now = o.now ?? (() => Date.now());
  let generation = 0;
  /** @type {ReturnType<typeof setTimeout>[]} */ let timers = [];
  /** @type {ReturnType<typeof o.connect> | null} */ let conn = null;
  /** @type {ReturnType<NonNullable<typeof o.openScreen>> | null} */ let feed = null;
  /** @type {number | null} */ let busySince = null;
  let micStarted = false;
  /** @type {Record<string, 'uninitialized'|'active'|'init-failed'>} */
  let states = {};
  /** @type {ReturnType<typeof createMachine> | null} */ let machine = null;
  /** @type {ReturnType<typeof createSketchRunner> | null} */ let sketchRunner = null;

  /** @param {{ blocked?: boolean, pendingFlash?: string | null }} [intent] */
  function mode(intent = {}) {
    return bootMode(intent);
  }

  /** The board devices this firmware carries, and only those the board drives. */
  function drivenIds() {
    if (!firmware) return [];
    return o.bench.placed
      .filter((part) => part.part !== 'esp32' && firmware.drivers.includes(part.part))
      .filter((part) => {
        const owner = o.ownership?.[part.id];
        return owner === undefined || owner === 'board';
      })
      .map((part) => part.id);
  }

  function stop() {
    generation += 1;
    for (const timer of timers) clearTimeout(timer);
    timers = [];
    micStarted = false;
    states = {};
    sketchRunner?.stop();
    sketchRunner = null;
    machine?.stop();
    machine = null;
    conn?.close();
    conn = null;
    feed?.stop();
    feed = null;
    // A reboot keeps the speaker and microphone: it only clears the queue.
    // Powering off stops the audio link from the caller, which owns it.
    o.audio?.hush?.();
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
        // The link is up first; the microphone is asked for afterwards, so a
        // refusal cannot keep the body off the brain.
        if (!micStarted) {
          micStarted = true;
          void o.audio?.attach((pcm) => conn?.sendAudio(pcm));
        }
      },
      onMessage: (/** @type {any} */ msg) => o.onDevice?.(msg),
      onAudio: (/** @type {ArrayBuffer} */ bytes) => o.audio?.downlink(bytes),
      onLost: () => {
        o.audio?.hush?.();
        o.onLine(`lost ${dialed}; trying again`);
      },
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
    const ids = drivenIds();
    // Nothing a board device shows before its firmware initialised it.
    states = Object.fromEntries(ids.map((id) => [id, 'uninitialized']));
    // A sketch has no body boot: no protocol line, no not-set-up loop and no
    // link. Its own one line is all a serial panel shows (spec §11).
    const events = firmware.link
      ? bodyBoot({ settings: o.board.settings, firmware, bench: o.bench, outcome: o.outcome, profile: o.profile, now: now() })
      : [{ afterMs: 0, line: `${firmware.id}: illustrative sketch, no console on this firmware` }];
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
    if (ids.length) {
      timers.push(setTimeout(() => {
        if (gen !== generation) return;
        const verdicts = o.initDevices?.(ids) ?? Object.fromEntries(ids.map((id) => [id, 'active']));
        states = Object.fromEntries(ids.map((id) => [id, verdicts[id] ?? 'active']));
      }, o.bootInitMs ?? 1000));
    }
    if (firmware && !firmware.link && o.sketch && o.outcome.esp === 'ok') {
      let runnable = firmware;
      if (firmware.id === 'custom') {
        const source = o.board.custom?.flashed ?? '';
        if (!source) {
          o.onLine('no custom firmware');
          return;
        }
        const { program, errors } = compile(source);
        if (!program || errors.length) {
          o.onLine(`custom firmware: ${errors[0]?.message ?? 'invalid source'}`);
          return;
        }
        const created = createMachine({ program, now });
        machine = created;
        runnable = { ...firmware, tick: (ctx) => created.tick(ctx) };
      }
      sketchRunner = createSketchRunner({
        firmware: runnable,
        ctx: o.sketch.ctx,
        render: o.sketch.render,
        onTrace: o.sketch.onTrace,
        onTiming: o.sketch.onTiming,
        intervalMs: o.sketch.intervalMs,
      });
      sketchRunner.start();
    }
  }

  /** @returns {Record<string, string>} */
  function deviceStates() {
    if (!firmware || o.outcome.esp !== 'ok') return {};
    return { ...states };
  }

  return {
    get generation() { return generation; },
    get machine() { return machine; },
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
