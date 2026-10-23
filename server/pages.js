// The brain's pages, in one table: which address is which page, and which
// addresses the network may open. Everything here is for this machine only
// except the phone's page and what it loads — it holds no key, and a body
// still needs a character's token to be let in (server/body split spec §3).
//
// "What it loads" differs by mode and both sets are allowed at once: built,
// it is /assets/…; in dev mode it is the core/ modules it imports and Vite's
// /@vite/client and /@vite/env. In the other mode those paths do not exist.
// The admin and sim code in /assets/ goes to the network too; it holds no
// key — the keys reach the admin page only through /api/, which stays here.

/** @typedef {{ url: string, html: string, lan: boolean }} Page */

/**
 * What answers for the pages: the built ones (dist-pages.js) or Vite (dev-pages.js).
 * `serve` resolves false for a path that is not its own, and the brain says 404.
 * @typedef {{
 *   serve(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<boolean>,
 *   close(): Promise<void>,
 * }} PageServer
 */

/** `html` is relative to the repo root, and is where the build puts it under dist/. */
/** @type {readonly Page[]} */
export const PAGES = [
  { url: '/', html: 'admin/index.html', lan: false },
  { url: '/sim/', html: 'sim/index.html', lan: false },
  { url: '/phone/', html: 'phone/index.html', lan: true },
  { url: '/phone/dev.html', html: 'phone/dev.html', lan: true },
];

/** @param {string} path @returns {Page | null} */
export function htmlFor(path) {
  const url = path.endsWith('/index.html') ? path.slice(0, -'index.html'.length) : path;
  return PAGES.find((p) => p.url === url) ?? null;
}

/** @param {string} path */
export function lanAllowed(path) {
  if (path.split('/').includes('..')) return false;
  if (path === '/phone' || path.startsWith('/phone/') || path.startsWith('/assets/')) return true;
  if (path === '/@vite/client' || path === '/@vite/env') return true;
  return path.startsWith('/core/') && path.endsWith('.js') && !path.startsWith('/core/fixtures/');
}
