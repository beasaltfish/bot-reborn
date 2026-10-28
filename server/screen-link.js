// The screen's end of the wire (pet screen spec §5): the second WebSocket a
// body with a screen opens, carrying JPEG frames and nothing else.
//
// Why a separate path instead of tagging binary frames on /body: a phone body
// connected to a character configured as `pet` never opens this socket, so it
// can never play a JPEG as PCM — the spec's hard constraint — with no protocol
// bump and no change to any existing body. The handshake is the body link's,
// minus `busy`: a character may have several screens.

import { WebSocketServer } from 'ws';
import { PROTOCOL, SCREEN_PATH, encode, parse } from '../core/protocol.js';
import { DEFAULT_SIZE, sizeKey } from '../core/screens.js';

/**
 * @param {{ server: import('node:http').Server,
 *           admit: (token: string) => { id: string, name: string } | string,
 *           log?: (line: string) => void, allowedOrigins?: string[],
 *           pingMs?: number, maxBuffered?: number }} opts
 */
export function createScreenLink(opts) {
  const log = opts.log ?? console.log;
  const allowed = new Set(opts.allowedOrigins ?? []);
  const pingMs = opts.pingMs ?? 2000;
  // 32 KB is two idle frames: a socket holding more than that is behind, and
  // the frame it would get is already stale. The screen is fed what is
  // happening now, not a backlog.
  const maxBuffered = opts.maxBuffered ?? 32 * 1024;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });

  /** @param {import('node:http').IncomingMessage} req @param {import('node:stream').Duplex} socket @param {Buffer} head */
  const onUpgrade = (req, socket, head) => {
    let path;
    try { path = new URL(req.url ?? '/', 'http://x').pathname; } catch { return; }
    if (path !== SCREEN_PATH) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  };
  opts.server.on('upgrade', onUpgrade);

  /** Character id → every screen showing it. */
  /** @type {Map<string, Set<import('ws').WebSocket>>} */ const screens = new Map();
  /**
   * Per connection: the size it asked for, the character's name (for logs),
   * and whether the one missing-frames line has been said. Per connection, not
   * per frame: idle is 8 fps, and one line per frame would bury the log.
   * @type {Map<import('ws').WebSocket, { size: string, name: string, warned: boolean }>}
   */
  const screenInfo = new Map();

  wss.on('connection', (ws, req) => {
    const from = req.socket.remoteAddress ?? '?';
    /** @type {string | null} */ let id = null;
    let welcomed = false;
    let alive = true;
    const helloTimer = setTimeout(() => ws.terminate(), 5000);
    /** @param {string} reason */
    const reject = (reason) => {
      ws.send(encode({ type: 'reject', reason }));
      ws.close();
    };

    ws.on('message', (data, isBinary) => {
      // Screens only ever talk to say hello and pong; anything else is ignored.
      if (isBinary) return;
      const msg = parse(String(data), 'body');
      if (!msg) return;
      if (!welcomed) {
        if (msg.type !== 'hello') return;
        clearTimeout(helloTimer);
        if (msg.protocol !== PROTOCOL) return reject('protocol');
        const origin = req.headers.origin;
        if (origin && !allowed.has(origin) && !sameHost(origin, req.headers.host)) return reject('origin');
        if (typeof msg.token !== 'string') return reject('token');
        const size = screenSize(msg.screen);
        if (size === null) return reject('screen');
        const who = opts.admit(msg.token);
        if (typeof who === 'string') return reject(who);
        id = who.id;
        welcomed = true;
        screenInfo.set(ws, { size: size ?? DEFAULT_SIZE, name: who.name, warned: false });
        if (!screens.has(id)) screens.set(id, new Set());
        screens.get(id)?.add(ws);
        ws.send(encode({ type: 'welcome', name: who.name }));
        log(`screen for ${who.name} connected from ${from}`);
        return;
      }
      if (msg.type === 'ping') ws.send(encode({ type: 'pong' }));
      if (msg.type === 'pong') alive = true;
    });

    // The body link's watchdog, minus the audio: a screen that stops answering
    // pings is gone, and a dead socket in the set would only ever cost a
    // bufferedAmount check.
    const beat = setInterval(() => {
      if (!welcomed) return;
      if (!alive) { ws.terminate(); return; }
      alive = false;
      ws.send(encode({ type: 'ping' }));
    }, pingMs);

    ws.on('close', () => {
      clearTimeout(helloTimer);
      clearInterval(beat);
      screenInfo.delete(ws);
      if (id === null) return;
      const set = screens.get(id);
      set?.delete(ws);
      if (set && set.size === 0) screens.delete(id);
      log(`screen for ${id} disconnected`);
    });
    ws.on('error', (err) => log(`screen ${from}: ${err.message}`));
  });

  return {
    /**
     * Send one frame to every screen of this character, each in its own size.
     * The animator hands over `pick(size)`, so all screens show the same frame
     * of the same animation — one player, not one per screen (spec §4). A
     * screen that cannot take it right now is skipped: frames are dropped,
     * never queued (spec §5). A size with no art stays blank, and says so once.
     * @param {string} id @param {import('./pet/frames.js').FramePick} pick
     */
    show(id, pick) {
      const set = screens.get(id);
      if (!set) return;
      for (const ws of set) {
        if (ws.readyState !== ws.OPEN) continue;
        if (ws.bufferedAmount > maxBuffered) continue;
        const info = screenInfo.get(ws);
        const jpeg = pick(info?.size ?? DEFAULT_SIZE);
        if (!jpeg) {
          // Not an error and not a disconnect: this panel just has nothing to
          // show. One line, because idle would otherwise repeat it 8×/s.
          if (info && !info.warned) {
            info.warned = true;
            log(`screen for ${info.name}: no frames for ${info.size} — it stays blank`);
          }
          continue;
        }
        ws.send(jpeg, { binary: true });
      }
    },
    /** How many screens this character has right now. @param {string} id */
    count(id) { return screens.get(id)?.size ?? 0; },
    close() {
      opts.server.off('upgrade', onUpgrade);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}

/**
 * The size a hello reports: undefined when the field is absent (an old
 * firmware), null when it is there but not two integers in range. A
 * half-specified size must not silently become 320×240 — that would put the
 * wrong-shaped picture on the one panel that needed to say something.
 * @param {any} s @returns {string | null | undefined}
 */
function screenSize(s) {
  if (s === undefined) return undefined;
  if (typeof s !== 'object' || s === null || Array.isArray(s)) return null;
  const { w, h } = s;
  if (!Number.isInteger(w) || !Number.isInteger(h)) return null;
  // 2048 is a sanity bound, not a panel: anything larger is a malformed hello
  // or a size nothing will ever be rendered for.
  if (w < 1 || h < 1 || w > 2048 || h > 2048) return null;
  return sizeKey({ w, h });
}

/** @param {string} origin @param {string | undefined} host */
function sameHost(origin, host) {
  try { return new URL(origin).host === host; } catch { return false; }
}
