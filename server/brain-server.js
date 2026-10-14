// The brain as a server: plain HTTP for a person who opens the address in a
// browser, the body link on /body, and a robot for each body that connects —
// built from the config of the character whose token it said hello with
// (spec §1.1). Construction only; main.js decides where the pieces come from.

import { createServer } from 'node:http';
import { createLink } from './link.js';
import { startRobot } from './robot.js';
import { findByToken, saveCharacter, ready } from './characters.js';
import { BODY_PATH } from '../web/protocol.js';

/**
 * @param {{
 *   characters: () => import('./characters.js').Character[],
 *   fetch?: typeof fetch,
 *   makeEars: () => { kws: any, vad: any },
 *   sfx: Map<any, Int16Array>, earcons: Record<string, Int16Array>,
 *   log?: (line: string) => void, slackMs?: number, allowedOrigins?: string[],
 * }} opts
 */
export function createBrainServer(opts) {
  const log = opts.log ?? console.log;
  const http = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`bot-reborn brain. Bodies connect over WebSocket at ${BODY_PATH}.\n`);
  });
  /** Looked up when admitted, used when built: the same object in between. */
  /** @type {Map<string, import('./characters.js').Character>} */ const admitted = new Map();
  const link = createLink({
    server: http,
    log,
    allowedOrigins: opts.allowedOrigins,
    admit: (token) => {
      // Read fresh at every hello, so an edited file needs no restart.
      const c = findByToken(opts.characters(), token);
      if (!c) return 'token';
      // Refused at the door rather than answering every turn with apiFailed:
      // a body can show "this character is not set up" once, plainly.
      if (!ready(c.config)) return 'unconfigured';
      admitted.set(c.id, c);
      return { id: c.id, name: c.name };
    },
    onBody: (conn, who) => {
      const c = /** @type {import('./characters.js').Character} */ (admitted.get(who.id));
      admitted.delete(who.id);
      // Fresh ears per body: the VAD holds the last body's half sentence.
      const robot = startRobot(conn, {
        config: c.config,
        save: (cfg) => saveCharacter({ ...c, config: cfg }),
        fetch: opts.fetch, ears: opts.makeEars(),
        sfx: opts.sfx, earcons: opts.earcons, slackMs: opts.slackMs,
        log: (line) => log(`[${c.name}] ${line}`),
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
