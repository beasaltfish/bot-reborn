// The two folders the admin's preview may read, and nothing else.
//
// A preview is a picture of a body, not the body: what it shows is the same
// frames the pet and the tarot reader put on their screens, so the admin sees
// what the thing looks like instead of a promise. It is a file server, which
// means it is the one place in the brain where a URL becomes a path — so the
// path is rebuilt from a grammar, never taken as given, and every root is a
// constant in this file rather than anything the request can name.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = fileURLToPath(new URL('.', import.meta.url));

/** Where each preview root lives, relative to server/. @type {Record<string, string>} */
const ROOTS = { pet: 'pet/frames', tarot: 'tarot/cards' };

const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

// Lowercase only: on a case-insensitive filesystem `001.JPG` would find the
// frame, and a grammar that admits it is a grammar nobody can reason about.
// A dot is allowed inside a name (`cups-01.en.jpg`), which is why `..` is
// refused as a segment rather than as a substring.
const SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;
const IMAGE = /\.(?:jpg|jpeg|png)$/;

/** @param {string} rel */
function safeName(rel) {
  if (!IMAGE.test(rel)) return false;
  const parts = rel.split('/');
  return parts.every((p) => SEGMENT.test(p) && p !== '.' && p !== '..');
}

/** A frame this big is not a frame. */
const MAX_BYTES = 2 * 1024 * 1024;
/** Enough to look alive; the preview is a still carousel, not the animation. */
const MAX_PREVIEW_FRAMES = 6;

/**
 * A request path to a real file, or null.
 * @param {string} path already decoded, so `%2e%2e` is just `..` here
 * @returns {{ root: string, file: string } | null}
 */
export function previewFile(path) {
  const m = /^\/preview\/([a-z]+)\/(.+)$/.exec(path);
  if (!m) return null;
  const [, root, rel] = m;
  const base = ROOTS[root];
  if (!base) return null;
  if (!safeName(rel)) return null;
  const dir = join(SERVER_DIR, base);
  const file = join(dir, rel);
  // The grammar already refuses `..`, a backslash and a leading slash; this is
  // the second lock, in case the grammar is ever loosened by someone else.
  if (!file.startsWith(dir + sep)) return null;
  return { root, file };
}

/**
 * What the admin cycles through, per root. Frames come from the largest size
 * the pet's manifest rendered; cards are the first few the tarot art has.
 * @returns {Record<string, string[]>}
 */
export function previewList() {
  return Object.fromEntries(Object.entries(ROOTS).map(([root, base]) => [root, listRoot(root, join(SERVER_DIR, base))]));
}

/**
 * The biggest size in a list like `['160x128', '240x240', '320x240']`.
 * Lexical order would pick 160x128, and a 160 px panel is a thumbnail.
 * @param {string[]} sizes
 * @returns {string | undefined}
 */
function largest(sizes) {
  const area = (/** @type {string} */ s) => {
    const m = /^(\d+)x(\d+)$/.exec(s);
    return m ? Number(m[1]) * Number(m[2]) : 0;
  };
  return [...sizes].filter((s) => area(s) > 0).sort((a, b) => area(b) - area(a))[0];
}

/** @param {string} root @param {string} dir */
function listRoot(root, dir) {
  try {
    if (root === 'pet') {
      const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
      const size = largest(Array.isArray(manifest?.sizes) ? manifest.sizes : []);
      const anim = Object.entries(manifest?.anims ?? {}).find(([, a]) => /** @type {any} */ (a)?.loop)?.[0];
      if (!size || !anim || !safeName(`${size}/${anim}/a.jpg`)) return [];
      const files = readdirSync(join(dir, size, anim)).filter((f) => safeName(f) && f.endsWith('.jpg')).sort();
      // Every N-th frame, so six of sixteen are a walk, not a jitter.
      const step = Math.max(1, Math.floor(files.length / MAX_PREVIEW_FRAMES));
      return files.filter((_, i) => i % step === 0).slice(0, MAX_PREVIEW_FRAMES).map((f) => `${size}/${anim}/${f}`);
    }
    // Cards: the back plus a few faces, so the carousel shows a reading.
    const size = largest(readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name));
    if (!size) return [];
    return readdirSync(join(dir, size)).filter((f) => safeName(f) && f.endsWith('.jpg')).sort()
      .slice(0, MAX_PREVIEW_FRAMES).map((f) => `${size}/${f}`);
  } catch {
    // No art rendered yet: the admin falls back to the body's name.
    return [];
  }
}

/**
 * Answer a `/preview/` request. Always writes something: this is only reached
 * from the local branch of the brain's router.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {Promise<boolean>}
 */
export async function servePreview(req, res) {
  const path = pathOf(req.url ?? '');
  const send = (/** @type {number} */ status, /** @type {string} */ type, /** @type {string | Buffer} */ body) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(body);
  };
  if (path === null) return send(404, 'text/plain; charset=utf-8', 'Not found\n'), true;
  if (req.method !== 'GET') return send(405, 'text/plain; charset=utf-8', 'Method not allowed\n'), true;
  if (path === '/preview/list.json') return send(200, 'application/json; charset=utf-8', JSON.stringify(previewList())), true;
  const hit = previewFile(path);
  if (!hit) return send(404, 'text/plain; charset=utf-8', 'Not found\n'), true;
  try {
    const size = statSync(hit.file).size;
    if (size > MAX_BYTES) return send(404, 'text/plain; charset=utf-8', 'Not found\n'), true;
    const body = readFileSync(hit.file);
    const ext = /** @type {keyof typeof TYPES} */ (hit.file.slice(hit.file.lastIndexOf('.')));
    return send(200, TYPES[ext], body), true;
  } catch {
    return send(404, 'text/plain; charset=utf-8', 'Not found\n'), true;
  }
}

/** @param {string} url */
function pathOf(url) {
  try {
    return decodeURIComponent(new URL(url, 'http://x').pathname);
  } catch {
    return null;
  }
}
