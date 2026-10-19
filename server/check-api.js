// The admin page's Test buttons (Volcengine voice spec §3). The page sends the
// layer as it is on screen — not as saved, which can lag the autosave — and
// the brain makes the request with the adapters the robot itself would build
// (pick.js), so a pass means the robot's path works, not some other one.
//
// TTS answers with the audio for the page to play: no body has to be online.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MATERIAL, checkLlm, checkReflex, checkStt } from '../core/checks.js';
import { toInt16 } from '../core/audio/pcm.js';
import { encodeWav } from '../core/providers/stt-openai-compat.js';
import { OpenAiCompatLlm } from '../core/providers/llm-openai-compat.js';
import { Reflex } from '../core/reflex.js';
import { TOOLS, buildSystemPrompt } from '../core/brain.js';
import { parseWav } from './audio/pcm.js';
import { FIXTURES_DIR } from './static.js';
import { makeStt, makeTtsSource } from './providers/pick.js';

/** Spec §6.7's net, the same one every provider gets at runtime. */
const TIMEOUT_MS = 15_000;

export const LAYERS = /** @type {const} */ (['stt', 'llm', 'reflex', 'tts']);

/**
 * @param {{ fetch?: typeof fetch, fixtures?: string, timeoutMs?: number }} [opts]
 */
export function createCheckApi(opts = {}) {
  const net = opts.fetch ? { fetch: opts.fetch } : {};
  const fixtures = opts.fixtures ?? FIXTURES_DIR;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;

  /**
   * @param {import('node:http').ServerResponse} res
   * @param {string} layer one of LAYERS; the caller has checked
   * @param {any} body `{ config, lang, heard?, robotSaid? }`
   */
  return async function check(res, layer, body) {
    const config = body?.config ?? {};
    const lang = body?.lang === 'en' ? 'en' : 'zh';
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      if (layer === 'tts') {
        const audio = await makeTtsSource(config, net).synthesize(MATERIAL[lang].line, { signal });
        res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' });
        return void res.end(Buffer.from(encodeWav(toInt16(audio.samples), audio.rate)));
      }
      /** @type {string} */ let text;
      if (layer === 'stt') {
        const wav = parseWav(readFileSync(join(fixtures, MATERIAL[lang].clip.replace(/^fixtures\//, ''))));
        const stt = makeStt(config, net);
        text = await checkStt({ transcribe: (pcm, rate) => stt.transcribe(pcm, rate, { signal }) },
          toInt16(wav.samples), wav.rate);
      } else if (layer === 'llm') {
        text = await checkLlm(new OpenAiCompatLlm(config, { ...net, timeoutMs }), {
          tools: TOOLS, systemPrompt: buildSystemPrompt({ replyLang: null, bargeIn: true }),
        });
      } else {
        text = await checkReflex(new Reflex(config, net), String(body?.heard ?? 'hello'), String(body?.robotSaid ?? ''));
      }
      send(res, 200, { text });
    } catch (err) {
      const e = /** @type {Error} */ (err);
      // A timeout's own message is "The operation was aborted", which says
      // nothing about which wait ran out.
      const message = signal.aborted ? `no answer within ${timeoutMs / 1000} s` : e.message;
      send(res, 502, { error: message || String(e) });
    }
  };
}

/** @param {import('node:http').ServerResponse} res @param {number} status @param {unknown} body */
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
