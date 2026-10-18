// Provider endpoints: one entry per service a character talks to, holding the
// key for it. A preset's entry is keyed by the preset's id, so its address is
// fixed and typing never changes which key it has. A custom entry is made by
// the user, with its own id, name, address and key.
//
// A layer still stores baseURL and apiKey, copied from its entry, so the body
// reads exactly what it always read. `endpointId` on a layer says which entry
// those came from.
//
// Before this file, a character kept `keys: { address: key }` beside its config.
// endpointsFrom() turns that into entries when the file has none yet.

import { randomBytes } from 'node:crypto';
import { PRESETS, presetIdFor } from '../core/provider-presets.js';

export const LAYERS = /** @type {const} */ (['stt', 'llm', 'tts', 'reflex']);
export const MAX_CUSTOM = 50;

const isPlain = (/** @type {unknown} */ v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The address as the table spells it: no trailing slash. @param {unknown} u */
export const addressOf = (u) => String(u ?? '').trim().replace(/\/+$/, '');

const hostOf = (/** @type {string} */ a) => {
  try { return new URL(a).host; } catch { return a; }
};

/** @returns {string} */
export const newCustomId = () => `ep-${randomBytes(4).toString('hex')}`;

/**
 * The preset whose address this is, by id, or null.
 * @param {'stt' | 'llm' | 'tts' | 'reflex'} layer @param {string} address
 */
function presetAt(layer, address) {
  const id = presetIdFor(layer, { baseURL: address });
  if (id === 'custom') return null;
  return PRESETS[layer].find((p) => p.id === id) ?? null;
}

/**
 * Which entry a layer's address belongs to, by id if it has one. A preset
 * address maps to its preset entry; any other address to a custom entry.
 * @param {'stt' | 'llm' | 'tts' | 'reflex'} layer @param {string} baseURL @param {Endpoint[]} endpoints
 * @returns {string} the entry id, or ''
 */
export function endpointIdFor(layer, baseURL, endpoints) {
  const a = addressOf(baseURL);
  if (!a) return '';
  const preset = presetAt(layer, a);
  if (preset && endpoints.some((e) => e.id === preset.id)) return preset.id;
  return endpoints.find((e) => e.custom && addressOf(e.baseURL) === a)?.id ?? '';
}

/**
 * @typedef {{ id: string, name: string, baseURL: string, apiKey: string, custom?: true }} Endpoint
 */

/**
 * The config with each layer's endpointId filled in where the layer's address
 * matches an entry. A layer already holding an id keeps it.
 * @param {any} config @param {Endpoint[]} endpoints
 */
export function withEndpointIds(config, endpoints) {
  const out = { ...config };
  for (const layer of LAYERS) {
    const l = config?.[layer];
    if (!isPlain(l) || l.endpointId) continue;
    const id = endpointIdFor(layer, l.baseURL, endpoints);
    if (id) out[layer] = { ...l, endpointId: id };
  }
  return out;
}

/**
 * The entries a character with no `endpoints` list is given: one per preset or
 * custom address its layers use, and one per address the old key table holds.
 * The key on an entry is the layer's own key, or else the table's for that
 * address; the first one found wins when two layers disagree.
 * @param {any} config @param {Record<string, string>} keys the old key table
 * @returns {Endpoint[]}
 */
export function endpointsFrom(config, keys = {}) {
  /** @type {Record<string, string>} */ const table = {};
  for (const [a, k] of Object.entries(keys)) {
    const norm = addressOf(a);
    if (norm && typeof k === 'string' && k && !table[norm]) table[norm] = k;
  }
  /** @type {Endpoint[]} */ const out = [];
  const find = (/** @type {string} */ a) => out.find((e) => addressOf(e.baseURL) === a);
  const keep = (/** @type {Endpoint} */ e, /** @type {string} */ key) => { if (!e.apiKey && key) e.apiKey = key; };

  for (const layer of LAYERS) {
    const l = config?.[layer];
    const a = addressOf(l?.baseURL);
    if (!a) continue;
    const key = (typeof l.apiKey === 'string' ? l.apiKey : '') || table[a] || '';
    const preset = presetAt(layer, a);
    if (preset) {
      let e = out.find((x) => x.id === preset.id);
      if (!e) out.push((e = { id: preset.id, name: preset.label, baseURL: preset.baseURL, apiKey: '' }));
      keep(e, key);
    } else {
      let e = find(a);
      if (!e) out.push((e = { id: newCustomId(), name: hostOf(a), baseURL: a, apiKey: '', custom: true }));
      keep(e, key);
    }
  }
  // Addresses the table has but no layer uses now.
  for (const [a, k] of Object.entries(table)) {
    if (out.some((e) => addressOf(e.baseURL) === a)) continue;
    const preset = PRESETS.stt.concat(PRESETS.llm, PRESETS.tts, PRESETS.reflex).find((p) => addressOf(p.baseURL) === a);
    if (preset) {
      if (!out.some((e) => e.id === preset.id)) out.push({ id: preset.id, name: preset.label, baseURL: preset.baseURL, apiKey: k });
    } else {
      out.push({ id: newCustomId(), name: hostOf(a), baseURL: a, apiKey: k, custom: true });
    }
  }
  return out;
}

/**
 * Entries as stored. Anything malformed is dropped rather than failing the
 * whole character: a bad entry must not stop the others from being used.
 * @param {unknown} v @returns {Endpoint[]}
 */
export function storedEndpoints(v) {
  if (!Array.isArray(v)) return [];
  /** @type {Endpoint[]} */ const out = [];
  for (const e of v) {
    if (!isPlain(e)) continue;
    const x = /** @type {Record<string, unknown>} */ (e);
    if (typeof x.id !== 'string' || typeof x.name !== 'string' || typeof x.baseURL !== 'string' || typeof x.apiKey !== 'string') continue;
    out.push({ id: x.id, name: x.name, baseURL: x.baseURL, apiKey: x.apiKey, ...(x.custom === true ? { custom: true } : {}) });
  }
  return out;
}

/**
 * Checked before it is written. Strings are short, ids are unique, and a
 * character has at most MAX_CUSTOM custom entries.
 * @param {unknown} list @returns {Endpoint[]}
 */
export function checkEndpoints(list) {
  if (!Array.isArray(list)) throw new Error('endpoints must be a list');
  const ids = new Set();
  let custom = 0;
  for (const e of list) {
    if (!isPlain(e)) throw new Error('each endpoint must be an object');
    const x = /** @type {Record<string, unknown>} */ (e);
    if (typeof x.id !== 'string' || !x.id || x.id.length > 60) throw new Error('endpoint id must be a short string');
    if (typeof x.name !== 'string' || x.name.length > 60) throw new Error('endpoint name must be a string of at most 60 characters');
    if (typeof x.baseURL !== 'string' || x.baseURL.length > 300) throw new Error('endpoint address must be a string of at most 300 characters');
    if (typeof x.apiKey !== 'string' || x.apiKey.length > 500) throw new Error('endpoint key must be a string of at most 500 characters');
    if (ids.has(x.id)) throw new Error(`endpoint id ${x.id} is listed twice`);
    ids.add(x.id);
    if (x.custom === true) custom++;
  }
  if (custom > MAX_CUSTOM) throw new Error(`at most ${MAX_CUSTOM} custom providers`);
  return /** @type {Endpoint[]} */ (storedEndpoints(list));
}
