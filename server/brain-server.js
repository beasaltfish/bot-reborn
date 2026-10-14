// The brain as a server: plain HTTP for a person who opens the address in a
// browser, the body link on /body, and a fresh robot for each body that
// connects. Construction only — main.js decides where the pieces come from.

import { createServer } from 'node:http';
import { createLink } from './link.js';
import { startRobot } from './robot.js';
import { BODY_PATH } from '../web/protocol.js';

/**
 * @param {{
 *   config: any, save?: (cfg: any) => void, fetch?: typeof fetch,
 *   makeEars: () => { kws: any, vad: any },
 *   sfx: Map<any, Int16Array>, earcons: Record<string, Int16Array>,
 *   log?: (line: string) => void, slackMs?: number,
 * }} opts
 */
export function createBrainServer(opts) {
  const log = opts.log ?? console.log;
  const http = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`bot-reborn brain. Bodies connect over WebSocket at ${BODY_PATH}.\n`);
  });
  const link = createLink({
    server: http,
    log,
    onBody: (conn) => {
      // Fresh ears per body: the VAD holds the last body's half sentence.
      const robot = startRobot(conn, {
        config: opts.config, save: opts.save, fetch: opts.fetch, ears: opts.makeEars(),
        sfx: opts.sfx, earcons: opts.earcons, log, slackMs: opts.slackMs,
      });
      conn.onClose(() => robot.stop());
    },
  });
  return {
    /** @param {number} port @returns {Promise<number>} the port actually bound */
    listen(port) {
      return new Promise((resolve) => http.listen(port, () =>
        resolve(/** @type {import('node:net').AddressInfo} */ (http.address()).port)));
    },
    close() {
      link.close();
      return new Promise((resolve) => http.close(() => resolve(undefined)));
    },
  };
}
