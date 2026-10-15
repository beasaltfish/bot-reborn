// The brain as a server: the admin page and its API for this machine only,
// the phone's page on /phone/ for this network, the body link on /body for anyone with a character's token, and a robot for
// each body that connects — built from that character's config (server/body
// split spec §1.1, admin spec §2). Construction only; main.js decides where
// the pieces come from.

import { createServer } from 'node:http';
import { createLink } from './link.js';
import { startRobot } from './robot.js';
import { listCharacters, findByToken, updateConfig, ready } from './characters.js';
import { isLocalRequest } from './local-guard.js';
import { serveStatic, servePhone, ADMIN_DIST, FIXTURES_DIR, PHONE_DIR, CORE_DIR } from './static.js';
import { createAdminApi } from './admin-api.js';

/**
 * @param {{
 *   dir: string, adminDist?: string,
 *   fetch?: typeof fetch,
 *   makeEars: () => { kws: any, vad: any },
 *   sfx: Map<any, Int16Array>, earcons: Record<string, Int16Array>,
 *   log?: (line: string) => void, slackMs?: number, allowedOrigins?: string[],
 *   phoneDir?: string, coreDir?: string, addresses?: () => string[],
 * }} opts
 */
export function createBrainServer(opts) {
  const log = opts.log ?? console.log;
  /** @type {((req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>) | null} */
  let api = null;
  const http = createServer((req, res) => {
    // The phone's page first: it is for the whole network, and holds no key.
    if (servePhone(req, res, { phone: opts.phoneDir ?? PHONE_DIR, core: opts.coreDir ?? CORE_DIR })) return;
    // The body link is a WebSocket upgrade and never reaches here; everything
    // else is the admin page or its API, and both hold keys and tokens.
    if (!isLocalRequest(req)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('The admin page only opens on the computer the brain runs on.\n');
      return;
    }
    if ((req.url ?? '').startsWith('/api/')) return void api?.(req, res);
    if (!serveStatic(req, res, { root: opts.adminDist ?? ADMIN_DIST, fixtures: FIXTURES_DIR })) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found\n');
    }
  });
  /** Looked up when admitted, used when built: the same object in between. */
  /** @type {Map<string, import('./characters.js').Character>} */ const admitted = new Map();
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
        fetch: opts.fetch, ears: opts.makeEars(),
        sfx: opts.sfx, earcons: opts.earcons, slackMs: opts.slackMs,
        log: (line) => log(`[${c.name}] ${line}`),
      });
      conn.onClose(() => robot.stop());
    },
  });
  api = createAdminApi({ dir: opts.dir, link, addresses: opts.addresses });
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
