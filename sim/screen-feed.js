// The bench's screen as a real one would be (multi-screen spec §5.5): the same
// /screen socket the firmware opens, the same hello with its size. The hello is
// a pure function and is tested; the socket touches the browser and is only
// exercised on the page.
//
// One connection per character, however many screens of that model stand on
// the bench: the firmware drives one panel, and the caller hands the same
// frame to every glass.

import { PROTOCOL, SCREEN_PATH } from '../core/protocol.js';

/** @typedef {import('../core/screens.js').Screen} Screen */

/**
 * The hello a screen sends: protocol, token, and the size it wants pictures
 * for. A screen that omits `screen` is a 320×240 panel (plan 1, Task 4).
 * @param {string} token
 * @param {Screen} model
 */
export function screenHello(token, model) {
  return { type: 'hello', protocol: PROTOCOL, token, screen: { w: model.w, h: model.h } };
}

/**
 * Open a screen feed and keep it open. Reconnects once a second after a drop
 * until stop(); a `reject` means no retry will help, so it stops and says why
 * in the console. Browser only.
 * @param {{
 *   token: string, model: Screen,
 *   onFrame(img: ImageBitmap): void,
 *   log?: (line: string) => void,
 * }} o
 * @returns {{ stop(): void }}
 */
export function openScreenFeed(o) {
  const log = o.log ?? ((/** @type {string} */ line) => console.warn(line));
  let stopped = false;
  /** @type {WebSocket | null} */ let ws = null;
  /** @type {ReturnType<typeof setTimeout> | null} */ let retry = null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (retry) clearTimeout(retry);
    retry = null;
    ws?.close();
    ws = null;
  };

  const connect = () => {
    if (stopped) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${proto}://${location.host}${SCREEN_PATH}`);
    ws = socket;
    // Binary frames are JPEGs; a Blob is what createImageBitmap wants.
    socket.binaryType = 'blob';
    socket.addEventListener('open', () => socket.send(JSON.stringify(screenHello(o.token, o.model))));
    socket.addEventListener('message', (event) => {
      const data = /** @type {string | Blob} */ (event.data);
      if (typeof data === 'string') {
        /** @type {any} */
        let msg;
        try { msg = JSON.parse(data); } catch { return; }
        if (msg?.type === 'reject') {
          log(`screen: the brain refused the bench's screen (${msg.reason})`);
          stop();
        } else if (msg?.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }));
        }
        return;
      }
      createImageBitmap(data).then(
        (img) => { if (!stopped) o.onFrame(img); },
        // A frame that will not decode is dropped, as a panel would drop it.
        () => {},
      );
    });
    socket.addEventListener('close', () => {
      if (stopped) return;
      retry = setTimeout(connect, 1000);
    });
    // An error is followed by a close; the retry above is the whole response.
    socket.addEventListener('error', () => {});
  };

  connect();
  return { stop };
}
