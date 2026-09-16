// Acoustics: ⑥ and ⑬. The guided five-window self-test, moved here from
// web/spike/audio/main.js — the measurement flow is kept, everything it used
// to build for itself now comes from web/audio/.
//
// The flow exists because one window cannot separate three sources. Every
// frame of playback mixes the robot's echo that AEC failed to remove, your own
// voice, and the room. The previous single-window version counted any VAD hit
// during playback as an AEC failure, so doing what the page told you to do —
// talk over it — scored as a failure, while staying silent scored as a pass on
// echo residue alone. Two errors pointing opposite ways.
//
//   floor   no TTS,  you silent       → the room
//   warmup  TTS on,  you silent       → discarded; AEC needs ~1 s to converge
//   quiet   TTS on,  you silent       → the room + whatever echo survived AEC
//   talk    TTS on,  you talking      → the above, plus you
//   settle  TTS on,  you silent again → should fall back to `quiet`
//
// `quiet − floor` is the echo residue. `talk − quiet` is the only positive
// evidence that barge-in can work here.

import { createVoiceDetector } from '../audio/vad.js';
import { createSpotter } from '../audio/kws.js';
import { toInt16, joinFrames } from '../audio/pcm.js';
import { RATE } from '../audio/pipeline.js';
import { OpenAiCompatStt } from '../providers/stt-openai-compat.js';
import { WebAudioTts } from '../providers/tts-webaudio.js';
import { rms, dbOf, dbs, fmt, setStat, setDisabled } from './readout.js';

const NAME = 'acoustics';
const SUB = 'acoustics';

const $ = (/** @type {string} */ id) =>
  /** @type {HTMLElement} */ (document.getElementById(id));

// Long on purpose: the probe needs ~23 s of continuous speech to walk its five
// windows, and a passage that runs out mid-window aborts the run.
//
// Chinese with English spliced into it, also on purpose, and NOT an oversight
// left over from translating this file to English: waiting item ⑪ is about how
// each TTS provider handles code-switching, and a monolingual passage would
// never ask the question. Same for READ_LINE.
const SCRIPT_TEXT =
    '好的，我先往前走一点。「往前走」的英文是 go forward，走慢一点就是 ' +
    'go forward slowly。你可以试着跟我说一遍，不用着急，说错了我们再来一次。' +
    '接下来我会一直念下去，你照着屏幕上的提示做就行，该安静的时候安静，' +
    '该说话的时候就正常说话，不用管我念到哪里。' +
    '我现在往左边转一点，「向左转」是 turn left，往右边就是 turn right。' +
    '再往前一点点，然后停下来，「停下来」是 stop，或者 hold on。' +
    '给你数两遍：one, two, three, four, five, six, seven, eight, nine, ten。' +
    '一，二，三，四，五，六，七，八，九，十。' +
    '好了，这一段差不多念完了，看看屏幕上那几行电平对不对得上。';

// The line you read, twice: once in silence and once over the robot. Also
// code-switched — this is the sentence waiting item ⑩ is about, and the one a
// phone mic is worst at.
const READ_LINE = '往前走三米，然后 turn left，停在红色的箱子旁边';

/** @type {Record<string, { ms: number, cue: string, sub: string, read?: boolean }>} */
const PHASES = {
  floor:   { ms: 2500, cue: '① stay silent', sub: 'measuring the room, 2.5 s' },
  control: { ms: 8000, cue: '② read the line below, once', sub: 'no TTS — this is the transcription control', read: true },
  warmup:  { ms: 1500, cue: '③ it has started speaking; stay silent', sub: 'the AEC is converging; this window is discarded' },
  quiet:   { ms: 8000, cue: '④ stay quiet and let it talk', sub: 'this measures how much of its echo leaks in' },
  talk:    { ms: 8000, cue: '⑤ read the line again, over the top of it', sub: 'same sentence, this time with it sounding next to you', read: true },
  settle:  { ms: 3000, cue: '⑥ stop, and be quiet again', sub: 'confirming the level falls back' },
};
const SCRIPT = ['warmup', 'quiet', 'talk', 'settle'];

// Above this the TTS analyser counts as actually playing. The fetch+decode in
// front of playback is 1–2 s of silence (§7.1) and a fixed delay would let it
// eat into `quiet`, so the clock starts on real output, not on speak().
const OUT_ON = 0.005;
const DEAD = 0.003;   // ≈ −50 dBFS; below this nothing usable reached the mic
const GAIN_MIN = 6;   // dB your voice must add on top of `quiet` to count

// --- pure, and tested in test/cer.test.js ---------------------------------

/** @param {string} text */
export function normalize(text) {
  return (text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** @param {string[]} a @param {string[]} b */
export function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Character error rate against the prompted line. Punctuation and spaces come
 * and go between backends and say nothing about the audio, so they are dropped
 * first: `turn left` and `turnleft` must not score as an error.
 * @param {string} ref @param {string} hyp @returns {number | null}
 */
export function cer(ref, hyp) {
  const r = [...normalize(ref)], h = [...normalize(hyp)];
  if (!r.length) return null;
  return editDistance(r, h) / r.length;
}

const pct = (/** @type {number | null} */ v) =>
  (v == null ? '—' : `${fmt(v * 100, 0)}%`);

// --- the panel ------------------------------------------------------------

export function createAcoustics() {
  /** @type {import('./main.js').BenchContext | null} */ let ctx = null;
  /** @type {WebAudioTts | null} */ let tts = null;
  /** @type {OpenAiCompatStt | null} */ let stt = null;
  let active = false;
  let aborted = false;
  let phase = 'off';
  /** @type {Record<string, { frames: number, sum: number, max: number, vad: number, kws: number }>} */
  const bins = {};
  /** @type {Record<string, Float32Array[]>} */
  let rec = { control: [], talk: [] };
  /** @type {any} */ let sttOut = null;
  /** @type {{ ok: boolean, text: string } | null} */ let result = null;

  const newBin = () => ({ frames: 0, sum: 0, max: 0, vad: 0, kws: 0 });
  const avgOf = (/** @type {any} */ b) => (b && b.frames ? b.sum / b.frames : 0);
  const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

  // Float32Array<ArrayBuffer>, not a bare Float32Array: getFloatTimeDomainData
  // refuses ArrayBufferLike, which is what the bare annotation widens to.
  /** @type {Float32Array<ArrayBuffer> | null} */ let outBuf = null;
  /** RMS of what the TTS is putting out right now, off its own analyser. */
  function ttsOutLevel() {
    const a = tts?.analyser;
    if (!a) return 0;
    if (!outBuf || outBuf.length !== a.fftSize) outBuf = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(outBuf);
    return rms(outBuf);
  }

  /**
   * @param {string} text @param {string} sub
   * @param {number | null} count @param {boolean} [read]
   */
  function showCue(text, sub, count, read = false) {
    setStat('acCue', text);
    setStat('acSub', sub);
    setStat('acCount', count == null ? '' : String(count));
    setStat('acLine', read ? READ_LINE : '');
    $('acLine').hidden = !read;
    $('acBar').hidden = !active;
  }

  /** @param {string} p */
  function enterPhase(p) {
    phase = p;
    if (p === 'off') { showCue('', '', null); return; }
    ctx?.log(`◆ ${PHASES[p].cue} (${PHASES[p].ms / 1000} s)`);
    showCue(PHASES[p].cue, PHASES[p].sub,
            Math.ceil(PHASES[p].ms / 1000), PHASES[p].read);
  }

  /** Hold one phase for its full length, counting down.
   *  @param {string} p @param {boolean} requireAudio */
  async function hold(p, requireAudio) {
    enterPhase(p);
    const end = Date.now() + PHASES[p].ms;
    let silentMs = 0;
    while (Date.now() < end) {
      await sleep(100);
      if (aborted) throw new Error('stopped part-way through');
      showCue(PHASES[p].cue, PHASES[p].sub,
              Math.ceil((end - Date.now()) / 1000), PHASES[p].read);
      if (!requireAudio) continue;
      silentMs = ttsOutLevel() > OUT_ON ? 0 : silentMs + 100;
      // Running out of speech mid-window is not a result, it is a broken run:
      // the rest of the window would measure silence and read as a pass.
      if (silentMs > 1000) {
        throw new Error(`it ran out of passage before "${PHASES[p].cue}" finished — lengthen what it reads`);
      }
    }
  }

  /** @param {number} timeoutMs */
  async function waitForAudio(timeoutMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (ttsOutLevel() > OUT_ON) return true;
      await sleep(50);
    }
    return false;
  }

  /**
   * The same sentence twice through the same STT. A dB figure says how much of
   * your voice survived; this says whether what survived is still
   * transcribable, which is what barge-in actually needs. The control run is
   * what separates "AEC damaged it" from "this room and this mic are hard".
   */
  async function transcribeProbe() {
    showCue('⑦ transcribing…', 'sending both recordings to STT — do not close the page', null);
    /** @type {any} */ const out = { ref: READ_LINE };
    for (const k of ['control', 'talk']) {
      const pcm = joinFrames(rec[k]);
      if (!pcm.length) { out[k] = '(nothing was recorded)'; continue; }
      try {
        const t0 = performance.now();
        out[k] = (await /** @type {OpenAiCompatStt} */ (stt)
          .transcribe(toInt16(pcm), RATE)).trim();
        ctx?.log(`📝 ${k === 'control' ? 'control' : 'over playback'} transcript `
          + `${fmt(performance.now() - t0, 0)} ms: ${out[k]}`);
      } catch (err) {
        out[k] = `(STT failed: ${/** @type {Error} */ (err).message})`;
        ctx?.log('❌ ' + out[k]);
      }
    }
    out.cerControl = cer(READ_LINE, out.control);
    out.cerTalk = cer(READ_LINE, out.talk);
    sttOut = out;
  }

  /**
   * Whether the transcript survived, and whose fault it is if not. Without the
   * control run a bad transcript is unattributable: a phone mic in a live room
   * is hard for STT all by itself, with no AEC involved.
   */
  function sttVerdict() {
    const x = sttOut;
    if (!x || x.cerControl == null || x.cerTalk == null) return '—';
    const gap = x.cerTalk - x.cerControl;
    const both = `control ${pct(x.cerControl)} → over playback ${pct(x.cerTalk)}`;
    if (x.cerControl > 0.3) {
      return `⚠️ ${both}: the control is already this wrong, which is a problem with this microphone or this room. `
        + 'Fix that first; this run says nothing about the AEC';
    }
    if (gap > 0.2) {
      return `⚠️ ${both} (up by ${fmt(gap * 100, 0)} points): the VAD catches it, but what reaches STT is unusable — `
        + 'the first sentence after an interruption will be misheard, so capture has to wait for TTS to stop';
    }
    if (gap > 0.05) {
      return `${both} (up by ${fmt(gap * 100, 0)} points): degraded but usable — keep an eye on the first sentence after an interruption`;
    }
    return `✅ ${both}: transcription during playback survives the AEC, so capturing straight after an interruption is viable`;
  }

  /**
   * Five windows in, one row out. Order matters: a leak makes the gain
   * meaningless, and a dead mic makes the VAD counts meaningless.
   */
  function judgeProbe() {
    const b = bins;
    if (b.quiet.frames < 30 || b.talk.frames < 30) {
      return { ok: false, text: 'not enough samples — run it again' };
    }
    const floorDb = dbOf(avgOf(b.floor));
    const quietDb = dbOf(avgOf(b.quiet));
    const talkDb = dbOf(avgOf(b.talk));
    const residue = quietDb - floorDb;
    // The mean and the peak disagree on purpose. Suppression pulls the mean of
    // a playing-but-silent window BELOW the room floor while the attack of each
    // phrase still spikes through — a mean-only test read that as "the phone
    // was too quiet to stress AEC", which was exactly backwards.
    const residuePeak = dbOf(b.quiet.max) - dbOf(b.floor.max);
    const gain = talkDb - quietDb;
    const plus = (/** @type {number} */ v) => `${v >= 0 ? '+' : ''}${fmt(v, 1)} dB`;

    if (b.floor.vad > 0) {
      return { ok: false, text: `⚠️ the VAD fired on ${b.floor.vad} frames during the noise-floor window — either you were not silent or the room is too loud. This run does not count` };
    }
    if (b.quiet.vad > 0) {
      return { ok: false, text: `⚠️ the VAD fired on ${b.quiet.vad} frames while it was speaking and you were not (echo residue ${plus(residue)}) — `
        + 'the AEC is not removing the robot from its own input, so the VAD triggers on its own voice. '
        + "bargeIn has to be false and interruption can only go through the keyword, which makes §6.8's forbidden words mandatory" };
    }
    if (b.quiet.max < DEAD && b.talk.max < DEAD) {
      return { ok: false, text: `⛔ almost no signal reached the mic during playback (peak ${dbs(b.talk.max)}) — your voice is being suppressed along with the echo, so even keyword interruption does not hold` };
    }
    if (gain < GAIN_MIN) {
      return { ok: false, text: `⛔ your voice only lifted the level by ${plus(gain)} (it needs ≥ ${GAIN_MIN} dB) — `
        + 'the mic is being held down during playback and speech cannot get in. bargeIn = false' };
    }
    if (b.talk.vad === 0) {
      return { ok: false, text: `⚠️ the level rose by ${plus(gain)} and yet the VAD caught nothing — the signal does get in, `
        + 'so either the AEC shaved the speech into something that no longer looks like speech, or the VAD threshold is too tight. Tune the threshold and re-run before concluding bargeIn = false' };
    }
    // A flat mean has two readings and the analyser cannot tell them apart. The
    // peak decides: if the phrase attacks still spike above the room floor, the
    // speaker was audible and AEC earned it.
    const caveat = residue >= 3 ? ''
      : residuePeak >= 6
        ? ` (the mean was pushed below the noise floor while the peak is ${plus(residuePeak)} above it — the AEC clamps hard in steady state and leaks on attack transients, which is normal)`
        : ` (note: mean ${plus(residue)}, peak ${plus(residuePeak)} — almost nothing from the speaker reached the mic. Check the phone is at a normal playback volume; too quiet and this run never tested the AEC at all)`;
    return { ok: true, text: `✅ zero VAD hits while only it was speaking (echo residue ${plus(residue)}); your voice added ${plus(gain)} and the VAD caught ${b.talk.vad} frames → bargeIn = true holds${caveat}` };
  }

  function render() {
    const b = bins;
    const row = (/** @type {string} */ id, /** @type {string} */ key) =>
      setStat(id, b[key]?.frames
        ? `${dbs(avgOf(b[key]))} · peak ${dbs(b[key].max)} · VAD ${b[key].vad} · KWS ${b[key].kws}`
        : '—');
    row('acFloor', 'floor');
    row('acControl', 'control');
    row('acQuiet', 'quiet');
    row('acTalk', 'talk');
    row('acSettle', 'settle');
    setStat('acSttControl', sttOut?.control ?? '—');
    setStat('acSttTalk', sttOut?.talk ?? '—');
    setStat('acSttVerdict', sttVerdict());
    setStat('acVerdict', result?.text ?? '—');
  }

  async function runProbe() {
    if (!ctx) return;
    if (active) return;
    if (!ctx.config.stt.baseURL || !ctx.config.tts.baseURL) {
      ctx.log('this panel needs STT and TTS configured on setup.html');
      return;
    }
    if (!ctx.exclusion.claim(NAME)) {
      ctx.log(`another panel (${ctx.exclusion.owner}) is running — stop it first`);
      return;
    }

    active = true; aborted = false; result = null; sttOut = null;
    rec = { control: [], talk: [] };
    for (const p of Object.keys(PHASES)) bins[p] = newBin();
    setDisabled('acRun', true);
    setDisabled('acStop', false);

    stt = new OpenAiCompatStt(ctx.config.stt);
    const player = new WebAudioTts(ctx.config.tts, { audioContext: ctx.pipeline.audioContext });
    tts = player;
    const spotter = createSpotter(ctx.sherpa, ctx.keywords);
    const vad = createVoiceDetector(ctx.sherpa);

    ctx.pipeline.subscribe(SUB, (frame) => {
      const level = rms(frame);
      // The worklet transfers a fresh buffer each frame, so holding the
      // reference is enough — no copy needed. 8 s at 16 kHz is 256 KB.
      rec[phase]?.push(frame);
      const b = bins[phase];
      if (b) {
        b.frames++; b.sum += level;
        if (level > b.max) b.max = level;
        if (spotter.accept(frame).length) b.kws++;
        // The VAD is fed in every window INCLUDING the ones where it is
        // speaking — that feeding is the AEC measurement. §5.3's gate belongs
        // to the product; here the whole point is to see what gets through.
        vad.accept(frame);
        if (vad.detected) b.vad++;
        vad.drain();
      }
    });

    ctx.log('── barge-in self-test starting; follow the prompts on screen');
    /** @type {Promise<void> | null} */ let playing = null;
    try {
      await hold('floor', false);
      await hold('control', false);
      // speak() returns immediately but the audio is 1–2 s of fetch and decode
      // away, so the phase stays `control`: nothing is playing yet, and a fixed
      // delay here would eat into `quiet` instead.
      showCue('③ waiting for it to start…', 'TTS is fetching the audio', null);
      playing = player.speak(SCRIPT_TEXT);
      if (!await waitForAudio(15000)) throw new Error('waited 15 s and TTS never made a sound');
      for (const p of SCRIPT) await hold(p, true);
      player.cancel();
      await transcribeProbe();
      result = judgeProbe();
      ctx.log((result.ok ? '✅ ' : '⚠️ ') + result.text);
    } catch (err) {
      result = { ok: false, text: `self-test aborted: ${/** @type {Error} */ (err).message}` };
      ctx.log('❌ ' + result.text);
    } finally {
      player.cancel();
      if (playing) await playing.catch(() => {});
      ctx.pipeline.unsubscribe(SUB);
      ctx.exclusion.release(NAME);
      active = false;
      enterPhase('off');
      setDisabled('acRun', false);
      setDisabled('acStop', true);
      render();
    }
  }

  return {
    name: NAME,
    /** @param {import('./main.js').BenchContext} c */
    start(c) {
      ctx = c;
      setDisabled('acRun', false);
      $('acRun').addEventListener('click', () => void runProbe());
      $('acStop').addEventListener('click', () => { aborted = true; });
    },
    stop() {
      aborted = true;
      tts?.cancel();
      ctx = null;
    },
  };
}
