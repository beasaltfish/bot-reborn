// Files the brain serves: the admin page to this machine, and the phone's page
// to the network. For this machine: the built admin page, and the two
// synthesised check clips its STT test plays (checks.js asks for them at
// fixtures/…, relative to the page). Nothing else on disk is reachable,
// however the path is spelled.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ADMIN_DIST = fileURLToPath(new URL('../admin/dist/', import.meta.url));
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
 * @param {{ root: string, fixtures: string }} opts
 * @returns {boolean} whether it answered
 */
export function serveStatic(req, res, opts) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let path;
  try { path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname); } catch { return false; }
  /** @type {string} */ let file;
  if (path.startsWith('/fixtures/')) {
    const name = path.slice('/fixtures/'.length);
    // Only the synthesised clips: the recorded ones are a person's voice.
    if (!/^check-[a-z]+\.wav$/.test(name)) return false;
    file = join(opts.fixtures, name);
  } else {
    if (!existsSync(join(opts.root, 'index.html'))) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('The admin page is not built yet. Run: npm run admin:build\n');
      return true;
    }
    const root = resolve(opts.root);
    file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + sep)) return false;
  }
  if (!existsSync(file) || !statSync(file).isFile()) return false;
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
  return true;
}

export const PHONE_DIR = fileURLToPath(new URL('../phone/', import.meta.url));
export const CORE_DIR = fileURLToPath(new URL('../core/', import.meta.url));

/**
 * The phone's page, for anything on this network: /phone/… from phone/, and
 * the modules it shares with the brain at /core/…. It holds no key — a body
 * still needs a character's token to be let in (server/body split spec §3).
 * Only .js from core/: it also holds fixtures/, and the recorded ones are a
 * person's voice.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ phone: string, core: string }} opts
 * @returns {boolean} whether it answered
 */
export function servePhone(req, res, opts) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let path;
  try { path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname); } catch { return false; }
  if (path === '/phone') {
    res.writeHead(301, { Location: '/phone/' });
    res.end();
    return true;
  }
  /** @type {string} */ let root;
  /** @type {string} */ let rest;
  if (path.startsWith('/phone/')) { root = opts.phone; rest = path.slice('/phone'.length); }
  else if (path.startsWith('/core/') && path.endsWith('.js')) { root = opts.core; rest = path.slice('/core'.length); }
  else return false;
  const base = resolve(root);
  const file = resolve(base, '.' + (rest === '/' ? '/index.html' : rest));
  if (!file.startsWith(base + sep) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found\n');
    return true;
  }
  // no-cache, not no-store: the phone revalidates, so a restarted brain with
  // new code is what it runs next time, not what it cached last week.
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
  return true;
}
