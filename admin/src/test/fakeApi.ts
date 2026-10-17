// An in-memory brain behind fetch, speaking the same /api as admin-api.js.
import { vi } from 'vitest';
import type { Config, Detail } from '../types';
import { deepMerge } from '../merge';

export function blankConfig(): Config {
  const layer = () => ({ baseURL: '', apiKey: '', model: '' });
  return {
    stt: { ...layer(), prompt: '' }, llm: layer(), tts: { ...layer(), voice: '' },
    reflex: { ...layer(), threshold: 0.8, state: 'Robot said: "{robot}"\nPerson said: "{person}"', question: null },
    lang: 'en', replyLang: null, bargeIn: true, wakeWord: false,
    body: { motion: 'car' },
  };
}

export function installFakeApi(seed: Array<{ name: string; online?: boolean }> = []) {
  const chars = new Map<string, Detail>();
  let n = 0;
  const token = () => (++n).toString(16).padStart(32, '0');
  const make = (name: string, online = false): Detail =>
    ({ id: name, name, token: token(), online, config: blankConfig() });
  for (const s of seed) chars.set(s.name, make(s.name, s.online));
  const calls: Array<{ method: string; path: string; body: any; headers: Record<string, string> }> = [];
  const state = { down: false, addresses: ['192.168.1.5'] as string[] };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const path = String(input);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body, headers: (init.headers ?? {}) as Record<string, string> });
    if (state.down) throw new TypeError('Failed to fetch');
    if (path === '/api/lan') return json(200, { port: 8787, addresses: state.addresses });
    const m = path.match(/^\/api\/characters(?:\/([^/]+))?(\/token)?$/);
    if (!m) return json(404, { error: 'no such endpoint' });
    const id = m[1] === undefined ? undefined : decodeURIComponent(m[1]);
    if (id === undefined && method === 'GET') {
      return json(200, [...chars.values()].map((c) =>
        ({ id: c.id, name: c.name, online: c.online, ready: Boolean(c.config.llm.apiKey) })));
    }
    if (id === undefined && method === 'POST') {
      if (chars.has(body.name)) return json(400, { error: `a character called ${body.name} already exists` });
      const c = make(body.name);
      chars.set(c.id, c);
      return json(201, c);
    }
    const c = id === undefined ? undefined : chars.get(id);
    if (!c) return json(404, { error: 'no such character' });
    if (m[2] && method === 'POST') { c.token = token(); return json(200, { token: c.token }); }
    if (method === 'GET') return json(200, c);
    if (method === 'PATCH') {
      if (body.name !== undefined) c.name = body.name;
      if (body.config) c.config = deepMerge(c.config, body.config);
      return json(200, c);
    }
    if (method === 'DELETE') { chars.delete(c.id); return json(200, {}); }
    return json(405, { error: 'method not allowed' });
  }));

  return { chars, calls, state, patches: () => calls.filter((c) => c.method === 'PATCH') };
}
