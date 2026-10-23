// The pages in dev mode (npm run dev): Vite inside the brain, on its server
// and its port, so the phone keeps the one address its Chrome flag trusts
// and its body link. Edits reload the page; hot reload rides a WebSocket on
// the same server, which the body link leaves alone (link.js).
//
// Vite answers for whatever reaches it. Who may ask is still brain-server.js's
// business, against server/pages.js's table — the network only ever gets the
// phone's page and what it loads, never the source tree.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { htmlFor, pathOf } from './pages.js';
import { serveCommon, FIXTURES_DIR } from './dist-pages.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/**
 * @param {import('node:http').Server} http
 * @param {{ fixtures?: string }} [opts]
 * @returns {import('./pages.js').PageServer}
 */
export function createDevPages(http, opts = {}) {
  // Imported here, not at the top: npm start must not load Vite at all.
  const ready = import('vite').then(({ createServer }) => createServer({
    configFile: join(ROOT, 'vite.config.js'),
    appType: 'custom',
    server: { middlewareMode: true, hmr: { server: http } },
  }));
  return {
    async serve(req, res) {
      const path = pathOf(req);
      if (path === null) return false;
      if (serveCommon(req, res, path, opts.fixtures ?? FIXTURES_DIR)) return true;
      const vite = await ready;
      const page = htmlFor(path);
      if (page) {
        const html = await vite.transformIndexHtml(req.url ?? path, readFileSync(join(ROOT, page.html), 'utf8'));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(html);
        return true;
      }
      return new Promise((resolve) => {
        res.on('finish', () => resolve(true));
        vite.middlewares(req, res, () => resolve(false));
      });
    },
    async close() {
      await (await ready).close();
    },
  };
}
