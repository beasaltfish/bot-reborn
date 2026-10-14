// The wake word, the stop word and the VAD, in Node. Same model, same
// keyword lines and the same thresholds as web/audio/kws.js and vad.js; only
// the binding differs — a native addon taking ONNX files, where the phone had
// a wasm bundle with the files packed inside.

import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VAD_WINDOW } from '../../web/audio/vad.js';
import { parseTokens, unknownTokens } from '../../web/audio/keyword-lines.js';
import { RATE } from '../../web/protocol.js';

export const MODEL_DIR = fileURLToPath(new URL('../models/', import.meta.url));
const KEYWORD_DIR = fileURLToPath(new URL('../../web/keywords/', import.meta.url));

const FILES = {
  encoder: 'encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx',
  decoder: 'decoder-epoch-13-avg-2-chunk-16-left-64.onnx',
  joiner: 'joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx',
  tokens: 'tokens.txt',
  vad: 'silero_vad.onnx',
};

export function modelsPresent(dir = MODEL_DIR) {
  return Object.values(FILES).every((f) => existsSync(join(dir, f)));
}

/** CommonJS, and a native addon: loaded on demand so importing this file costs nothing. */
export function loadSherpaNode() {
  return createRequire(import.meta.url)('sherpa-onnx-node');
}

/**
 * name.txt + stop.txt, checked against the model's tokens first. An unknown
 * token aborted the whole wasm module on the phone (docs/hardware.md); here
 * it would be a native crash, which is no better.
 */
export function loadKeywords(dir = MODEL_DIR) {
  const lines = ['name.txt', 'stop.txt']
    .map((f) => readFileSync(join(KEYWORD_DIR, f), 'utf8').trim()).join('\n');
  const bad = unknownTokens(lines, parseTokens(readFileSync(join(dir, FILES.tokens), 'utf8')));
  if (bad.length) throw new Error(`keyword lines use tokens this model does not have: ${bad.join(' ')}`);
  return lines;
}

/**
 * @param {any} sherpa
 * @param {string} keywordLines
 * @param {{ threshold?: number, score?: number, dir?: string }} [opts]
 * @returns {{ accept(frame: Float32Array): string[] }}
 */
export function createSpotter(sherpa, keywordLines, opts = {}) {
  const dir = opts.dir ?? MODEL_DIR;
  // The addon takes keywords as a file. A per-process temp file, written once.
  const file = join(mkdtempSync(join(tmpdir(), 'bot-reborn-kws-')), 'keywords.txt');
  writeFileSync(file, keywordLines + '\n');
  const kws = new sherpa.KeywordSpotter({
    featConfig: { sampleRate: RATE, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(dir, FILES.encoder),
        decoder: join(dir, FILES.decoder),
        joiner: join(dir, FILES.joiner),
      },
      tokens: join(dir, FILES.tokens),
      provider: 'cpu', numThreads: 1, debug: 0,
    },
    maxActivePaths: 4,
    numTrailingBlanks: 1,
    keywordsScore: opts.score ?? 1.0,
    keywordsThreshold: opts.threshold ?? 0.25,
    keywordsFile: file,
  });
  const stream = kws.createStream();
  return {
    accept(frame) {
      stream.acceptWaveform({ sampleRate: RATE, samples: frame });
      /** @type {string[]} */ const hits = [];
      while (kws.isReady(stream)) {
        kws.decode(stream);
        hits.push(kws.getResult(stream).keyword);
      }
      const found = hits.filter(Boolean);
      // Same as the web spotter: without a reset one utterance fires forever.
      found.forEach(() => kws.reset(stream));
      return found;
    },
  };
}

/**
 * @param {any} sherpa
 * @param {{ threshold?: number, minSilence?: number, minSpeech?: number,
 *           bufferSeconds?: number, dir?: string }} [opts]
 */
export function createVoiceDetector(sherpa, opts = {}) {
  const vad = new sherpa.Vad({
    sileroVad: {
      model: join(opts.dir ?? MODEL_DIR, FILES.vad),
      threshold: opts.threshold ?? 0.5,
      minSilenceDuration: opts.minSilence ?? 0.8,
      minSpeechDuration: opts.minSpeech ?? 0.25,
      maxSpeechDuration: 20,
      windowSize: VAD_WINDOW,
    },
    sampleRate: RATE, numThreads: 1, provider: 'cpu', debug: 0,
  }, opts.bufferSeconds ?? 30);

  let pending = new Float32Array(0);

  return {
    /** @param {Float32Array} frame */
    accept(frame) {
      const merged = new Float32Array(pending.length + frame.length);
      merged.set(pending);
      merged.set(frame, pending.length);
      let off = 0;
      for (; off + VAD_WINDOW <= merged.length; off += VAD_WINDOW) {
        vad.acceptWaveform(merged.subarray(off, off + VAD_WINDOW));
      }
      pending = merged.slice(off);
    },

    get detected() { return Boolean(vad.isDetected()); },

    drain() {
      /** @type {Float32Array[]} */ const out = [];
      while (!vad.isEmpty()) {
        // false = copy out. The default hands back a view into the engine's
        // own buffer, which the next acceptWaveform is free to overwrite —
        // and the session holds this segment across an STT round trip.
        out.push(Float32Array.from(vad.front(false).samples));
        vad.pop();
      }
      return out;
    },

    clear() {
      pending = new Float32Array(0);
      vad.clear();
      vad.reset();
    },
  };
}
