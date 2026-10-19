// Volcengine's binary frames for 一句话识别 (sauc). The layout is copied from
// Volcengine's own demo (sauc_python/protocol.py, from the doc page,
// 2026-10-19); the doc page itself does not describe it.
//
// Every frame is a 4-byte header, then fields its flags announce, then a size
// and a payload:
//   byte 0  version (1) << 4 | header length in 4-byte words
//   byte 1  message type << 4 | flags
//   byte 2  serialization << 4 | compression
//   byte 3  reserved

import { gunzipSync, gzipSync } from 'node:zlib';

const FULL_REQUEST = 0b0001;
const AUDIO_ONLY = 0b0010;
const FULL_RESPONSE = 0b1001;
const ERROR = 0b1111;

/** A sequence number follows the header. */
const HAS_SEQUENCE = 0b0001;
/** The last packet of the exchange. */
const LAST = 0b0010;
/** An event number follows the header (after the sequence). */
const HAS_EVENT = 0b0100;

const JSON_SERIAL = 0b0001;
const GZIP = 0b0001;

/**
 * @param {number} type @param {number} flags @param {number} serial
 * @param {number} seq @param {Buffer} payload uncompressed
 * @returns {Buffer}
 */
function clientFrame(type, flags, serial, seq, payload) {
  const body = gzipSync(payload);
  const head = Buffer.alloc(12);
  head[0] = 0x11;
  head[1] = (type << 4) | flags;
  head[2] = (serial << 4) | GZIP;
  head.writeInt32BE(seq, 4);
  head.writeUInt32BE(body.length, 8);
  return Buffer.concat([head, body]);
}

/**
 * The opening frame: what the audio is and how to recognise it. Always seq 1.
 * @param {object} payload
 * @returns {Buffer}
 */
export function fullRequest(payload) {
  return clientFrame(FULL_REQUEST, HAS_SEQUENCE, JSON_SERIAL, 1, Buffer.from(JSON.stringify(payload)));
}

/**
 * One piece of raw PCM. The last one says so twice — a flag and a negated
 * sequence — which is how the server knows the sentence is over.
 * @param {number} seq positive
 * @param {Buffer} pcm
 * @param {boolean} last
 * @returns {Buffer}
 */
export function audioFrame(seq, pcm, last) {
  return clientFrame(AUDIO_ONLY, last ? HAS_SEQUENCE | LAST : HAS_SEQUENCE, 0, last ? -seq : seq, pcm);
}

/**
 * @param {Buffer} buf
 * @returns {{ type: 'response' | 'error', last: boolean, sequence: number | null, code: number | null, payload: any }}
 */
export function parseServerFrame(buf) {
  const type = buf[1] >> 4;
  const flags = buf[1] & 0x0f;
  const serial = buf[2] >> 4;
  const compression = buf[2] & 0x0f;
  let at = (buf[0] & 0x0f) * 4;

  /** @type {number | null} */ let sequence = null;
  if (flags & HAS_SEQUENCE) { sequence = buf.readInt32BE(at); at += 4; }
  if (flags & HAS_EVENT) at += 4;

  /** @type {number | null} */ let code = null;
  if (type === ERROR) { code = buf.readInt32BE(at); at += 4; }
  else if (type !== FULL_RESPONSE) throw new Error(`Volcengine STT sent an unknown frame type ${type}`);
  const size = buf.readUInt32BE(at);
  at += 4;

  let body = buf.subarray(at, at + size);
  if (body.length && compression === GZIP) body = gunzipSync(body);
  /** @type {any} */ let payload = null;
  if (body.length) {
    const text = body.toString('utf8');
    // An error's message is sometimes plain text despite the JSON flag.
    try { payload = serial === JSON_SERIAL ? JSON.parse(text) : text; } catch { payload = text; }
  }
  return { type: type === ERROR ? 'error' : 'response', last: Boolean(flags & LAST), sequence, code, payload };
}
