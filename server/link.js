// The brain's end of the wire (server/body split spec §3): handshake, one
// body at a time, and the heartbeat both sides' watchdogs run on.
//
// The robot built for a body is the caller's business (onBody). This file
// only decides who is connected and whether they are still there.

import { WebSocketServer } from 'ws';
import {
  PROTOCOL, BODY_PATH, HEARTBEAT_MS, WATCHDOG_MS, encode, parse,
} from '../web/protocol.js';

/**
 * @typedef {{
 *   caps: Record<string, unknown>,
 *   readonly open: boolean,
 *   send(msg: object): void,
 *   sendAudio(bytes: Uint8Array): void,
 *   onAudio(fn: (bytes: Uint8Array) => void): void,
 *   onMessage(fn: (msg: any) => void): void,
 *   onClose(fn: () => void): void,
 *   close(): void,
 * }} BodyConn
 */

/**
 * @param {{ server: import('node:http').Server, onBody: (conn: BodyConn) => void,
 *           heartbeatMs?: number, watchdogMs?: number, helloTimeoutMs?: number,
 *           log?: (line: string) => void }} opts
 */
export function createLink(opts) {
  const heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;
  const watchdogMs = opts.watchdogMs ?? WATCHDOG_MS;
  const log = opts.log ?? console.log;
  const wss = new WebSocketServer({ server: opts.server, path: BODY_PATH });
  /** @type {import('ws').WebSocket | null} */ let active = null;

  wss.on('connection', (ws, req) => {
    const who = req.socket.remoteAddress ?? '?';
    const helloTimer = setTimeout(() => ws.terminate(), opts.helloTimeoutMs ?? 5000);
    /** @type {((bytes: Uint8Array) => void)[]} */ const audio = [];
    /** @type {((msg: any) => void)[]} */ const messages = [];
    /** @type {(() => void)[]} */ const closes = [];
    let welcomed = false;
    let open = true;
    let lastSeen = Date.now();
    /** @type {ReturnType<typeof setInterval> | null} */ let beat = null;

    /** @type {BodyConn} */
    const conn = {
      caps: {},
      get open() { return open; },
      // A closed socket is a no-op, not a throw: the session's emergency stop
      // runs AFTER the body is gone, and must not fail for that reason.
      send: (msg) => { if (open) ws.send(encode(msg)); },
      sendAudio: (bytes) => { if (open) ws.send(bytes, { binary: true }); },
      onAudio: (fn) => { audio.push(fn); },
      onMessage: (fn) => { messages.push(fn); },
      onClose: (fn) => { closes.push(fn); },
      close: () => ws.close(),
    };

    /** @param {string} reason */
    const reject = (reason) => {
      ws.send(encode({ type: 'reject', reason }));
      ws.close();
    };

    ws.on('message', (data, isBinary) => {
      lastSeen = Date.now();
      const bytes = /** @type {Buffer} */ (data);
      if (isBinary) {
        // No audio before welcome (spec §3): there is no robot to hear it yet.
        if (welcomed) for (const fn of audio) fn(bytes);
        return;
      }
      const msg = parse(bytes.toString('utf8'), 'body');
      if (!msg) return;
      if (!welcomed) {
        if (msg.type !== 'hello') return;
        clearTimeout(helloTimer);
        if (msg.protocol !== PROTOCOL) return reject('protocol');
        if (active) return reject('busy');
        active = ws;
        welcomed = true;
        conn.caps = msg.caps;
        // The robot is built BEFORE the welcome goes out, so its listeners
        // are in place by the time the body, told it may, starts streaming.
        opts.onBody(conn);
        ws.send(encode({ type: 'welcome' }));
        log(`body connected from ${who} ${JSON.stringify(msg.caps)}`);
        beat = setInterval(() => {
          if (Date.now() - lastSeen > watchdogMs) {
            log(`body ${who} went silent — dropping it`);
            ws.terminate();
            return;
          }
          conn.send({ type: 'ping' });
        }, heartbeatMs);
        return;
      }
      if (msg.type === 'ping') return conn.send({ type: 'pong' });
      if (msg.type === 'pong') return;
      for (const fn of messages) fn(msg);
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (beat) clearInterval(beat);
      open = false;
      if (active === ws) {
        active = null;
        log(`body ${who} disconnected`);
        for (const fn of closes) fn();
      }
    });
    ws.on('error', (err) => log(`body ${who}: ${err.message}`));
  });

  return {
    close() {
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}
