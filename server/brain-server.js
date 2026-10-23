// The brain as a server: the admin page and its API, and the wiring simulator
// on /sim/, for this machine only; the phone's page on /phone/ and what it
// loads for this network (server/pages.js says which addresses those are);
// the body link on /body for anyone with a character's token; and a
// robot for each body that connects — built from that character's config
// (server/body split spec §1.1, admin spec §2). Construction only; main.js
// decides where the pieces come from.

import { createServer } from 'node:http';
import { createLink } from './link.js';
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
 *   addresses?: () => string[],
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
  });
  const pages = (opts.pages ?? (() => createDistPages({ dist: DIST_DIR, fixtures: FIXTURES_DIR })))(http);

  /** Looked up when admitted, used when built: the same object in between. */
  /** @type {Map<string, import('./characters.js').Character>} */
  const admitted = new Map();

  const link = createLink({
    server: http,
    log,
    allowedOrigins: opts.allowedOrigins,
    admit: (token) => {
      // Read fresh at every hello, so an edited file needs no restart.
      const now = listCharacters(opts.dir);
      for (const p of now.problems) log(`skipped ${p}`);
      const c = findByToken(now.characters, token);
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
        // Only the field a robot changes by itself (§11.1's reply language).
        save: (cfg) => updateConfig(c.path, (disk) => { disk.replyLang = cfg.replyLang; }),
        fetch: opts.fetch,
        ears: opts.makeEars(),
        sfx: opts.sfx,
        earcons: opts.earcons,
        slackMs: opts.slackMs,
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
      link.close();
      await pages.close();
      return new Promise((resolve) => http.close(() => resolve(undefined)));
    },
  };
}
