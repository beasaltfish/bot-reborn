// Bytes on the wire, samples in the engines. Every audio frame between brain
// and body is 16-bit little-endian PCM (server/body split spec §3); the VAD,
// the spotter and the level meter all want Float32 in [-1, 1].

/**
 * An odd trailing byte is dropped: half a sample cannot be read, and carrying
 * it over to the next frame would only matter for a body that splits samples
 * across frames, which no body does.
 * @param {Uint8Array} bytes
 * @returns {Float32Array}
 */
export function bytesToFloat32(bytes) {
  const n = Math.floor(bytes.byteLength / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

/** @param {Int16Array} pcm @returns {Uint8Array} */
export function int16ToBytes(pcm) {
  const out = new Uint8Array(pcm.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < pcm.length; i++) view.setInt16(i * 2, pcm[i], true);
  return out;
}

/** @param {Uint8Array} bytes @param {number} at @param {number} n */
const ascii = (bytes, at, n) => String.fromCharCode(...bytes.subarray(at, at + n));

/** @param {Uint8Array} bytes */
export function isWav(bytes) {
  return bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE';
}

/**
 * Enough of RIFF to read what a TTS endpoint sends back: 16-bit integer or
 * 32-bit float, any channel count (averaged to mono), any rate.
 * @param {Uint8Array} bytes
 * @returns {{ rate: number, samples: Float32Array }}
 */
export function parseWav(bytes) {
  if (!isWav(bytes)) throw new Error('not a WAV file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  /** @type {{ format: number, channels: number, rate: number, bits: number } | null} */
  let fmt = null;
  let off = 12;
  while (off + 8 <= bytes.length) {
    const id = ascii(bytes, off, 4);
    let size = view.getUint32(off + 4, true);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        rate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    }
    if (id === 'data') {
      if (!fmt) throw new Error('WAV has no fmt chunk before its data');
      // A streamed WAV does not know its own length when the header goes out:
      // OpenAI writes 0xFFFFFFFF there. Whatever arrived is the data.
      if (size === 0xFFFFFFFF || size === 0 || body + size > bytes.length) size = bytes.length - body;
      return { rate: fmt.rate, samples: decode(view, body, size, fmt) };
    }
    off = body + size + (size & 1);
  }
  throw new Error('WAV has no data chunk');
}

/**
 * @param {DataView} view @param {number} at @param {number} size
 * @param {{ format: number, channels: number, bits: number }} fmt
 */
function decode(view, at, size, fmt) {
  const float = fmt.format === 3 && fmt.bits === 32;
  if (!float && fmt.bits !== 16) throw new Error(`unsupported WAV: format ${fmt.format}, ${fmt.bits} bits`);
  const width = fmt.bits / 8;
  const frames = Math.floor(size / (width * fmt.channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) {
      const p = at + (i * fmt.channels + c) * width;
      sum += float ? view.getFloat32(p, true) : view.getInt16(p, true) / 32768;
    }
    out[i] = sum / fmt.channels;
  }
  return out;
}

/**
 * Linear interpolation, no low-pass. Good enough for a voice going DOWN to
 * 16 kHz — the aliasing it lets through sits above what the robot's speaker
 * reproduces — and not meant for anything else.
 * @param {Float32Array} samples @param {number} from @param {number} to
 */
export function resample(samples, from, to) {
  if (from === to) return samples;
  const n = Math.floor((samples.length * to) / from);
  const out = new Float32Array(n);
  const step = from / to;
  for (let i = 0; i < n; i++) {
    const x = i * step;
    const j = Math.floor(x);
    const a = samples[j];
    const b = samples[Math.min(j + 1, samples.length - 1)];
    out[i] = a + (b - a) * (x - j);
  }
  return out;
}
