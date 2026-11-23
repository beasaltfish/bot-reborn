// The admin page's API (admin spec §3). JSON in, JSON out, this machine only
// — brain-server.js has already checked isLocalRequest before routing here.
// Writes also need X-Bot-Reborn: 1, which no page from elsewhere can send
// without a preflight this server never answers (spec §4).

import { createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import {
  listCharacters, characterById, createCharacter, patchCharacter,
  regenerateToken, deleteCharacter, ready,
} from './characters.js';
import { createCheckApi, LAYERS } from './check-api.js';
import { listFirmwareSources, readFirmwareSource } from './firmware-sources.js';
import { TEMPLATES, bodyById, bodyProblem, pluginBodies, resolveBody } from '../core/bodies.js';
import { adoptModule } from '../core/body-switch.js';
import { verbsOf } from '../core/actions.js';
import { installModule } from './modules.js';
import { BODIES_DIR } from './plugin-startup.js';
import { saveBody } from './plugin-bodies.js';

const MAX_BODY = 64 * 1024;

/**
 * A non-secret name for one pairing: the same token always has the same name,
 * a re-created character with the same id and a different token does not.
 * Domain-separated so the digest cannot be confused with any other use of a
 * token's SHA-256. The token itself never leaves the detail response.
 * @param {string} token
 */
export function setupIdFor(token) {
  return createHash('sha256').update('bot-reborn.setup.v1\0').update(token).digest('hex');
}

/**
 * The verbs a character's body can run, for the bench: what it can do, as
 * opposed to what its actions are called. Resolved from the patch, so a body
 * someone edited answers with the actions it actually has.
 * @param {import('../core/config.js').Config} config
 * @returns {string[]}
 */
function verbsOfBody(config) {
  return verbsOf(resolveBody(config.body?.id ?? 'toy', config.body).actions);
}

/**
 * @param {{ dir: string, link: { online(): string[], kick(id: string): boolean },
 *           addresses?: () => string[], fetch?: typeof fetch, checkTimeoutMs?: number,
 *           dev?: { draw(id: string): boolean },
 *           presence?: { of(id: string, setupId?: string): { lastSeenAt?: number, lastSpokeAt?: number } },
 *           bodyKind?: (setupId: string) => 'phone' | undefined,
 *           modules?: Record<string, import('./modules.js').ModuleManifest>,
 *           bodiesDir?: string, log?: (line: string) => void }} opts
 *   `dev` exists only when the brain was started with --dev (tarot mode spec §5).
 *   `presence` is this process's memory; with none, the summary omits both times.
 *   `bodyKind` is this process's last admitted body kind for a pairing.
 *   `modules` is the catalogue the brain read at startup, and `bodiesDir` is
 *   where an install writes it; with neither, nothing can be installed.
 */
export function createAdminApi(opts) {
  const check = createCheckApi({ fetch: opts.fetch, timeoutMs: opts.checkTimeoutMs });
  /** @param {import('./characters.js').Character} c @param {Set<string>} online */
  const detail = (c, online) => ({
    id: c.id, name: c.name, token: c.token, setupId: setupIdFor(c.token), config: c.config,
    endpoints: c.endpoints ?? [], savedReflexes: c.savedReflexes ?? [], online: online.has(c.id),
  });

  /**
   * What the admin page needs to offer a module: the manifest's own words, the
   * examples it may adopt, and whether its body is already installed. Read from
   * `pluginBodies()` at request time so an install shows up without a restart.
   * @returns {Array<Record<string, unknown>>}
   */
  const moduleList = () => Object.values(opts.modules ?? {}).map((m) => ({
    id: m.id,
    label: { en: m.label.en, zh: m.label.zh },
    parts: [...m.parts],
    note: m.note ? { en: m.note.en, zh: m.note.zh } : null,
    // The bench's half of the manifest: without it a module has no project.
    ...(m.wiring ? { wiring: structuredClone(m.wiring) } : {}),
    installed: Object.hasOwn(pluginBodies(), m.id),
    examples: structuredClone(m.examples ?? []),
    commands: (m.commands ?? []).map((command) => command.name),
  }));

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
    if (path === '/api/lan') {
      if (req.method !== 'GET') return send(405, { error: 'method not allowed' });
      // What the QR code is made of: the address a phone on this Wi-Fi can
      // reach, and the port this request came in on.
      return send(200, { port: req.socket.localPort, addresses: (opts.addresses ?? lanAddresses)() });
    }
    // The plugin bodies this brain loaded, with everything needed to build the
    // same body in the page: the label in both languages, the commands and the
    // pins they may touch. All of it is local plugin data, none of it secret.
    // The page registers these bodies before drawing them, so `resolveBody`
    // agrees with the brain about `chosen`, `bodyProblem` and the actions box.
    if (path === '/api/bodies') {
      if (req.method !== 'GET') return send(405, { error: 'method not allowed' });
      return send(200, Object.values(pluginBodies()).map((b) => ({
        id: b.id,
        label: { en: b.label.en, zh: b.label.zh },
        commands: b.commands ?? [],
        resources: b.resources ?? [],
        // A project needs the parts as well as the pins: without them the
        // workbench has a body it cannot draw.
        parts: b.parts ?? [],
        ...(b.wiring ? { wiring: structuredClone(b.wiring) } : {}),
      })));
    }
    // The modules the repository ships, and a way to install one into this
    // brain. The id in the path is looked up in the catalogue `installModule`
    // was handed, never joined to a directory as given: a traversal is a name
    // that is not there, and answers 404 like any other unknown module.
    if (path === '/api/modules') {
      if (req.method !== 'GET') return send(405, { error: 'method not allowed' });
      return send(200, moduleList());
    }
    const mod = path.match(/^\/api\/modules\/([^/]+)\/install\/?$/);
    if (mod) {
      if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
      let id;
      try { id = decodeURIComponent(mod[1]); } catch { return send(404, { error: 'no such module' }); }
      const result = installModule(id, {
        modules: opts.modules ?? {},
        bodiesDir: opts.bodiesDir ?? BODIES_DIR,
        log: opts.log ?? console.error,
      });
      if ('error' in result) return send(404, { error: result.error });
      return send(200, result);
    }
    // A body a person edited on the bench, saved under their own id. The write
    // is the same one the loader will read on the next start; this only saves a
    // restart.
    if (path === '/api/bodies/save') {
      if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
      let manifest;
      try { manifest = await readJson(req); } catch { return send(400, { error: 'the body must be JSON' }); }
      const saved = saveBody(manifest, { bodiesDir: opts.bodiesDir ?? BODIES_DIR });
      if ('error' in saved) return send(400, { error: saved.error });
      return send(200, saved);
    }
    // Adopting a body into a character, for the workbench: installing writes the
    // body, and this is the one write that follows it. The rule is `core/`'s, so
    // the page and the brain cannot answer the same question differently.
    const adopt = path.match(/^\/api\/bodies\/([^/]+)\/adopt\/?$/);
    if (adopt) {
      if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
      let id;
      try { id = decodeURIComponent(adopt[1]); } catch { return send(404, { error: 'no such body' }); }
      let input;
      try { input = await readJson(req); } catch { return send(400, { error: 'the body must be JSON' }); }
      const characterId = /** @type {any} */ (input)?.characterId;
      if (typeof characterId !== 'string' || characterId === '') {
        return send(400, { error: 'characterId must be a string' });
      }
      // Not registered: its examples would name commands nothing can run yet.
      const moduleBody = bodyById(id);
      if (!moduleBody) return send(404, { error: `no body called ${id}; install it first` });
      const character = characterById(characterId, opts.dir);
      if (!character) return send(404, { error: `no character called ${characterId}` });

      const manifest = /** @type {any} */ (opts.modules ?? {})[id];
      const examples = Array.isArray(manifest?.examples) ? manifest.examples : [];
      const patch = /** @type {any} */ (character.config?.body ?? {});
      // The character's own actions, as the page carries them: what it merely
      // inherited belongs to the template it is leaving, and `core/` is the one
      // rule for both callers. The panel's copy has to say that in words.
      const current = Array.isArray(patch.actions) ? patch.actions : [];
      /** @type {(actions: any[]) => string | null} */
      const accepts = (actions) => {
        const names = new Set(actions.map((action) => action.name));
        const triggers = (moduleBody.triggers ?? []).filter((trigger) => names.has(trigger.action));
        return bodyProblem({ ...moduleBody, actions, triggers });
      };
      const { body, dropped } = adoptModule(
        patch, id, current, examples, (name) => Object.hasOwn(TEMPLATES, name), accepts,
      );
      const refused = bodyProblem(resolveBody(body.id ?? patch.id ?? id, { ...patch, ...body }));
      if (refused) return send(400, { error: refused });
      try { patchCharacter(character.path, { config: { body } }); } catch (error) {
        return send(400, { error: String(/** @type {Error} */ (error).message ?? error) });
      }
      return send(200, { body, dropped });
    }
    // A way to draw a card before the wand has a message of its own. Not a
    // feature: it is only there in dev mode, and without it this path is a 404.
    if (path === '/api/dev/draw' && opts.dev) {
      if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
      let body;
      try { body = await readJson(req); } catch (err) {
        return send(/** @type {any} */ (err).status ?? 400, { error: /** @type {Error} */ (err).message });
      }
      if (typeof body?.id !== 'string') return send(400, { error: 'id must be a string' });
      return send(200, { started: opts.dev.draw(body.id) });
    }
    const c1 = path.match(/^\/api\/check\/([^/]+)\/?$/);
    if (c1) {
      const layer = /** @type {any} */ (c1[1]);
      if (!LAYERS.includes(layer)) return send(404, { error: 'no such layer' });
      if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
      let body;
      try { body = await readJson(req); } catch (err) {
        return send(/** @type {any} */ (err).status ?? 400, { error: /** @type {Error} */ (err).message });
      }
      return check(res, layer, body);
    }
    const fw = path.match(/^\/api\/firmware\/sources(?:\/([^/]+))?\/?$/);
    if (fw) {
      if (req.method !== 'GET') return send(405, { error: 'method not allowed' });
      if (fw[1] === undefined) return send(200, { files: listFirmwareSources() });
      let file;
      try { file = decodeURIComponent(fw[1]); } catch { return send(403, { error: 'invalid firmware source name' }); }
      try {
        const text = readFirmwareSource(file);
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(text);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return send(message.includes('invalid') ? 403 : 404, { error: message });
      }
    }
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
          // Never keys, never tokens: this is the call the page polls. The
          // setup id names the pairing without being usable as its password.
          return send(200, listCharacters(opts.dir).characters.map((c) => {
            const setupId = setupIdFor(c.token);
            const bodyKind = opts.bodyKind?.(setupId);
            // The body as the brain resolves it, and the tools it would offer the
            // model: the workbench asks "is this character the body this demo
            // builds", and a name alone cannot answer that.
            const resolved = resolveBody(c.config.body?.id ?? 'toy', c.config.body);
            return {
              id: c.id, name: c.name, ready: ready(c.config), online: online.has(c.id),
              // `motion` stays for tabs that predate `verbs`: the bench asks
              // what the body can do, not which template it was copied from.
              // Resolved the same way the brain does, so a config with an id
              // and no template answers `none`, not its own name.
              motion: resolved.template ?? null,
              verbs: verbsOfBody(c.config), setupId,
              // `template` is the body it follows; `id` is only a name of its
              // own. Two characters with the same template share a body.
              bodyId: resolved.template ?? resolved.id,
              // A config is a person's file, not a value to trust: a body whose
              // actions were saved as something else has none to name, and must
              // not take the whole list down with it.
              actionNames: (Array.isArray(resolved.actions) ? resolved.actions : [])
                .map((action) => action.name),
              ...(bodyKind ? { bodyKind } : {}),
              ...(opts.presence?.of(c.id, setupId) ?? {}),
            };
          }));
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
        patchCharacter(c.path, { name: body?.name, config: body?.config, endpoints: body?.endpoints, savedReflexes: body?.savedReflexes });
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

// Interfaces a phone on the same Wi-Fi can never reach: macOS's bridges
// (Internet Sharing, VMs), VPN and proxy tunnels, and the virtual ones Linux
// and containers add. Matched by name, because their addresses look ordinary.
const VIRTUAL_IFACE = /^(bridge|utun|tun|tap|awdl|llw|anpi|ap|vnic|vmnet|vboxnet|docker|veth|virbr|tailscale|zt|lo)/;

/**
 * Only the private ranges a home or office Wi-Fi hands out. 198.18.0.0/15
 * (proxy fake-IP tools) and 100.64.0.0/10 (tailnets) fall outside them.
 * @param {string} a dotted IPv4
 */
function isPrivateIPv4(a) {
  const [x, y] = a.split('.').map(Number);
  return x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168);
}

/**
 * The addresses a phone could reach this machine on, in interface order.
 * @param {Record<string, Array<{ family: string | number, internal: boolean, address: string }> | undefined>} ifaces
 *   what os.networkInterfaces() returns
 * @returns {string[]}
 */
export function lanAddressesFrom(ifaces) {
  return Object.entries(ifaces).flatMap(([name, list]) => (VIRTUAL_IFACE.test(name) ? [] : (list ?? [])
    .filter((i) => (i.family === 'IPv4' || i.family === 4) && !i.internal && isPrivateIPv4(i.address))
    .map((i) => i.address)));
}

/** IPv4 addresses on this machine's network interfaces a phone could use. */
export function lanAddresses() {
  return lanAddressesFrom(networkInterfaces());
}
