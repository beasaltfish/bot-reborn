// STT over Volcengine's 一句话识别 (豆包语音), whole-sentence mode
// (`bigmodel_nostream`). The same interface as OpenAiCompatStt, so session.js
// cannot tell which one it holds.
//
// Not the flash recording recogniser any more: Volcengine moved that page to
// 历史文档, and it only ever ran the 1.0 model. This one runs 2.0.
//
// A WebSocket per sentence, in Volcengine's binary frames (volc-frames.js):
// one request saying what the audio is, the PCM in pieces with the last one
// flagged, then a single final result. Lives in server/, not core/, because
// `ws` is Node only.
//
// Every way the exchange can end without a result — refused upgrade, error
// frame, early close — is an error, never an empty transcript: '' means
// silence, and reading a failure as silence turns a broken key into the robot
// going "huh?" with nothing in the log.

import WebSocket from 'ws';
import { audioFrame, fullRequest, parseServerFrame } from './volc-frames.js';

const PATH = '/api/v3/sauc/bigmodel_nostream';

/** 2.0 hourly: what a layer saved before the switch still asks for. */
const DEFAULT_MODEL = 'volc.seedasr.sauc.duration';
/** The flash recogniser's resource id, still in characters saved before. */
const RETIRED = 'volc.bigasr.auc_turbo';

/** Spec §6.7: the same 15 s net as every other provider. */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * The part of `ws`'s WebSocket this adapter uses, so tests can stand in.
 * @typedef {{
 *   on(event: string, fn: (...args: any[]) => void): unknown,
 *   send(data: Buffer): void,
 *   close(): void,
 *   terminate(): void,
 * }} WebSocketLike
 * @typedef {(url: string, headers: Record<string, string>) => WebSocketLike} Connect
 */

/** @type {Connect} */
const wsConnect = (url, headers) => new WebSocket(url, { headers });

/** @param {string} baseURL */
function socketURL(baseURL) {
  return `${baseURL.replace(/\/+$/, '').replace(/^http(s?):/, 'ws$1:')}${PATH}`;
}

export class VolcengineStt {
  #cfg; #connect; #timeoutMs;

  /**
   * `prompt` is accepted and not sent. The request's `context` is where it
   * would go; sending the robot's last reply there instead is a later project.
   * @param {{ baseURL: string, apiKey: string, model: string, prompt?: string }} cfg
   * @param {{ connect?: Connect, timeoutMs?: number }} [opts]
   */
  constructor(cfg, opts = {}) {
    this.#cfg = cfg;
    this.#connect = opts.connect ?? wsConnect;
    this.#timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * @param {Int16Array} pcm
   * @param {number} sampleRate
   * @param {{ signal?: AbortSignal }} [opts]
   * @returns {Promise<string>}
   */
  async transcribe(pcm, sampleRate, opts = {}) {
    return (await this.transcribeDetailed(pcm, sampleRate, opts)).text;
  }

  /**
   * No confidence numbers come back, so both are null — "the endpoint did not
   * say", which session.js already lets through.
   * @param {Int16Array} pcm
   * @param {number} sampleRate
   * @param {{ signal?: AbortSignal }} [opts]
   * @returns {Promise<{ text: string, noSpeech: null, logprob: null, parts: number }>}
   */
  transcribeDetailed(pcm, sampleRate, opts = {}) {
    // Before any socket: one opened and ended before its listeners are on
    // emits an error nobody catches, and that takes the whole brain down.
    if (opts.signal?.aborted) return Promise.reject(opts.signal.reason ?? new Error('aborted'));
    const model = !this.#cfg.model || this.#cfg.model === RETIRED ? DEFAULT_MODEL : this.#cfg.model;
    const socket = this.#connect(socketURL(this.#cfg.baseURL), {
      'X-Api-Key': this.#cfg.apiKey,
      'X-Api-Resource-Id': model,
      'X-Api-Request-Id': crypto.randomUUID(),
    });

    return new Promise((resolve, reject) => {
      let done = false;
      /** @param {() => void} settle @param {boolean} [kill] */
      const finish = (settle, kill = false) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
        if (kill) socket.terminate(); else socket.close();
        settle();
      };
      const fail = (/** @type {unknown} */ err, kill = false) => finish(() => reject(err), kill);

      const timer = setTimeout(() => fail(new Error(`Volcengine STT timed out after ${this.#timeoutMs} ms`), true), this.#timeoutMs);
      const onAbort = () => fail(opts.signal?.reason ?? new Error('aborted'), true);
      opts.signal?.addEventListener('abort', onAbort, { once: true });

      socket.on('open', () => {
        socket.send(fullRequest({
          user: { uid: 'bot-reborn' },
          audio: { format: 'pcm', codec: 'raw', rate: sampleRate, bits: 16, channel: 1 },
          request: { model_name: 'bigmodel', enable_itn: true, enable_punc: true },
        }));
        // Whole-sentence mode: no need to pace the pieces like live speech.
        const bytes = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
        const step = Math.max(2, Math.floor(sampleRate / 5) * 2);
        let seq = 2;
        for (let at = 0; ; at += step, seq++) {
          const last = at + step >= bytes.length;
          socket.send(audioFrame(seq, bytes.subarray(at, at + step), last));
          if (last) break;
        }
      });

      socket.on('message', (/** @type {Buffer} */ data) => {
        let frame;
        try { frame = parseServerFrame(data); } catch (err) { return fail(err); }
        if (frame.type === 'error') {
          const said = typeof frame.payload === 'string' ? frame.payload : frame.payload?.error ?? JSON.stringify(frame.payload);
          return fail(new Error(`Volcengine STT ${frame.code}: ${said || 'no message'}`));
        }
        if (!frame.last) return;
        const text = String(frame.payload?.result?.text ?? '').trim();
        finish(() => resolve({ text, noSpeech: null, logprob: null, parts: 0 }));
      });

      // A refused upgrade: wrong key, or the resource not enabled for it.
      socket.on('unexpected-response', (/** @type {unknown} */ _req, /** @type {any} */ res) => {
        const said = res?.headers?.['x-api-message'] ?? res?.statusMessage ?? '';
        fail(new Error(`Volcengine STT ${res?.statusCode}${said ? `: ${said}` : ''}`), true);
      });
      socket.on('error', (/** @type {Error} */ err) => fail(err, true));
      // The close reason may be the only place Volcengine says why.
      socket.on('close', (/** @type {number} */ code, /** @type {Buffer} */ reason) => {
        const why = [code, String(reason ?? '')].filter(Boolean).join(' ');
        fail(new Error(`Volcengine STT closed before the result${why ? ` (${why})` : ''}`));
      });
    });
  }
}
