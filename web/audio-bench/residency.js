// Residency: ⑤ ⑫ ⑭ ⑮. Hang the engines on the microphone, leave it running,
// and read the three clocks and the per-frame cost.
//
// The three clocks are the point. §5.7/§5.8: with no adb attached, android
// takes the microphone back about 60 seconds after the screen goes off, and
// the way you tell that apart from a frozen main thread is that the audio
// clock and the fed count stop TOGETHER while the wall clock keeps going.

import { createSpotter } from '../audio/kws.js';
import { createVoiceDetector } from '../audio/vad.js';
import { isBehind, framesBehind } from '../audio/keepalive.js';
import { FRAME_MS } from '../audio/pipeline.js';
import { createMeter, setStat, setDisabled, fmt } from './readout.js';

const NAME = 'residency';
const SUB = 'residency';

const $ = (/** @type {string} */ id) =>
  /** @type {HTMLElement} */ (document.getElementById(id));

export function createResidency() {
  /** @type {import('./main.js').BenchContext | null} */ let ctx = null;
  /** @type {ReturnType<typeof setInterval> | null} */ let timer = null;
  let running = false;
  let startedAt = 0;
  let audioStart = 0;
  let hits = 0;
  const kwsCost = createMeter();
  const vadCost = createMeter();
  /** @type {{ level: number } | null} */ let battery = null;
  let batteryStart = 0;

  function render() {
    if (!ctx) return;
    const wall = (Date.now() - startedAt) / 1000;
    const audio = ctx.pipeline.audioContext.currentTime - audioStart;
    const fed = ctx.pipeline.fedFrames * FRAME_MS / 1000;
    setStat('resWall', `${fmt(wall)} s`);
    setStat('resAudio', `${fmt(audio)} s`);
    setStat('resFed', `${fmt(fed)} s (${ctx.pipeline.fedFrames} frames)`);
    const behind = framesBehind(ctx.pipeline.fedFrames, Date.now() - startedAt);
    setStat('resBehind', isBehind(ctx.pipeline.fedFrames, Date.now() - startedAt)
      ? `⚠️ ${behind} frames behind — the capture path stopped`
      : `no (${behind} frames of jitter)`);
    setStat('resKws', kwsCost.count
      ? `${fmt(kwsCost.mean, 2)} ms (peak ${fmt(kwsCost.max, 2)})` : '—');
    setStat('resVad', vadCost.count
      ? `${fmt(vadCost.mean, 2)} ms (peak ${fmt(vadCost.max, 2)})` : '—');
    const total = kwsCost.mean + vadCost.mean;
    setStat('resTotal', kwsCost.count
      ? `${fmt(total, 2)} ms — ${fmt(total / FRAME_MS * 100, 1)}% of one core` : '—');
    setStat('resHits', String(hits));
    if (battery) {
      const now = battery.level * 100;
      setStat('resBattery',
        `${fmt(now, 1)}% (started at ${fmt(batteryStart, 1)}%, `
        + `${fmt(batteryStart - now, 1)} points in ${fmt(wall / 60)} min)`);
    }
  }

  function stopRun() {
    if (!running || !ctx) return;
    ctx.pipeline.unsubscribe(SUB);
    ctx.exclusion.release(NAME);
    if (timer !== null) clearInterval(timer);
    timer = null;
    running = false;
    setDisabled('resRun', false);
    setDisabled('resStop', true);
    render();
    ctx.log('■ residency stopped');
  }

  return {
    name: NAME,

    /** @param {import('./main.js').BenchContext} c */
    start(c) {
      ctx = c;
      setDisabled('resRun', false);

      $('resRun').addEventListener('click', () => {
        if (running || !ctx) return;
        if (!ctx.exclusion.claim(NAME)) {
          ctx.log(`another panel (${ctx.exclusion.owner}) is running — stop it first`);
          return;
        }
        const both = /** @type {HTMLSelectElement} */ ($('resEngines')).value === 'both';
        const spotter = createSpotter(ctx.sherpa, ctx.keywords);
        const vad = both ? createVoiceDetector(ctx.sherpa) : null;

        kwsCost.reset();
        vadCost.reset();
        hits = 0;
        startedAt = Date.now();
        audioStart = ctx.pipeline.audioContext.currentTime;

        ctx.pipeline.subscribe(SUB, (frame) => {
          let t0 = performance.now();
          const found = spotter.accept(frame);
          kwsCost.add(performance.now() - t0);
          if (found.length) {
            hits += found.length;
            ctx?.log(`♦ keyword: ${found.join(', ')}`);
          }
          if (vad) {
            t0 = performance.now();
            vad.accept(frame);
            vadCost.add(performance.now() - t0);
            // Segments are drained and dropped: this panel measures cost and
            // liveness, and letting them pile up in sherpa's CircularBuffer
            // would grow memory across a 30-minute run for nothing.
            if (!vad.detected) vad.drain();
          }
        });

        // Not in lib.dom: getBattery is non-standard and Chrome-on-Android only,
        // which is exactly the device every reading on this page is about.
        /** @type {any} */ (navigator).getBattery?.().then((/** @type {any} */ b) => {
          battery = b;
          batteryStart = b.level * 100;
        }).catch(() => {});

        running = true;
        setDisabled('resRun', true);
        setDisabled('resStop', false);
        timer = setInterval(render, 1000);
        ctx.log(`▶︎ residency: ${both ? 'KWS + VAD' : 'KWS only'}`);
        ctx.log('for ⑮ the phone must now be off the cable, off adb and off the charger');
      });

      $('resStop').addEventListener('click', () => stopRun());
    },

    stop() { stopRun(); ctx = null; },
  };
}
