// Every call carries X-Bot-Reborn: 1. The brain refuses writes without it,
// which is what keeps other pages in this browser from making characters.
import type { Detail, Patch, Summary } from './types';

const HEADERS = { 'Content-Type': 'application/json', 'X-Bot-Reborn': '1' };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method, headers: HEADERS, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
  return json as T;
}

const one = (id: string) => `/api/characters/${encodeURIComponent(id)}`;

export const api = {
  list: () => call<Summary[]>('GET', '/api/characters'),
  create: (name: string) => call<Detail>('POST', '/api/characters', { name }),
  get: (id: string) => call<Detail>('GET', one(id)),
  patch: (id: string, patch: Patch) => call<Detail>('PATCH', one(id), patch),
  token: (id: string) => call<{ token: string }>('POST', `${one(id)}/token`),
  remove: (id: string) => call<object>('DELETE', one(id)),
  lan: () => call<{ port: number; addresses: string[] }>('GET', '/api/lan'),
  /** The raw response: a TTS check answers with audio, not JSON. */
  check: async (layer: string, body: unknown): Promise<Response> => {
    const res = await fetch(`/api/check/${layer}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    return res;
  },
};
