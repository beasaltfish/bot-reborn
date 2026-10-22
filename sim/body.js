// The bench as a body: whatever the wiring did to the two audio paths is
// applied to real microphone and speaker audio, and the brain is none the
// wiser — it sees an ordinary phone-style body on /body.
//
// shapeUplink / shapeDownlink / characterChoices are pure and tested;
// startBody touches the browser (microphone, WebSocket, AudioContext) and is
// only exercised on the page.

import { connectBody } from '../phone/body-link.js';
import { AudioPipeline } from '../phone/audio/pipeline.js';
import { PcmPlayer } from '../phone/audio/player.js';
import { toInt16 } from '../core/audio/pcm.js';

/** @typedef {import('./power.js').Outcome} Outcome */

/** @param {Int16Array} out */
function fillNoise(out) {
  // Full scale on purpose: a floating or mis-clocked bus is not a gentle hiss.
  for (let i = 0; i < out.length; i++) out[i] = Math.floor(Math.random() * 65536) - 32768;
  return out;
}

/**
 * What the brain hears from the microphone, given how it is wired.
 * @param {Int16Array} pcm
 * @param {import('./power.js').Path} mic
 * @returns {Int16Array}
 */
export function shapeUplink(pcm, mic) {
  if (mic === 'ok') return pcm;
  if (mic === 'silent') return new Int16Array(pcm.length);
  return fillNoise(new Int16Array(pcm.length));
}

/**
 * What comes out of the speaker; null means nothing is played at all.
 * @param {ArrayBuffer} bytes 16-bit little-endian mono
 * @param {import('./power.js').Path | 'quiet'} amp
 * @returns {ArrayBuffer | null}
 */
export function shapeDownlink(bytes, amp) {
  if (amp === 'ok') return bytes;
  if (amp === 'silent') return null;
  // An odd trailing byte cannot be a sample; Int16Array would throw on it.
  const n = bytes.byteLength >> 1;
  const out = new Int16Array(n);
  if (amp === 'noise') return /** @type {ArrayBuffer} */ (fillNoise(out).buffer);
  const view = new DataView(bytes);
  // Little-endian explicitly, as PcmPlayer reads it, whatever this CPU is.
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) >> 1;
  return /** @type {ArrayBuffer} */ (out.buffer);
}

/**
 * Characters you could plug into, best first: free and set up, then busy,
 * then not set up. A stable sort keeps the brain's order within each group.
 * @param {{ id: string, name: string, ready: boolean, online: boolean }[]} list
 * @returns {{ id: string, name: string, note: string | null }[]}
 */
export function characterChoices(list) {
  /** @param {{ ready: boolean, online: boolean }} c */
  const rank = (c) => (!c.ready ? 2 : c.online ? 1 : 0);
  return [...list]
    .sort((a, b) => rank(a) - rank(b))
    .map((c) => ({
      id: c.id,
      name: c.name,
      note: !c.ready ? 'Not set up — open the admin page' : c.online ? 'In use by another body' : null,
    }));
}

/** @param {Int16Array | ArrayBuffer} samples @returns {number} 0..1 RMS */
function level(samples) {
  const s = samples instanceof Int16Array ? samples : new Int16Array(samples, 0, samples.byteLength >> 1);
  if (!s.length) return 0;
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += s[i] * s[i];
  return Math.sqrt(sum / s.length) / 32768;
}

const REJECTS = {
  token: 'The brain no longer accepts this character’s token — open the admin page and check the character.',
  unconfigured: 'This character is not set up yet — open the admin page and finish its setup.',
  busy: 'Another body is already using this character — pick another character or unplug that body.',
  origin: 'The brain refused this page’s address — open the simulator from the brain’s own address.',
};

/** @param {string} reason */
const rejectMessage = (reason) =>
  /** @type {Record<string, string>} */ (REJECTS)[reason] ?? `The brain turned this body away (${reason}).`;

// The phone never lets go of the microphone (pipeline.js explains why), and
// neither does the bench: unplugging only stops listening. Plugging in again
// reuses the open pipeline unless the character wants the echo canceller the
// other way, which cannot be changed on a live track.
/** @type {{ echo: boolean, pipeline: AudioPipeline } | null} */
let held = null;

/** @param {boolean} echo */
async function pipelineFor(echo) {
  if (held && held.echo === echo) return held.pipeline;
  held?.pipeline.stop();
  held = null;
  const pipeline = await AudioPipeline.start({ echoCancellation: echo });
  held = { echo, pipeline };
  return pipeline;
}

/**
 * @param {{
 *   id: string, outcome: Outcome,
 *   onState(s: string): void, onLevel(up: number, down: number): void,
 *   onEnd(msg: string): void,
 * }} o
 * @returns {Promise<{ stop(): void }>}
 */
export async function startBody(o) {
  let stopped = false;
  /** @type {AudioPipeline | null} */ let pipeline = null;
  /** @type {ReturnType<typeof connectBody> | null} */ let link = null;
  /** @type {PcmPlayer | null} */ let player = null;
  const name = `sim-${o.id}`;
  let up = 0;
  let down = 0;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    link?.close();
    pipeline?.unsubscribe(name);
    player?.hush();
  };
  /** Ends the session for a reason the page should show. */
  const end = (/** @type {string} */ msg) => { if (!stopped) { stop(); o.onEnd(msg); } };

  /** @type {{ token: string, config: { bargeIn: boolean } }} */
  let character;
  try {
    const res = await fetch(`/api/characters/${encodeURIComponent(o.id)}`);
    if (!res.ok) throw new Error(String(res.status));
    character = await res.json();
  } catch {
    end('Could not reach the brain — is it running?');
    return { stop };
  }

  try {
    pipeline = await pipelineFor(Boolean(character.config.bargeIn));
  } catch {
    end('Microphone blocked — allow it in the address bar and plug in again.');
    return { stop };
  }
  if (stopped) return { stop };

  player = new PcmPlayer(pipeline.audioContext);
  link = connectBody({
    url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/body`,
    token: character.token,
    onWelcome() {},
    onMessage(msg) {
      if (msg.type === 'hush') player?.hush();
      else if (msg.type === 'state') o.onState(msg.state);
      // move / stop: there is no car on the bench.
    },
    onAudio(bytes) {
      const shaped = shapeDownlink(bytes, o.outcome.amp);
      down = shaped ? level(shaped) : 0;
      o.onLevel(up, down);
      if (shaped) player?.play(shaped);
    },
    onLost() {},
    onReject: (reason) => end(rejectMessage(reason)),
  });

  pipeline.subscribe(name, (frame) => {
    const shaped = shapeUplink(toInt16(frame), o.outcome.mic);
    up = level(shaped);
    o.onLevel(up, down);
    link?.sendAudio(shaped);
  });

  return { stop };
}
