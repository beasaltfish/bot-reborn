// The keyword spotter, reduced to "frames in, labels out". Which label means
// what — and what to do about it — is session.js's business (§10).

const RATE = 16000;

/**
 * @param {{ Module: any, createKws: Function }} sherpa
 * @param {string} keywordLines validated by keyword-lines.js FIRST — an unknown
 *   token aborts the whole wasm module (docs/hardware.md).
 * @returns {{ accept(frame: Float32Array): string[] }}
 */
export function createSpotter(sherpa, keywordLines) {
  // createKws()'s own defaults name encoder-epoch-12 (fp32), and this bundle
  // contains epoch-13 int8 and nothing else, so the config is never optional.
  const kws = sherpa.createKws(sherpa.Module, {
    featConfig: { samplingRate: RATE, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: './encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx',
        decoder: './decoder-epoch-13-avg-2-chunk-16-left-64.onnx',
        joiner: './joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx',
      },
      tokens: './tokens.txt',
      provider: 'cpu', numThreads: 1, debug: 0,
    },
    maxActivePaths: 4, numTrailingBlanks: 1,
    // The conservative global default belongs to the wake word; the stop word
    // overrides it per line with `#0.15`, so §5.5's asymmetry lives in the
    // keyword file rather than here.
    keywordsScore: 1.0, keywordsThreshold: 0.25,
    keywords: keywordLines,
  });
  const stream = kws.createStream();

  return {
    /** @param {Float32Array} frame @returns {string[]} labels hit, usually empty */
    accept(frame) {
      stream.acceptWaveform(RATE, frame);
      /** @type {string[]} */
      const hits = [];
      while (kws.isReady(stream)) {
        kws.decode(stream);
        hits.push(kws.getResult(stream).keyword);
      }
      const found = hits.filter(Boolean);
      // Reset after a hit, or the same keyword keeps re-reporting.
      found.forEach(() => kws.reset(stream));
      return found;
    },
  };
}
