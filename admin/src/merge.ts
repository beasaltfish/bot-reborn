// The page's half of the server's deepMerge (server/characters.js): patches
// pile up while someone is typing and go out as one.
const BLOCKED = new Set(['__proto__', 'constructor', 'prototype']);

export const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlain(patch)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    if (BLOCKED.has(k)) continue;
    out[k] = isPlain(v) && isPlain(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}
