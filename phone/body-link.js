// The phone's end of the wire (server/body split spec §3): hello, pong, the
// watchdog, and coming back after a drop. server/fake-body.js is the
// reference; this is the same behaviour for a browser.
//
// Two ways to end, and they are not the same. A drop — the brain went quiet,
// restarted, the Wi-Fi blinked — is reported as lost (the caller brakes) and
// retried by itself. A reject is the brain saying no — a replaced token, a
// second phone on one character — and knocking again would only hear it again,
// so it is final.

import { PROTOCOL, HEARTBEAT_MS, WATCHDOG_MS, encode, parse } from '../core/protocol.js';

/** How long to wait before each retry; the last one repeats. */
const RETRY_MS = [500, 1000, 2000, 5000];

/**
 * @typedef {{
 *   readyState: number, binaryType: string,
 *   send(data: string | ArrayBufferLike): void, close(): void,
 *   onopen: ((ev: any) => void) | null,
 *   onmessage: ((ev: { data: any }) => void) | null,
 *   onclose: ((ev: any) => void) | null,
 * }} WebSocketLike
 */

/**
 * @param {{
 *   url: string, token: string, caps: Record<string, boolean>,
 *   WebSocket?: new (url: string) => WebSocketLike,
 *   onWelcome: (name: string) => void,
 *   onMessage: (msg: any) => void,
 *   onAudio: (bytes: ArrayBuffer) => void,
 *   onLost: () => void,
 *   onReject: (reason: string) => void,
 *   watchdogMs?: number, heartbeatMs?: number, retryMs?: number[],
 * }} opts
 */
export function connectBody(opts) {
  const Socket = opts.WebSocket ?? /** @type {any} */ (globalThis).WebSocket;
  const watchdogMs = opts.watchdogMs ?? WATCHDOG_MS;
  const heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;
  const retryMs = opts.retryMs ?? RETRY_MS;

  /** @type {WebSocketLike | null} */ let ws = null;
  let welcomed = false;
  let finished = false;
  let attempt = 0;
  let lastHeard = 0;
  /** @type {ReturnType<typeof setInterval> | null} */ let beat = null;
  /** @type {ReturnType<typeof setInterval> | null} */ let dog = null;
  /** @type {ReturnType<typeof setTimeout> | null} */ let retry = null;

  const quiet = () => {
    if (beat) clearInterval(beat);
    if (dog) clearInterval(dog);
    beat = dog = null;
  };

  function open() {
    /** @type {WebSocketLike} */ const socket = new Socket(opts.url);
    ws = socket;
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => {
      socket.send(encode({ type: 'hello', protocol: PROTOCOL, token: opts.token, caps: opts.caps }));
    };
    socket.onmessage = (ev) => {
      lastHeard = Date.now();
      if (typeof ev.data !== 'string') {
        if (welcomed) opts.onAudio(ev.data);
        return;
      }
      const msg = parse(ev.data, 'brain');
      if (!msg) return;
      if (!welcomed) {
        if (msg.type === 'reject') {
          finished = true;
          socket.close();
          opts.onReject(msg.reason);
          return;
        }
        if (msg.type !== 'welcome') return;
        welcomed = true;
        attempt = 0;
        beat = setInterval(() => send({ type: 'ping' }), heartbeatMs);
        // Checked every 50 ms, so "within the watchdog" is within it plus a
        // twentieth of a second, not plus a whole heartbeat.
        dog = setInterval(() => { if (Date.now() - lastHeard > watchdogMs) socket.close(); }, 50);
        opts.onWelcome(msg.name);
        return;
      }
      if (msg.type === 'ping') return send({ type: 'pong' });
      if (msg.type === 'pong') return;
      opts.onMessage(msg);
    };
    socket.onclose = () => {
      if (ws !== socket) return;
      quiet();
      welcomed = false;
      ws = null;
      if (finished) return;
      opts.onLost();
      const wait = retryMs[Math.min(attempt, retryMs.length - 1)];
      attempt++;
      retry = setTimeout(open, wait);
    };
  }

  /** @param {object} msg */
  function send(msg) {
    if (ws && ws.readyState === 1) ws.send(encode(msg));
  }

  open();

  return {
    get welcomed() { return welcomed; },
    send,
    /** @param {Int16Array} pcm */
    sendAudio(pcm) {
      // No audio before welcome (spec §3): the brain would drop it anyway.
      if (welcomed && ws && ws.readyState === 1) {
        ws.send(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
      }
    },
    close() {
      finished = true;
      if (retry) clearTimeout(retry);
      quiet();
      ws?.close();
    },
  };
}
