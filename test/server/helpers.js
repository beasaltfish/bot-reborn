// Shared by the robot and end-to-end tests: a config with every layer
// filled, and a fetch that plays all three providers.

import { defaultConfig } from '../../web/config.js';
import { encodeWav } from '../../web/providers/stt-openai-compat.js';

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

export async function until(/** @type {() => boolean} */ pred, ms = 3000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
}
