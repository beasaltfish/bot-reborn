// The brain as a server: the admin page and its API, and the wiring simulator
// on /sim/, for this machine only; the phone's page on /phone/ and what it
// loads for this network (server/pages.js says which addresses those are);
// the body link on /body for anyone with a character's token; and a
// robot for each body that connects — built from that character's config
// (server/body split spec §1.1, admin spec §2). Construction only; main.js
// decides where the pieces come from.

import { createServer } from 'node:http';
import { createLink } from './link.js';
import { createScreenLink } from './screen-link.js';
import { BODY_PATH, SCREEN_PATH } from '../core/protocol.js';
import { startRobot } from './robot.js';
import { listCharacters, findByToken, updateConfig, ready } from './characters.js';
import { isLocalRequest } from './local-guard.js';
import { lanAllowed, pathOf } from './pages.js';
import { createDistPages, DIST_DIR, FIXTURES_DIR } from './dist-pages.js';
import { createAdminApi } from './admin-api.js';

/**
 * @param {{
 *   dir: string,
 *   pages?: (http: import('node:http').Server) => import('./pages.js').PageServer,
 *   fetch?: typeof fetch,
 *   makeEars: () => { kws: any, vad: any },
 *   sfx: Map<any, Int16Array>, earcons: Record<string, Int16Array>,
 *   log?: (line: string) => void, slackMs?: number, allowedOrigins?: string[],
 *   addresses?: () => string[], petFrames?: import('./pet/frames.js').PetFrames,
 * }} opts
 */
export function createBrainServer(opts) {
  const log = opts.log ?? console.log;
  /** @type {((req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>) | null} */
  let api = null;
  /** @param {import('node:http').ServerResponse} res @param {number} status @param {string} text */
  const say = (res, status, text) => {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(text);
  };
  const http = createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      // A page that vanished mid-read (npm run build empties dist/) or a page
      // Vite could not transform: one failed request, not every body dropped.
      log(`serving ${req.url} failed: ${/** @type {Error} */ (err).message}`);
      if (!res.headersSent) say(res, 500, 'Something went wrong serving this page.\n');
      else res.destroy();
    }
  });
  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
  async function route(req, res) {
    const path = pathOf(req);
    // The phone's page and what it loads first: they are for the whole
    // network, and hold no key. The body link is a WebSocket upgrade and
    // never reaches here.
    if (path !== null && lanAllowed(path)) {
      if (!(await pages.serve(req, res))) say(res, 404, 'Not found\n');
      return;
    }
    // Everything else is the admin page or its API, both holding keys and
    // tokens, or the simulator, a bench tool: this machine only.
    if (!isLocalRequest(req)) {
      say(res, 403, 'The admin page only opens on the computer the brain runs on.\n');
      return;
    }
    if ((req.url ?? '').startsWith('/api/')) return void api?.(req, res);
    if (!(await pages.serve(req, res))) say(res, 404, 'Not found\n');
  }
  const pages = (opts.pages ?? (() => createDistPages({ dist: DIST_DIR, fixtures: FIXTURES_DIR })))(http);
  // An upgrade socket outlives every HTTP timeout, so one nobody takes is
  // refused here rather than left open: /body is the link's, /screen is the
  // pet screen's, hot reload is the dev pages', and nothing else is anyone's.
  http.on('upgrade', (req, socket) => {
    const path = pathOf(req);
    if (path === BODY_PATH || path === SCREEN_PATH || pages.upgrades?.(req)) return;
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });

  /** Looked up when admitted, used when built: the same object in between. */
  /** @type {Map<string, import('./characters.js').Character>} */
  const admitted = new Map();

  /**
   * A token to a character, read fresh at every hello so an edited file needs
   * no restart. Refused at the door rather than answering every turn with
   * apiFailed: a body can show "this character is not set up" once, plainly.
   * Shared by the body link and the screen link, which must not touch the
   * body's `admitted` map — a screen says nothing about whether a body is up.
   * @param {string} token
   * @returns {{ id: string, name: string, character: import('./characters.js').Character } | string}
   */
  const tokenLookup = (token) => {
    const now = listCharacters(opts.dir);
    for (const p of now.problems) log(`skipped ${p}`);
    const c = findByToken(now.characters, token);
    if (!c) return 'token';
    if (!ready(c.config)) return 'unconfigured';
    return { id: c.id, name: c.name, character: c };
  };

  const screen = createScreenLink({
    server: http, log, allowedOrigins: opts.allowedOrigins, admit: tokenLookup,
  });

  const link = createLink({
    server: http,
    log,
    allowedOrigins: opts.allowedOrigins,
    admit: (token) => {
      const who = tokenLookup(token);
      if (typeof who === 'string') return who;
      admitted.set(who.id, /** @type {import('./characters.js').Character} */ (who.character));
      return { id: who.id, name: who.name };
    },
    onBody: (conn, who) => {
      const c = /** @type {import('./characters.js').Character} */ (admitted.get(who.id));
      admitted.delete(who.id);
      // Fresh ears per body: the VAD holds the last body's half sentence.
      const robot = startRobot(conn, {
        config: c.config,
        // Only the field a robot changes by itself (§11.1's reply language).
        save: (cfg) => updateConfig(c.path, (disk) => { disk.replyLang = cfg.replyLang; }),
        fetch: opts.fetch,
        ears: opts.makeEars(),
        sfx: opts.sfx,
        earcons: opts.earcons,
        slackMs: opts.slackMs,
        petFrames: opts.petFrames,
        // Frames go to whichever screens this character has right now; with
        // none, the animator still runs and show() is a no-op.
        screen: (pick) => screen.show(c.id, pick),
        log: (line) => log(`[${c.name}] ${line}`),
      });
      conn.onClose(() => robot.stop());
    },
  });

  api = createAdminApi({ dir: opts.dir, link, addresses: opts.addresses, fetch: opts.fetch });

  return {
    /** @param {number} port @returns {Promise<number>} the port actually bound */
    listen(port) {
      return new Promise((resolve) => http.listen(port, () =>
        resolve(/** @type {import('node:net').AddressInfo} */ (http.address()).port)));
    },
    async close() {
      screen.close();
      link.close();
      await pages.close();
      return new Promise((resolve) => http.close(() => resolve(undefined)));
    },
  };
}
