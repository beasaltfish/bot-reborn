// The wire between the brain (the server on a computer) and a body (a phone
// today, an ESP32 next). Server/body split spec §3.
//
// Written for the ESP32 first: one WebSocket, binary frames are raw PCM and
// nothing else, text frames are small flat JSON objects. Anything a
// microcontroller would have to negotiate, buffer or decode is fixed here
// instead.

/**
 * 2 since 2026-10-17: a body no longer says what it has (caps) or reports its
 * motors — how a character moves is its config's to say (body motion spec §4).
 */
export const PROTOCOL = 2;

/** 16-bit little-endian mono, both directions. Not negotiated. */
export const RATE = 16000;

/**
 * What the session cuts a body's audio into. Its thresholds were measured on
 * 100 ms frames, and the phone's capture worklet cuts the same.
 */
export const FRAME_MS = 100;

export const BODY_PATH = '/body';

/**
 * Where a body with a screen gets its frames (pet screen spec §5). A second
 * socket, not a second frame type: a body that does not have a screen never
 * opens it, so it can never mistake a JPEG for PCM.
 */
export const SCREEN_PATH = '/screen';

/** Both sides ping this often; any frame at all counts as being alive. */
export const HEARTBEAT_MS = 300;

/** A body that has heard nothing for this long stops the car by itself. */
export const WATCHDOG_MS = 1000;

/**
 * A `move` REPLACES the one in progress; it never queues behind it. The brain
 * renews a cruise LEAD_MS before the current order runs out, sending only
 * what is left from now, so a body that queued would drive an extra LEAD_MS
 * per renewal and keep going after the renewals stop.
 *
 * The longest single `move`. A body only ever drives on a bounded order, so
 * a brain that dies mid-cruise costs at most this much travel — the same
 * bound executor.js's renewal loop gives the phone (MAX_COAST_MS).
 */
export const MAX_MOVE_MS = 1000;

export const DRIVES = /** @type {const} */ (['forward', 'backward']);
export const STEERS = /** @type {const} */ (['left', 'right', 'straight']);

/** @param {object} msg */
export function encode(msg) { return JSON.stringify(msg); }

/** @type {Record<string, (m: any) => boolean>} */
const FROM_BODY = {
  // `token` is checked by the link, not here: a hello dropped at parse time
  // gets no answer at all, and a body missing its token should be told so.
  hello: (m) => Number.isInteger(m.protocol),
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
