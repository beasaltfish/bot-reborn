// The built pages, from dist/ (npm start). Which address is which page is
// server/pages.js's table; who may ask is brain-server.js's business. Also
// the two synthesised check clips the admin page's STT test plays, asked for
// at /fixtures/… — the recorded ones are a person's voice and never served.
// Nothing outside dist/ is reachable, however the path is spelled.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { htmlFor, pathOf } from './pages.js';

export const DIST_DIR = fileURLToPath(new URL('../dist/', import.meta.url));
export const FIXTURES_DIR = fileURLToPath(new URL('../core/fixtures/', import.meta.url));

/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.webmanifest': 'application/manifest+json',
};

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} file
 * @param {string} cache
 */
function send(req, res, file, cache) {
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': cache });
  res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
}

/**
 * The parts both modes share: the check clips, and /phone and /sim sent to
 * their slash so relative links resolve. Dev mode (dev-pages.js) calls this too.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} path
 * @param {string} fixtures
 * @returns {boolean} whether it answered
 */
export function serveCommon(req, res, path, fixtures) {
  if (path === '/phone' || path === '/sim') {
    res.writeHead(301, { Location: `${path}/` });
    res.end();
    return true;
  }
  const clip = /^\/fixtures\/(check-[a-z]+\.wav)$/.exec(path);
  if (!clip) return false;
  const file = join(fixtures, clip[1]);
  if (!existsSync(file)) return false;
  send(req, res, file, 'no-cache');
  return true;
}

/**
 * @param {{ dist: string, fixtures: string }} opts
 * @returns {import('./pages.js').PageServer}
 */
export function createDistPages(opts) {
  const root = resolve(opts.dist);
  return {
    async serve(req, res) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return false;
      const path = pathOf(req);
      if (path === null) return false;
      if (serveCommon(req, res, path, opts.fixtures)) return true;
      const page = htmlFor(path);
      // Every page is one build: no admin page means nothing was built.
      if (page && !existsSync(join(root, 'admin', 'index.html'))) {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('The pages are not built yet. Run: npm run build\n');
        return true;
      }
      const file = resolve(root, '.' + (page ? `/${page.html}` : path));
      if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) return false;
      // Hashed names change with their content, so those keep; everything
      // else revalidates, so a rebuilt brain is what the phone runs next.
      send(req, res, file, path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      return true;
    },
    async close() {},
  };
}
