// Int16 PCM → a .wav file, so a recording can be stored as what it already is:
// the response to `fixtures/zh.wav` (spec §9.2's "要存的形状和它的原生形状一样").
//
// Nothing here compresses or resamples. The 44-byte canonical header is the
// whole job, and it is worth its own module only because getting one of its
// six little-endian fields wrong produces audio that decodes without an error
// and sounds wrong — the failure mode §9.3 exists to prevent.

const HEADER_BYTES = 44;

/** @param {DataView} view @param {number} off @param {string} s */
function putAscii(view, off, s) {
  for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
}

/**
 * @param {Int16Array} pcm mono samples
 * @param {number} sampleRate whatever the capture actually ran at — the
 *   worklet targets 16 kHz but the browser is allowed to hand back another
 *   rate, and a header that lies about it transposes the clip.
 * @returns {ArrayBuffer}
 */
export function encodeWav(pcm, sampleRate) {
  const dataBytes = pcm.length * 2;
  const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);

  putAscii(view, 0, 'RIFF');
  // Everything after this field and the four bytes before it — NOT the file
  // length. decodeAudioData trusts this number instead of checking it.
  view.setUint32(4, HEADER_BYTES - 8 + dataBytes, true);
  putAscii(view, 8, 'WAVE');

  putAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);          // fmt chunk length
  view.setUint16(20, 1, true);           // 1 = uncompressed PCM
  view.setUint16(22, 1, true);           // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byteRate
  view.setUint16(32, 2, true);           // blockAlign
  view.setUint16(34, 16, true);          // bitsPerSample

  putAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);
  new Int16Array(buffer, HEADER_BYTES).set(pcm);

  return buffer;
}
