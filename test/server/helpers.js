// Shared by the robot and end-to-end tests: a config with every layer
// filled, and a fetch that plays all three providers.

import { defaultConfig } from '../../core/config.js';
import { encodeWav } from '../../core/providers/stt-openai-compat.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCharacter, saveCharacter, listCharacters } from '../../server/characters.js';

export function readyConfig() {
  const cfg = defaultConfig('en');
  cfg.stt = { baseURL: 'http://stt', apiKey: 'k', model: 'm', prompt: '' };
  cfg.llm = { baseURL: 'http://llm', apiKey: 'k', model: 'm' };
  cfg.tts = { baseURL: 'http://tts', apiKey: 'k', model: 'm', voice: 'v' };
  return cfg;
}

/**
 * @param {{ heard?: string, reply?: string, steps?: object[], llmHangs?: boolean }} [opts]
 * @returns {typeof fetch & { calls: { url: string, body: any, signal?: AbortSignal | null }[] }}
 */
export function fakeFetch(opts = {}) {
  /** @type {{ url: string, body: any, signal?: AbortSignal | null }[]} */ const calls = [];
  const f = /** @type {any} */ (async (/** @type {string} */ url, /** @type {RequestInit} */ init) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url, body, signal: init?.signal });
    if (url.endsWith('/audio/transcriptions')) {
      return Response.json({ text: opts.heard ?? 'go forward a bit', segments: [] });
    }
    if (url.endsWith('/chat/completions')) {
      if (opts.llmHangs) {
        return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
      }
      return Response.json({ choices: [{ message: {
        role: 'assistant',
        content: opts.reply ?? 'Going!',
        tool_calls: [{ id: 'c1', type: 'function', function: {
          name: 'move',
          arguments: JSON.stringify({ steps: opts.steps ?? [{ drive: 'forward', steer: 'straight', duration_ms: 600 }] }),
        } }],
      } }] });
    }
    if (url.endsWith('/audio/speech')) {
      return new Response(encodeWav(new Int16Array(3200).fill(2000), 16000));
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  f.calls = calls;
  return f;
}

/**
 * @param {() => boolean} pred
 * @param {number} [ms]
 * @param {() => string} [why] what to report on timeout. robot.test has timed
 *   out here about once in twenty full-suite runs without a reproduction;
 *   the next one should say where it was stuck.
 */
export async function until(pred, ms = 3000, why) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timed out waiting${why ? ` — ${why()}` : ''}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** A characters directory of its own, filled with ready-to-run characters. */
export function tempCharacters() {
  const dir = join(mkdtempSync(join(tmpdir(), 'chars-')), 'characters');
  return {
    dir,
    /** @param {string} name @param {(cfg: any) => void} [edit] */
    add(name, edit = () => {}) {
      const c = createCharacter(name, dir);
      c.config = readyConfig();
      edit(c.config);
      saveCharacter(c);
      return c;
    },
    list: () => listCharacters(dir).characters,
  };
}