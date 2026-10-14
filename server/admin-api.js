// The admin page's API (admin spec §3). JSON in, JSON out, this machine only
// — brain-server.js has already checked isLocalRequest before routing here.
// Writes also need X-Bot-Reborn: 1, which no page from elsewhere can send
// without a preflight this server never answers (spec §4).

import {
  listCharacters, characterById, createCharacter, patchCharacter,
  regenerateToken, deleteCharacter, ready,
} from './characters.js';

const MAX_BODY = 64 * 1024;

/**
 * @param {{ dir: string, link: { online(): string[], kick(id: string): boolean } }} opts
 */
export function createAdminApi(opts) {
  /** @param {import('./characters.js').Character} c @param {Set<string>} online */
  const detail = (c, online) => ({ id: c.id, name: c.name, token: c.token, config: c.config, online: online.has(c.id) });

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  return async function handle(req, res) {
    /** @param {number} status @param {unknown} body */
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'GET' && req.headers['x-bot-reborn'] !== '1') return send(403, { error: 'missing X-Bot-Reborn header' });

    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const m = path.match(/^\/api\/characters(?:\/([^/]+))?(\/token)?\/?$/);
    if (!m) return send(404, { error: 'no such endpoint' });
    let id;
    try { id = m[1] === undefined ? undefined : decodeURIComponent(m[1]); } catch { return send(404, { error: 'no such character' }); }
    const online = new Set(opts.link.online());

    /** @type {any} */ let body;
    if (req.method === 'POST' || req.method === 'PATCH') {
      try { body = await readJson(req); } catch (err) {
        return send(/** @type {any} */ (err).status ?? 400, { error: /** @type {Error} */ (err).message });
      }
    }

    try {
      if (id === undefined) {
        if (req.method === 'GET') {
          // Never keys, never tokens: this is the call the page polls.
          return send(200, listCharacters(opts.dir).characters.map((c) => ({
            id: c.id, name: c.name, ready: ready(c.config), online: online.has(c.id),
          })));
        }
        if (req.method === 'POST') {
          if (typeof body?.name !== 'string') return send(400, { error: 'name must be a string' });
          return send(201, detail(createCharacter(body.name.trim(), opts.dir), online));
        }
        return send(405, { error: 'method not allowed' });
      }

      const c = characterById(id, opts.dir);
      if (!c) return send(404, { error: 'no such character' });

      if (m[2]) {
        if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
        const token = regenerateToken(c.path);
        // The old token must stop working now, not at the body's next hello.
        opts.link.kick(c.id);
        return send(200, { token });
      }
      if (req.method === 'GET') return send(200, detail(c, online));
      if (req.method === 'PATCH') {
        patchCharacter(c.path, { name: body?.name, config: body?.config });
        return send(200, detail(/** @type {any} */ (characterById(id, opts.dir)), online));
      }
      if (req.method === 'DELETE') {
        deleteCharacter(c.path);
        opts.link.kick(c.id);
        return send(200, {});
      }
      return send(405, { error: 'method not allowed' });
    } catch (err) {
      // Every throw left in characters.js is about the input: a bad or taken
      // name, a config that is not an object.
      return send(400, { error: /** @type {Error} */ (err).message });
    }
  };
}

/** @param {import('node:http').IncomingMessage} req */
function readJson(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */ const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('request body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch { reject(new Error('body is not JSON')); }
    });
    req.on('error', reject);
  });
}
