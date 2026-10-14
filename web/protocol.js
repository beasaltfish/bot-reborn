// The wire between the brain (the server on a computer) and a body (a phone
// today, an ESP32 next). Server/body split spec §3.
//
// Written for the ESP32 first: one WebSocket, binary frames are raw PCM and
// nothing else, text frames are small flat JSON objects. Anything a
// microcontroller would have to negotiate, buffer or decode is fixed here
// instead.

export const PROTOCOL = 1;

/** 16-bit little-endian mono, both directions. Not negotiated. */
export const RATE = 16000;

export const BODY_PATH = '/body';

/** Both sides ping this often; any frame at all counts as being alive. */
export const HEARTBEAT_MS = 300;

/** A body that has heard nothing for this long stops the car by itself. */
export const WATCHDOG_MS = 1000;

/**
 * The longest single `move`. A body only ever drives on a bounded order, so
 * a brain that dies mid-cruise costs at most this much travel — the same
 * bound executor.js's renewal loop gives the phone (MAX_COAST_MS).
 */
export const MAX_MOVE_MS = 1000;

export const DRIVES = /** @type {const} */ (['forward', 'backward']);
export const STEERS = /** @type {const} */ (['left', 'right', 'straight']);

/** @param {object} msg */
export function encode(msg) { return JSON.stringify(msg); }

const isBool = (/** @type {unknown} */ v) => typeof v === 'boolean';

/** @type {Record<string, (m: any) => boolean>} */
const FROM_BODY = {
  hello: (m) => Number.isInteger(m.protocol) && typeof m.caps === 'object' && m.caps !== null,
  motors: (m) => isBool(m.connected),
  ping: () => true,
  pong: () => true,
};

/** @type {Record<string, (m: any) => boolean>} */
const FROM_BRAIN = {
  welcome: () => true,
  reject: (m) => typeof m.reason === 'string',
  move: (m) => DRIVES.includes(m.drive) && STEERS.includes(m.steer)
    && Number.isInteger(m.ms) && m.ms >= 1 && m.ms <= MAX_MOVE_MS,
  stop: () => true,
  hush: () => true,
  state: (m) => typeof m.state === 'string',
  ping: () => true,
  pong: () => true,
};

/**
 * Null for anything that is not a well-formed message from that side. Never
 * throws: a body that sends garbage is ignored, not a crash.
 *
 * @param {string} text
 * @param {'body' | 'brain'} from who sent it
 * @returns {any}
 */
export function parse(text, from) {
  let msg;
  try { msg = JSON.parse(text); } catch { return null; }
  if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return null;
  const check = (from === 'body' ? FROM_BODY : FROM_BRAIN)[msg.type];
  return check && check(msg) ? msg : null;
}
