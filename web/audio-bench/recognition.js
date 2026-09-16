// Recognition: ⑦ ⑩ ⑯.
//
// ⑯ is the one measurement on this page that can overturn product code. §5.4
// deleted the hand-rolled 500 ms pre-roll ring and handed the job to sherpa's
// own CircularBuffer, on the strength of documentation and a silent test. If
// vad.front() loses the head of a real sentence, that ring goes back in and
// both vad.js and session.js change.
//
// Two halves, and the second one is not a convenience: sweeping bufferSeconds
// over twenty freshly-spoken sentences would compare different inputs against
// different parameters. Record once, replay the same audio at every setting.

import { createSpotter } from '../audio/kws.js';
import { createVoiceDetector } from '../audio/vad.js';
import { toInt16 } from '../audio/pcm.js';
import { RATE, FRAME_MS } from '../audio/pipeline.js';
import { OpenAiCompatStt } from '../providers/stt-openai-compat.js';
import { fmt, setStat, setDisabled } from './readout.js';
import {
  PREFIX, sliceFrames, createRecorder, loadSamples, listFixtures, deleteFixture,
} from './samples.js';

const NAME = 'recognition';
const SUB = 'recognition';
const FRAME_SAMPLES = RATE * FRAME_MS / 1000;

const $ = (/** @type {string} */ id) =>
  /** @type {HTMLElement} */ (document.getElementById(id));
const num = (/** @type {string} */ id) =>
  Number(/** @type {HTMLInputElement} */ ($(id)).value);

export function createRecognition() {
  /** @type {import('./main.js').BenchContext | null} */ let ctx = null;
  /** @type {OpenAiCompatStt | null} */ let stt = null;
  /** @type {ReturnType<typeof createRecorder> | null} */ let recorder = null;
  let running = false;
  let hits = 0;
  let segs = 0;

  // Read at construction time, every time: both engines take these in their
  // constructor, so a knob only takes effect on the next Run or Replay.
  const kwsOpts = () => ({
    threshold: num('rcKwsThreshold'),
    score: num('rcKwsScore'),
  });
  const vadOpts = () => ({
    threshold: num('rcVadThreshold'),
    minSilence: num('rcMinSilence'),
    minSpeech: num('rcMinSpeech'),
    bufferSeconds: num('rcBufferSeconds'),
  });

  /** @param {Float32Array} seg @returns {Promise<string>} */
  async function transcribe(seg) {
    if (!stt) return '(no STT configured)';
    try {
      return (await stt.transcribe(toInt16(seg), RATE)).trim();
    } catch (err) {
      return `(STT failed: ${/** @type {Error} */ (err).message})`;
    }
  }

  /** @param {Float32Array} seg */
  async function reportSegment(seg) {
    segs++;
    const seconds = seg.length / RATE;
    setStat('rcSegs', String(segs));
    setStat('rcLastSeg', `${fmt(seconds)} s`);
    const text = await transcribe(seg);
    setStat('rcLastText', text);
    // The transcript goes into the log too: ⑯ is twenty sentences and the stat
    // row only ever holds the last one.
    ctx?.log(`📝 ${fmt(seconds)} s → ${text}`);
  }

  function runLive() {
    if (!ctx || running) return;
    if (!ctx.exclusion.claim(NAME)) {
      ctx.log(`another panel (${ctx.exclusion.owner}) is running — stop it first`);
      return;
    }
    const spotter = createSpotter(ctx.sherpa, ctx.keywords, kwsOpts());
    const vad = createVoiceDetector(ctx.sherpa, vadOpts());
    ctx.pipeline.subscribe(SUB, (frame) => {
      const found = spotter.accept(frame);
      if (found.length) {
        hits += found.length;
        setStat('rcHits', String(hits));
        ctx?.log(`♦ keyword: ${found.join(', ')}`);
      }
      // No gating and no clearing here. §5.3's subscription table and §5.5's
      // "the wake word does not clear the buffer" are the product's policy;
      // this panel is measuring what the detector does with everything.
      vad.accept(frame);
      for (const seg of vad.drain()) void reportSegment(seg);
    });
    running = true;
    setDisabled('rcRun', true);
    setDisabled('rcStop', false);
    setDisabled('rcRecord', false);
    const o = vadOpts();
    ctx.log(`▶︎ recognition: KWS ${num('rcKwsThreshold')}/${num('rcKwsScore')}, `
      + `VAD ${o.threshold}/${o.minSilence}/${o.minSpeech}, buffer ${o.bufferSeconds} s`);
  }

  function stopLive() {
    if (!ctx || !running) return;
    ctx.pipeline.unsubscribe(SUB);
    ctx.exclusion.release(NAME);
    running = false;
    setDisabled('rcRun', false);
    setDisabled('rcStop', true);
    setDisabled('rcRecord', true);
    ctx.log('■ recognition stopped');
  }

  // --- samples ------------------------------------------------------------

  async function refreshSamples() {
    const list = $('rcSamples');
    list.textContent = '';
    const paths = await listFixtures(PREFIX);
    setDisabled('rcReplayAll', paths.length === 0);
    for (const path of paths) {
      const li = document.createElement('li');
      const name = document.createElement('div');
      name.textContent = path;
      const row = document.createElement('div');
      row.className = 'controls';
      const del = document.createElement('button');
      del.textContent = 'Delete';
      del.addEventListener('click', async () => {
        await deleteFixture(path);
        ctx?.log(`deleted ${path}`);
        await refreshSamples();
      });
      const result = document.createElement('div');
      result.className = 'result';
      result.id = `rcResult-${path}`;
      row.append(del);
      li.append(name, row, result);
      list.append(li);
    }
  }

  async function toggleRecord() {
    if (!ctx || !recorder) return;
    if (recorder.recording) {
      await recorder.stop();
      $('rcRecord').textContent = '● Record';
      await refreshSamples();
      return;
    }
    const raw = /** @type {HTMLInputElement} */ ($('rcSampleName')).value.trim();
    if (!raw) { ctx.log('give the sample a name first'); return; }
    recorder.start(`${PREFIX}${raw}.wav`);
    $('rcRecord').textContent = '■ Stop recording';
  }

  /**
   * Replay every stored sample through a freshly built VAD at the current
   * settings. This is ⑯'s sweep: same audio, one parameter at a time.
   */
  async function replayAll() {
    if (!ctx) return;
    if (!ctx.exclusion.claim(NAME)) {
      ctx.log(`another panel (${ctx.exclusion.owner}) is running — stop it first`);
      return;
    }
    setDisabled('rcReplayAll', true);
    const o = vadOpts();
    ctx.log(`── replaying every sample at VAD ${o.threshold}/${o.minSilence}/`
      + `${o.minSpeech}, buffer ${o.bufferSeconds} s`);
    try {
      for (const path of await listFixtures(PREFIX)) {
        const samples = await loadSamples(path);
        const vad = createVoiceDetector(ctx.sherpa, vadOpts());
        const spotter = createSpotter(ctx.sherpa, ctx.keywords, kwsOpts());
        let kwsHits = 0;
        /** @type {Float32Array[]} */ const cut = [];
        for (const frame of sliceFrames(samples, FRAME_SAMPLES)) {
          kwsHits += spotter.accept(frame).length;
          vad.accept(frame);
          cut.push(...vad.drain());
        }
        const texts = [];
        for (const seg of cut) texts.push(`${fmt(seg.length / RATE)}s "${await transcribe(seg)}"`);
        const summary = `${fmt(samples.length / RATE)} s in → `
          + `${cut.length} segment(s), ${kwsHits} keyword hit(s)\n`
          + (texts.length ? texts.join('\n') : '(the VAD cut nothing out of it)');
        setStat(`rcResult-${path}`, summary);
        ctx.log(`📼 ${path}: ${summary.replace(/\n/g, ' | ')}`);
      }
    } finally {
      ctx.exclusion.release(NAME);
      setDisabled('rcReplayAll', false);
    }
  }

  return {
    name: NAME,

    /** @param {import('./main.js').BenchContext} c */
    start(c) {
      ctx = c;
      stt = c.config.stt.baseURL ? new OpenAiCompatStt(c.config.stt) : null;
      recorder = createRecorder({ pipeline: c.pipeline, log: c.log });
      setDisabled('rcRun', false);
      $('rcRun').addEventListener('click', runLive);
      $('rcStop').addEventListener('click', stopLive);
      $('rcReset').addEventListener('click', () => {
        hits = 0; segs = 0;
        setStat('rcHits', '0');
        setStat('rcSegs', '0');
        setStat('rcLastSeg', '—');
        setStat('rcLastText', '—');
      });
      $('rcRecord').addEventListener('click', () => void toggleRecord());
      $('rcReplayAll').addEventListener('click', () => void replayAll());
      void refreshSamples();
    },

    stop() {
      stopLive();
      ctx = null;
      recorder = null;
    },
  };
}
