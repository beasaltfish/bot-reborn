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
import { createEarcon, durationOf } from '../audio/earcon.js';
import { classifyLabel, WAKE } from '../audio/keyword-lines.js';
import { toInt16 } from '../audio/pcm.js';
import { RATE, FRAME_MS } from '../audio/pipeline.js';
import { wantedSubscriptions } from '../audio/session.js';
import { OpenAiCompatStt } from '../providers/stt-openai-compat.js';
import {
  rms, dbs, fmt, setStat, setDisabled, aboveFloor, DB_FLOOR_OFF,
} from './readout.js';
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
  /** @type {((name: 'wake') => number) | null} */ let earcon = null;
  let running = false;
  let hits = 0;
  let segs = 0;
  let skipped = 0;
  /** Product wiring only. §5.2 has three more states; none is reachable here,
   *  because no turn ever runs. @type {'SLEEPING' | 'LISTENING'} */
  let state = 'SLEEPING';
  let earconUntil = 0;

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

  /** @returns {'none' | 'gated' | 'ungated'} */
  const wakeMode = () =>
    /** @type {any} */ (/** @type {HTMLSelectElement} */ ($('rcWakeMode')).value);

  /** @returns {'both' | 'product'} */
  const wiring = () =>
    /** @type {any} */ (/** @type {HTMLSelectElement} */ ($('rcWiring')).value);

  /** @param {string[]} found */
  function noteHits(found) {
    if (!found.length) return;
    hits += found.length;
    setStat('rcHits', String(hits));
    ctx?.log(`♦ keyword: ${found.join(', ')}`);
  }

  /**
   * What the shipped gate actually costs, reproduced exactly.
   *
   * §5.6 says the pipeline is gated for 80 ms, and frames arrive every 100 ms,
   * so on the face of it the gate cannot cost a frame at all: it is over before
   * the next one lands. It costs one anyway, and the reason is not in §5.6 —
   * it is in pipeline.js's fan-out. reconcile() subscribes kws BEFORE vad, so
   * kws runs first in `for (const fn of this.#subs.values())`, and a keyword
   * hit unsubscribes vad synchronously from inside that loop. A Map iterator
   * skips a key deleted before it reaches it, so the VAD never sees the frame
   * the keyword was found in — the 100 ms carrying the end of "steven" and the
   * attack of 「往」.
   *
   * That behaviour hangs entirely on the order of two lines in reconcile().
   * Swap them and the gate costs nothing. Nothing tests it, in either file.
   *
   * @param {string[]} found labels this frame
   * @returns {boolean} whether the VAD should be denied THIS frame
   */
  function gateThisFrame(found) {
    const mode = wakeMode();
    if (mode === 'none') return false;
    if (!found.some((l) => classifyLabel(l) === WAKE)) return false;
    earcon?.('wake');
    return mode === 'gated';
  }

  /**
   * The model's own two numbers ride along with the text, because the text on
   * its own cannot say whether there was anything to transcribe: handed an
   * empty room whisper answers 「谢谢大家」or continues its own prompt, and
   * both read as a transcript. `nsp` is that opinion, and it is a different
   * axis from the dB — one is measured off the audio, one is the model's.
   *
   * Nothing is filtered on it yet. This run is the one that finds out where
   * the threshold belongs, which means the false positives have to keep coming
   * through wearing their numbers.
   *
   * @param {Float32Array} seg
   * @returns {Promise<string>} the transcript with its numbers, ready to log
   */
  async function transcribe(seg) {
    if (!stt) return '(no STT configured)';
    try {
      const r = await stt.transcribeDetailed(toInt16(seg), RATE);
      const nsp = r.noSpeech === null ? 'nsp —' : `nsp ${fmt(r.noSpeech, 2)}`;
      const lp = r.logprob === null ? '' : ` / lp ${fmt(r.logprob, 2)}`;
      // `parts` only when there was more than one: whisper cut the clip up
      // itself, and a worst-of reading taken from one slice of many is a
      // different claim from one taken off the whole.
      const parts = r.parts > 1 ? ` / ${r.parts} parts` : '';
      return `${nsp}${lp}${parts} → ${r.text}`;
    } catch (err) {
      return `(STT failed: ${/** @type {Error} */ (err).message})`;
    }
  }

  /**
   * The level is on the line because the transcript cannot be trusted to say
   * whether there was anything to transcribe. Handed an empty room, whisper
   * does not answer with silence — it answers with 「谢谢大家」or with this
   * file's own BILINGUAL_PROMPT continued, both of which read as a transcript.
   * A dB figure next to the duration is the one part of the line that comes
   * from the audio rather than from the model.
   *
   * @param {Float32Array} seg
   */
  async function reportSegment(seg) {
    segs++;
    const seconds = seg.length / RATE;
    const level = rms(seg);
    const head = `${fmt(seconds)} s / ${dbs(level)}`;
    setStat('rcSegs', String(segs));
    setStat('rcLastSeg', head);
    const floor = num('rcMinLevel');
    if (!aboveFloor(level, floor)) {
      skipped++;
      setStat('rcSkipped', String(skipped));
      // Still logged, and still counted in rcSegs: what the VAD cut is the
      // measurement. The floor only decides who gets paid to look at it.
      ctx?.log(`▫ ${head} → under ${fmt(floor, 0)} dB, not sent`);
      return;
    }
    const text = await transcribe(seg);
    setStat('rcLastText', text);
    // The transcript goes into the log too: ⑯ is twenty sentences and the stat
    // row only ever holds the last one. transcribe() brings its own arrow.
    ctx?.log(`📝 ${head} / ${text}`);
  }

  /**
   * The `both` wiring: one subscriber, both engines fed every frame, forever.
   *
   * This is what ⑯ and ⑦ were measured on, and it is NOT what the product
   * does — see runProduct below. It stays because it answers a different
   * question: what the two detectors do when neither is ever starved.
   *
   * @param {ReturnType<typeof createSpotter>} spotter
   * @param {ReturnType<typeof createVoiceDetector>} vad
   */
  function runBoth(spotter, vad) {
    ctx?.pipeline.subscribe(SUB, (frame) => {
      const found = spotter.accept(frame);
      noteHits(found);
      // No CLEARING here — §5.5's "the wake word does not clear the buffer" is
      // the product's policy and this panel measures what the detector does
      // with everything. Gating is different: it is a knob, because ⑯ has to
      // tell a head lost to the gate apart from one lost to the VAD's own
      // latency, and those two want opposite fixes.
      if (gateThisFrame(found)) return;
      vad.accept(frame);
      for (const seg of vad.drain()) void reportSegment(seg);
    });
  }

  /**
   * The `product` wiring: what session.js actually does.
   *
   * The difference is not a detail. §5.3 leaves the VAD UNSUBSCRIBED through
   * SLEEPING, so on the product's wake path the detector never hears the
   * keyword at all, and picks up from whichever frame arrives after the earcon
   * window closes. "hey steven 往前走" said in one breath therefore loses more
   * than the one frame the `both` wiring's gate drops — it loses everything up
   * to roughly 100 ms past the hit. Nothing had ever measured that, because
   * nothing could: this panel fed the VAD every frame regardless of state.
   *
   * The policy itself is imported, never copied. wantedSubscriptions is the
   * product's own function, and a second implementation here would drift the
   * way web/spike/audio/ drifted before it was deleted.
   *
   * @param {ReturnType<typeof createSpotter>} spotter
   * @param {ReturnType<typeof createVoiceDetector>} vad
   */
  function runProduct(spotter, vad) {
    const KWS = `${SUB}-kws`;
    const VAD = `${SUB}-vad`;
    // Wall clock and setTimeout, mirroring session.js's own `now` and `after`
    // rather than the AudioContext's clock: the gate's 80 ms is a wall-clock
    // window there, and reproducing it on a different clock reproduces
    // something else.
    const now = () => performance.now();

    /** @param {Float32Array} frame */
    const onKws = (frame) => {
      const found = spotter.accept(frame);
      noteHits(found);
      if (found.some((l) => classifyLabel(l) === WAKE)) wake();
    };
    /** @param {Float32Array} frame */
    const onVad = (frame) => {
      vad.accept(frame);
      const cut = vad.drain();
      for (const seg of cut) void reportSegment(seg);
      // Back to SLEEPING after each utterance. The product would stay in
      // LISTENING for §5.2's thirty seconds; this panel is for saying the same
      // sentence twenty times, and every one of those has to start from the
      // state the wake path actually begins in.
      if (cut.length) sleep();
    };

    const reconcile = () => {
      const want = wantedSubscriptions(state, true, now() < earconUntil);
      // kws first, exactly as session.js's #reconcile registers them. The
      // order is not cosmetic: a keyword hit unsubscribes the VAD from inside
      // pipeline's fan-out loop, and a Map iterator skips a key deleted before
      // it reaches it. Registering them the other way round would quietly
      // measure a pipeline the product does not have.
      gate(KWS, want.kws, onKws);
      gate(VAD, want.vad, onVad);
    };
    /** @param {string} name @param {boolean} on @param {(f: Float32Array) => void} fn */
    const gate = (name, on, fn) => {
      if (on) ctx?.pipeline.subscribe(name, fn);
      else ctx?.pipeline.unsubscribe(name);
    };
    const wake = () => {
      const mode = wakeMode();
      if (mode !== 'none') {
        const ms = earcon?.('wake') ?? 0;
        // session.js has no `ungated`: it gates for every earcon it plays.
        // Keeping the tone while refusing the gate is this panel's own arm,
        // and it is how ⑯ tells the two causes of a lost head apart.
        if (mode === 'gated') earconUntil = now() + ms;
      }
      state = 'LISTENING';
      reconcile();
      if (now() < earconUntil) setTimeout(reconcile, earconUntil - now());
    };
    const sleep = () => {
      state = 'SLEEPING';
      reconcile();
      ctx?.log('· back to SLEEPING — the next utterance needs the wake word again');
    };

    state = 'SLEEPING';
    earconUntil = 0;
    reconcile();
  }

  function runLive() {
    if (!ctx || running) return;
    if (!ctx.exclusion.claim(NAME)) {
      ctx.log(`another panel (${ctx.exclusion.owner}) is running — stop it first`);
      return;
    }
    const spotter = createSpotter(ctx.sherpa, ctx.keywords, kwsOpts());
    const vad = createVoiceDetector(ctx.sherpa, vadOpts());
    if (wiring() === 'product') runProduct(spotter, vad);
    else runBoth(spotter, vad);
    running = true;
    setDisabled('rcRun', true);
    setDisabled('rcStop', false);
    setDisabled('rcRecord', false);
    const o = vadOpts();
    const floor = num('rcMinLevel');
    ctx.log(`▶︎ recognition: ${wiring()} wiring, `
      + `KWS ${num('rcKwsThreshold')}/${num('rcKwsScore')}, `
      + `VAD ${o.threshold}/${o.minSilence}/${o.minSpeech}, buffer ${o.bufferSeconds} s, `
      + `STT floor ${floor <= DB_FLOOR_OFF ? 'off' : `${fmt(floor, 0)} dB`}, `
      + `wake earcon ${wakeMode()} (gate costs one 100 ms frame, not ${durationOf('wake')} ms)`);
  }

  function stopLive() {
    if (!ctx || !running) return;
    // All three names: which two exist depends on the wiring, and unsubscribing
    // one that was never registered is a Map.delete that finds nothing.
    ctx.pipeline.unsubscribe(SUB);
    ctx.pipeline.unsubscribe(`${SUB}-kws`);
    ctx.pipeline.unsubscribe(`${SUB}-vad`);
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
        const gate = wakeMode() === 'gated';
        for (const frame of sliceFrames(samples, FRAME_SAMPLES)) {
          const found = spotter.accept(frame);
          kwsHits += found.length;
          // The gate is reproduced, the sound is not: replay feeds stored
          // samples straight in, so a tone played now would reach no
          // microphone and change no reading. Dropping the hit frame is the
          // whole of what the gate does to the VAD.
          if (gate && found.some((l) => classifyLabel(l) === WAKE)) continue;
          vad.accept(frame);
          cut.push(...vad.drain());
        }
        const texts = [];
        for (const seg of cut) {
          const level = rms(seg);
          const head = `${fmt(seg.length / RATE)}s / ${dbs(level)}`;
          // The floor applies here too, so the two paths agree on what counts
          // as a segment worth transcribing. At the default it refuses nothing
          // and a sweep reads exactly as it did before.
          texts.push(aboveFloor(level, num('rcMinLevel'))
            ? `${head} / ${await transcribe(seg)}`
            : `${head} (under the floor, not sent)`);
        }
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
      earcon = createEarcon(c.pipeline.audioContext);
      setDisabled('rcRun', false);
      $('rcRun').addEventListener('click', runLive);
      $('rcStop').addEventListener('click', stopLive);
      $('rcReset').addEventListener('click', () => {
        hits = 0; segs = 0; skipped = 0;
        setStat('rcHits', '0');
        setStat('rcSegs', '0');
        setStat('rcSkipped', '0');
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
