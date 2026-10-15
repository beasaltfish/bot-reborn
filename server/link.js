// The brain's end of the wire (server/body split spec §3): handshake, one
// body per character, and the heartbeat both sides' watchdogs run on.
//
// Who a token belongs to is the caller's business (admit), and so is the
// robot built for a body (onBody). This file only decides who is connected
// and whether they are still there.

import { WebSocketServer } from 'ws';
import {
  PROTOCOL, BODY_PATH, HEARTBEAT_MS, WATCHDOG_MS, encode, parse,
} from '../core/protocol.js';

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
 * @param {{ server: import('node:http').Server,
 *           admit: (token: string) => { id: string, name: string } | string,
 *           onBody: (conn: BodyConn, who: { id: string, name: string }) => void,
 *           heartbeatMs?: number, watchdogMs?: number, helloTimeoutMs?: number,
 *           allowedOrigins?: string[], log?: (line: string) => void }} opts
 */
export function createLink(opts) {
  const heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;
  const watchdogMs = opts.watchdogMs ?? WATCHDOG_MS;
  const log = opts.log ?? console.log;
  const allowed = new Set(opts.allowedOrigins ?? []);
  // A body's frames are 100 ms of PCM (3.2 kB). The ws default is 100 MiB a
  // frame, buffered before anyone has said hello.
  const wss = new WebSocketServer({ server: opts.server, path: BODY_PATH, maxPayload: 64 * 1024 });
  /** Character id → its body. One body per character (spec §1.1). */
  /** @type {Map<string, import('ws').WebSocket>} */ const active = new Map();

  wss.on('connection', (ws, req) => {
    const from = req.socket.remoteAddress ?? '?';
    /** @type {string | null} */ let id = null;
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
        // Any web page the user opens may connect to localhost: browsers do
        // not apply same-origin rules to WebSockets. An ESP32 or a script
        // sends no Origin; a page always does, and only a listed one is ours.
        const origin = req.headers.origin;
        if (origin && !allowed.has(origin)) return reject('origin');
        if (typeof msg.token !== 'string') return reject('token');
        const who = opts.admit(msg.token);
        if (typeof who === 'string') return reject(who);
        if (active.has(who.id)) return reject('busy');
        id = who.id;
        active.set(id, ws);
        welcomed = true;
        conn.caps = msg.caps;
        // Welcome first: a body may treat anything before it as a protocol
        // error, and the robot starts talking (its state) the moment it is
        // built. Building it in the same synchronous turn is still early
        // enough — the body's first audio can only arrive on a later tick.
        ws.send(encode({ type: 'welcome', name: who.name }));
        opts.onBody(conn, who);
        // The watchdog starts now, not at hello. Building the robot loads the
        // ears' models synchronously, and on a busy machine that took longer
        // than WATCHDOG_MS — the first heartbeat then dropped every body as
        // silent before its queued pongs were even read.
        lastSeen = Date.now();
        log(`${who.name} connected from ${from} ${JSON.stringify(msg.caps)}`);
        beat = setInterval(() => {
          if (Date.now() - lastSeen > watchdogMs) {
            log(`${who.name} (${from}) went silent — dropping it`);
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
      if (id !== null && active.get(id) === ws) {
        active.delete(id);
        log(`${id} disconnected`);
        for (const fn of closes) fn();
      }
    });
    ws.on('error', (err) => log(`body ${from}: ${err.message}`));
  });

  return {
    close() {
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
    /** Ids of the characters with a body connected right now. */
    online: () => [...active.keys()],
    /**
     * Drop a character's body: its token was replaced or it was deleted, and
     * a body that stayed connected would go on as if neither had happened.
     * The close handlers run as for any disconnect.
     * @param {string} id
     */
    kick(id) {
      const ws = active.get(id);
      if (!ws) return false;
      ws.close();
      return true;
    },
  };
}
