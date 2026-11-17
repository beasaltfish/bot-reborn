// Audio over the board's own link: the microphone uplink and the speaker
// downlink. The link belongs to the board runtime; this owns only the sound.
//
// The microphone is optional and late: the link connects first, then the mic is
// asked for. A refused or missing microphone silences the uplink and leaves the
// downlink (and the session) running — the bench can still speak. The speaker
// has its own AudioContext, created/resumed from a real gesture; without one the
// caller is told to ask for a gesture, never to end the session.
// docs/superpowers/specs/2026-11-16-firmware-layer-design.md §10.

import { PcmPlayer } from '../../phone/audio/player.js';
import { AudioPipeline } from '../../phone/audio/pipeline.js';
import { toInt16 } from '../../core/audio/pcm.js';
import { createPipelinePool } from '../audio-pipeline-pool.js';
import { shapeUplink, shapeDownlink } from '../body.js';

// A successfully used microphone stays held across sessions, as before.
const pipelines = createPipelinePool((echo, signal) => AudioPipeline.start({ echoCancellation: echo, signal }));

/** @param {Int16Array | ArrayBuffer} samples @returns {number} 0..1 RMS */
function level(samples) {
  const s = samples instanceof Int16Array ? samples : new Int16Array(samples, 0, samples.byteLength >> 1);
  if (!s.length) return 0;
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += s[i] * s[i];
  return Math.sqrt(sum / s.length) / 32768;
}

/**
 * @param {{
 *   outcome: { mic?: string, amp?: string },
 *   audio?: { get context(): AudioContext | null },
 *   name?: string,
 *   onLevel?(up: number, down: number): void,
 *   onMicBlocked?(): void,
 *   onNeedsGesture?(): void,
 *   acquire?: (echo: boolean, current: () => boolean) => Promise<any>,
 * }} o
 */
export function createBodyAudioLink(o) {
  const name = o.name ?? 'bench';
  const acquire = o.acquire ?? ((echo, current) => pipelines.acquire(echo, current));
  /** @type {AudioContext | null} */ let playerContext = null;
  /** @type {PcmPlayer | null} */ let player = null;
  /** @type {any} */ let lease;
  /** @type {any} */ let pipeline = null;
  /** @type {any} */ let send = null;
  let attached = false;
  let stopped = false;
  let up = 0;
  let down = 0;

  /** The player exists only while there is a running output context. */
  function playerNow() {
    if (player) return player;
    const context = o.audio?.context ?? null;
    if (!context || context.state !== 'running') return null;
    // A context that was closed and replaced needs a new player.
    if (playerContext !== context) { playerContext = context; player = new PcmPlayer(context); }
    return player;
  }

  /**
   * Ask for the microphone once per boot. The caller's send is only used while
   * this link is alive; a refused microphone reports and stays silent.
   * @param {(pcm: Int16Array) => void} sendAudio
   */
  async function attach(sendAudio) {
    if (stopped || attached) return;
    attached = true;
    send = sendAudio;
    try {
      lease = await acquire(true, () => !stopped);
    } catch {
      lease = undefined;
    }
    if (stopped) { lease?.cancel?.(); return; }
    pipeline = lease?.pipeline ?? null;
    if (!pipeline) { o.onMicBlocked?.(); return; }
    pipeline.subscribe(name, (/** @type {any} */ frame) => {
      if (stopped) return;
      const shaped = shapeUplink(toInt16(frame), /** @type {any} */ (o.outcome.mic));
      up = level(shaped);
      o.onLevel?.(up, down);
      send?.(shaped);
    });
    lease?.commit?.();
  }

  /** @param {ArrayBuffer} bytes */
  function downlink(bytes) {
    if (stopped) return;
    const shaped = shapeDownlink(bytes, /** @type {any} */ (o.outcome.amp));
    down = shaped ? level(shaped) : 0;
    o.onLevel?.(up, down);
    if (!shaped) return;
    const out = playerNow();
    if (!out) { o.onNeedsGesture?.(); return; }
    out.play(shaped);
  }

  function hush() {
    player?.hush();
    up = down = 0;
    o.onLevel?.(0, 0);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (pipeline) pipeline.unsubscribe(name);
    lease?.cancel?.();
    pipeline = null;
    send = null;
    hush();
    player = null;
    playerContext = null;
  }

  return { attach, downlink, hush, stop };
}
