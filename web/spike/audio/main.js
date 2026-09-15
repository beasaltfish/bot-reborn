// Throwaway probe: does the whole audio path hold up on the phone?
//
// One getUserMedia feeds KWS and VAD from the same 100 ms frames. A VAD
// segment goes to the cloud STT; the transcript is read back by TTS. No LLM,
// no executor, no car — those are already proven by setup.html and part 1.
//
// Five questions, one page:
//   1. does a combined KWS+VAD wasm work at all
//   2. what do KWS and VAD cost together
//   3. how good is STT on a real phone mic (waiting item ⑩)
//   4. how does TTS handle a code-switched sentence (waiting item ⑪)
//   5. does AEC remove the phone's own voice — which decides `bargeIn` (§7.3)

import { OpenAiCompatStt } from '../../providers/stt-openai-compat.js';
import { WebAudioTts } from '../../providers/tts-webaudio.js';

const MODELS = '../../models/kws/';
const RATE = 16000;
const VAD_WINDOW = 512;      // sherpa's silero window; must be fed exactly
const IDLE_TO_SLEEP_MS = 30000;  // spec §5.2

const $ = (id) => document.getElementById(id);

// Long on purpose: the probe needs ~23 s of continuous speech to walk its five
// windows, and a passage that runs out mid-window aborts the run.
//
// Chinese with English spliced into it, also on purpose, and not an oversight
// left over from translating this file: waiting item ⑪ is about how each TTS
// provider handles code-switching, and a monolingual passage would never ask
// the question. Same for READ_LINE below.
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
const fmt = (n, d = 1) => Number(n).toFixed(d);

const logLines = [];
function log(msg) {
  logLines.push(`${new Date().toTimeString().slice(0, 8)}  ${msg}`);
  if (logLines.length > 500) logLines.shift();
  $('log').textContent = logLines.join('\n');
  $('log').scrollTop = $('log').scrollHeight;
}

// --------------------------------------------------------------- config

// Read-only on purpose. This is probe code sharing a storage key with the
// real settings page; writing to it could damage a working setup.
function loadConfig() {
  try { return JSON.parse(localStorage.getItem('voicebot.config') || '{}'); }
  catch { return {}; }
}

// ------------------------------------------------------ keyword checking

let TOKENS = null;
async function loadTokens() {
  const text = await (await fetch(MODELS + 'tokens.txt')).text();
  TOKENS = new Set(text.split('\n').map((l) => l.split(' ')[0]).filter(Boolean));
}
function checkKeywords(text) {
  const bad = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    for (const w of line.trim().split(/\s+/)) {
      if (':#@'.includes(w[0])) continue;
      if (!TOKENS.has(w)) bad.push(w);
    }
  }
  return bad;
}

// ----------------------------------------------------------- wasm module

function loadWasm() {
  return new Promise((resolve, reject) => {
    window.Module = {
      locateFile: (p) => MODELS + p,
      setStatus: (s) => { if (s) $('boot').textContent = s; },
      onRuntimeInitialized: () => resolve(),
      onAbort: (why) => reject(new Error('wasm abort: ' + why)),
      printErr: (s) => log('[wasm] ' + s),
    };
    // Two glue files, one Module — this is the whole point of the combined
    // build. Order matters only in that both must precede the engine.
    const chain = ['sherpa-onnx-kws.js', 'sherpa-onnx-vad.js',
                   'sherpa-onnx-wasm-kws-main.js'];
    (function next(i) {
      if (i === chain.length) return;
      const el = document.createElement('script');
      el.src = MODELS + chain[i];
      el.onload = () => next(i + 1);
      el.onerror = () => reject(new Error('failed to load ' + chain[i]));
      document.body.appendChild(el);
    })(0);
  });
}

function createSpotter() {
  return window.createKws(window.Module, {
    featConfig: { samplingRate: RATE, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: './encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx',
        decoder: './decoder-epoch-13-avg-2-chunk-16-left-64.onnx',
        joiner: './joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx',
      },
      tokens: './tokens.txt',
      provider: 'cpu', numThreads: 1, debug: 0,
    },
    maxActivePaths: 4, numTrailingBlanks: 1,
    keywordsScore: 1.0, keywordsThreshold: 0.25,
    keywords: $('keywords').value.trim(),
  });
}

function createVoiceDetector() {
  return window.createVad(window.Module, {
    sileroVad: {
      model: './silero_vad.onnx',
      threshold: Number($('vadThreshold').value),
      minSilenceDuration: Number($('minSilence').value),
      minSpeechDuration: Number($('minSpeech').value),
      maxSpeechDuration: 20,
      windowSize: VAD_WINDOW,
    },
    tenVad: { model: '', threshold: 0.5, minSilenceDuration: 0.5,
              minSpeechDuration: 0.25, maxSpeechDuration: 20, windowSize: 256 },
    sampleRate: RATE, numThreads: 1, provider: 'cpu', debug: 0,
    bufferSizeInSeconds: 30,
  });
}

// ------------------------------------------------------------- keep-alive
//
// Deliberately only the sound, not the keep-alive machinery: this page's
// question is what the sound does to the noise floor, and the probe runs with
// the screen on, where nothing needs keeping alive. The machinery, and the
// reasoning behind these three shapes, live in spike/kws/main.js.
const KA_WAVES = {
  hum:    { rate: 8000,  secs: 1, carrier: 60 },
  breath: { rate: 8000,  secs: 4, carrier: 220, lfo: 0.25, depth: 0.7 },
  high:   { rate: 48000, secs: 1, carrier: 18000 },
};
const dbToAmp = (db) => 10 ** (db / 20);

function keepAliveWavUrl(wave, amp) {
  const w = KA_WAVES[wave];
  const n = Math.round(w.rate * w.secs);
  const buf = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buf);
  const ascii = (off, t) => {
    for (let i = 0; i < t.length; i++) dv.setUint8(off + i, t.charCodeAt(i));
  };
  ascii(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); ascii(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, w.rate, true); dv.setUint32(28, w.rate * 2, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  ascii(36, 'data'); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / w.rate;
    const env = w.lfo
        ? 1 - w.depth * (0.5 - 0.5 * Math.cos(2 * Math.PI * w.lfo * t))
        : 1;
    dv.setInt16(44 + i * 2,
        Math.sin(2 * Math.PI * w.carrier * t) * amp * env * 32767, true);
  }
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

let kaOn = false;

/** Synchronous, from the click handler, for the autoplay gesture. */
function startKeepAlive() {
  kaOn = $('keepAlive').checked;
  if (!kaOn) return;
  const el = $('ka');
  const db = Number($('kaDb').value);
  if (el.src) URL.revokeObjectURL(el.src);
  el.src = keepAliveWavUrl($('kaWave').value, dbToAmp(db));
  el.volume = 1;
  el.play().then(() => log(`🔈 keep-alive: ${$('kaWave').value} / ${db} dBFS`))
      .catch((err) => log('❌ keep-alive playback failed: ' + err.message));
}

// --------------------------------------------------------- state machine

/** @type {'SLEEPING'|'LISTENING'|'THINKING'|'SPEAKING'} */
let state = 'SLEEPING';
let lastVoiceAt = 0;

function setState(s) {
  if (s === state) return;
  state = s;
  $('state').textContent = s;
  log(`── ${s}`);
}

// ----------------------------------------------------------- the numbers

const st = {
  running: false, wallStart: 0, audioStart: 0,
  frames: 0, frameMs: 100,
  kwsSum: 0, kwsMax: 0, vadSum: 0, vadMax: 0,
  wakes: 0, transcripts: 0,
  speakMs: 0, selfVad: 0, selfKws: 0, speakFrames: 0,
  // The positive control. `selfVad === 0` during playback is ambiguous: it
  // means either "AEC removed the robot and kept you" or "the mic was muted
  // for the duration, so nothing got in at all". Only the input level tells
  // those apart, and the second one makes barge-in impossible.
  rmsSpeakSum: 0, rmsSpeakMax: 0, rmsIdleSum: 0, rmsIdleMax: 0, idleFrames: 0,
  battStart: null, batt: null,
};

function rms(f32) {
  let sum = 0;
  for (let i = 0; i < f32.length; i++) sum += f32[i] * f32[i];
  return Math.sqrt(sum / f32.length);
}

// ------------------------------------------------- guided barge-in probe
//
// The previous measurement could not answer the question it was asking. Every
// frame of playback landed in one bucket, and that bucket mixes three sources:
// the robot's echo that AEC failed to remove, your own voice, and the room.
// `selfVad` was documented as "the robot leaked into VAD" but counted any VAD
// frame during playback — so doing what the page told you to do (talk over it)
// scored as an AEC failure, while staying quiet scored as a pass on the
// strength of echo residue alone. Two errors, pointing opposite ways.
//
// One window cannot separate three sources, so the probe runs to a script and
// the page says the lines. Each window is bucketed on its own, and only the
// comparison between windows means anything:
//
//   floor   no TTS,  you silent       → the room
//   warmup  TTS on,  you silent       → discarded; AEC needs ~1 s to converge
//   quiet   TTS on,  you silent       → the room + whatever echo survived AEC
//   talk    TTS on,  you talking      → the above, plus you
//   settle  TTS on,  you silent again → should fall back to `quiet`
//
// `quiet − floor` is the echo residue: how much of itself the phone still
// hears. `talk − quiet` is the only positive evidence that barge-in can work.

// The line you read, twice: once in silence and once over the robot. It is
// code-switched on purpose — the mixed sentence is the one the spec's waiting
// item ⑩ is actually about, and the one a phone mic is worst at.
const READ_LINE = '往前走三米，然后 turn left，停在红色的箱子旁边';

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
const DEAD = 0.003;      // ≈ −50 dBFS; below this nothing usable reached the mic
const GAIN_MIN = 6;      // dB your voice must add on top of `quiet` to count

const probe = {
  active: false,
  aborted: false,
  phase: 'off',
  bins: {},
  // Raw frames of the two windows where you read the line. Measuring how many
  // dB of your voice survived AEC is a proxy; running both through STT and
  // reading the two transcripts answers the question directly — and a reading
  // that is intact at −8 dB matters more than the −8 dB.
  rec: { control: [], talk: [] },
  stt: null,
  result: null,
};

function joinFrames(chunks) {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Float32Array(n);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// Character error rate against the prompted line. Punctuation and spaces come
// and go between backends and say nothing about the audio, so they are dropped
// before the comparison; `turn left` and `turnleft` must not score as an error.
function normalize(text) {
  return (text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}
function editDistance(a, b) {
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
function cer(ref, hyp) {
  const r = [...normalize(ref)], h = [...normalize(hyp)];
  if (!r.length) return null;
  return editDistance(r, h) / r.length;
}

function newBin() {
  return { frames: 0, sum: 0, max: 0, vad: 0, kws: 0 };
}
const pct = (v) => (v == null ? '—' : `${fmt(v * 100, 0)}%`);
function bin() { return probe.bins[probe.phase] ?? null; }
const avgOf = (b) => (b && b.frames ? b.sum / b.frames : 0);
const dbOf = (v) => (v > 0 ? 20 * Math.log10(v) : -120);
const dbs = (v) => (v > 0 ? `${fmt(dbOf(v), 0)} dB` : '−∞');

let outBuf = null;
/** RMS of what the TTS is putting out right now, straight off its analyser. */
function ttsOutLevel() {
  const a = tts?.analyser;
  if (!a) return 0;
  if (!outBuf || outBuf.length !== a.fftSize) outBuf = new Float32Array(a.fftSize);
  a.getFloatTimeDomainData(outBuf);
  return rms(outBuf);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function showCue(text, sub, count, read = false) {
  $('probeCue').textContent = text;
  $('probeSub').textContent = sub;
  $('probeCount').textContent = count == null ? '' : String(count);
  $('probeLine').textContent = read ? READ_LINE : '';
  $('probeLine').hidden = !read;
  $('probeBar').hidden = !probe.active;
}

function enterPhase(p) {
  probe.phase = p;
  if (p === 'off') { showCue('', '', null); return; }
  log(`◆ ${PHASES[p].cue}（${PHASES[p].ms / 1000} s）`);
  showCue(PHASES[p].cue, PHASES[p].sub, Math.ceil(PHASES[p].ms / 1000), PHASES[p].read);
}

/** Hold one phase for its full length, counting down. */
async function hold(p, requireAudio) {
  enterPhase(p);
  const end = Date.now() + PHASES[p].ms;
  let silentMs = 0;
  while (Date.now() < end) {
    await sleep(100);
    if (probe.aborted) throw new Error('stopped part-way through');
    showCue(PHASES[p].cue, PHASES[p].sub, Math.ceil((end - Date.now()) / 1000),
            PHASES[p].read);
    if (!requireAudio) continue;
    silentMs = ttsOutLevel() > OUT_ON ? 0 : silentMs + 100;
    // Running out of speech mid-window is not a result, it is a broken run:
    // the rest of the window would be measuring silence and reading as a pass.
    if (silentMs > 1000) throw new Error(`it ran out of passage before “${PHASES[p].cue}” finished — lengthen what it reads`);
  }
}

async function waitForAudio(timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (ttsOutLevel() > OUT_ON) return true;
    await sleep(50);
  }
  return false;
}

async function runProbe() {
  if (!st.running) { log('press Start first — the microphone has to be running'); return; }
  if (probe.active) return;

  probe.active = true;
  probe.aborted = false;
  probe.result = null;
  probe.stt = null;
  probe.rec = { control: [], talk: [] };
  for (const p of Object.keys(PHASES)) probe.bins[p] = newBin();
  $('probe').disabled = true;
  log('── barge-in self-test starting; follow the prompts on screen');
  // VAD is only fed outside SLEEPING (§5.3), and the floor window has to be
  // measured with it running — otherwise `floor.vad === 0` means "asleep", not
  // "you were quiet", and the guard that invalidates a noisy run never fires.
  setState('LISTENING');
  lastVoiceAt = Date.now();

  let playing = null;
  try {
    await hold('floor', false);
    await hold('control', false);
    // speak() sets `speaking` immediately but the audio is 1–2 s of fetch and
    // decode away, so the phase stays `control`: nothing is playing yet, and
    // a fixed delay here would eat into `quiet` instead.
    showCue('③ waiting for it to start…', 'TTS is fetching the audio', null);
    playing = speak(SCRIPT_TEXT);
    if (!await waitForAudio(15000)) throw new Error('waited 15 s and TTS never made a sound');
    for (const p of SCRIPT) await hold(p, true);
    tts?.cancel();
    await transcribeProbe();
    probe.result = judgeProbe();
  } catch (err) {
    probe.result = { ok: false, text: `self-test aborted: ${err.message}` };
    log('❌ ' + probe.result.text);
  } finally {
    tts?.cancel();
    if (playing) await playing.catch(() => {});
    probe.active = false;
    enterPhase('off');
    $('probe').disabled = false;
    render();
  }
}

/**
 * The same sentence, twice, through the same STT. A dB figure says how much of
 * your voice survived; this says whether what survived is still transcribable,
 * which is the thing barge-in actually needs. The control run is what separates
 * "AEC damaged it" from "this room and this mic are just hard".
 */
async function transcribeProbe() {
  showCue('⑦ transcribing…', 'sending both recordings to STT — do not close the page', null);
  const out = { ref: READ_LINE };
  for (const k of ['control', 'talk']) {
    const pcm = joinFrames(probe.rec[k]);
    if (!pcm.length) { out[k] = '(nothing was recorded)'; continue; }
    try {
      const t0 = performance.now();
      out[k] = (await stt.transcribe(toInt16(pcm), RATE)).trim();
      log(`📝 ${k === 'control' ? 'control' : 'over playback'} transcript ` +
          `${fmt(performance.now() - t0, 0)} ms：${out[k]}`);
    } catch (err) {
      out[k] = `(STT failed: ${err.message})`;
      log('❌ ' + out[k]);
    }
  }
  out.cerControl = cer(READ_LINE, out.control);
  out.cerTalk = cer(READ_LINE, out.talk);
  probe.stt = out;
}

/**
 * Whether the transcript survived, and whose fault it is if not. Without the
 * control run a bad transcript is unattributable: a phone mic in a live room
 * is hard for STT all by itself, with no AEC involved.
 */
function sttVerdict() {
  const x = probe.stt;
  if (!x || x.cerControl == null || x.cerTalk == null) return '—';
  const gap = x.cerTalk - x.cerControl;
  const both = `control ${pct(x.cerControl)} → over playback ${pct(x.cerTalk)}`;
  if (x.cerControl > 0.3) {
    return `⚠️ ${both}: the control is already this wrong, which is a problem with this microphone or this room. ` +
           'Fix that first; this run says nothing about the AEC';
  }
  if (gap > 0.2) {
    return `⚠️ ${both} (up by ${fmt(gap * 100, 0)} points): the VAD catches it, but what reaches STT is unusable — ` +
           'the first sentence after an interruption will be misheard, so capture has to wait for TTS to stop';
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
  const b = probe.bins;
  if (b.quiet.frames < 30 || b.talk.frames < 30) {
    return { ok: false, text: 'not enough samples — run it again' };
  }
  const floorDb = dbOf(avgOf(b.floor));
  const quietDb = dbOf(avgOf(b.quiet));
  const talkDb = dbOf(avgOf(b.talk));
  const residue = quietDb - floorDb;
  // The mean and the peak disagree on purpose. Suppression pulls the mean of a
  // playing-but-silent window *below* the room floor, while the attack of each
  // phrase still spikes through — a mean-only test read that as "the phone was
  // too quiet to stress AEC", which was exactly backwards.
  const residuePeak = dbOf(b.quiet.max) - dbOf(b.floor.max);
  const gain = talkDb - quietDb;
  const plus = (v) => `${v >= 0 ? '+' : ''}${fmt(v, 1)} dB`;

  if (b.floor.vad > 0) {
    return { ok: false, gain, residue, residuePeak,
      text: `⚠️ the VAD fired on ${b.floor.vad} frames during the noise-floor window — either you were not silent or the room is too loud. This run does not count` };
  }
  if (b.quiet.vad > 0) {
    return { ok: false, gain, residue, residuePeak,
      text: `⚠️ the VAD fired on ${b.quiet.vad} frames while it was speaking and you were not (echo residue ${plus(residue)}) — ` +
            'the AEC is not removing the robot from its own input, so the VAD triggers on its own voice. ' +
            'bargeIn has to be false and interruption can only go through the keyword, which makes §6.8\'s forbidden words mandatory' };
  }
  if (b.quiet.max < DEAD && b.talk.max < DEAD) {
    return { ok: false, gain, residue, residuePeak,
      text: `⛔ almost no signal reached the mic during playback (peak ${dbs(b.talk.max)}) — your voice is being suppressed along with the echo, so even keyword interruption does not hold` };
  }
  if (gain < GAIN_MIN) {
    return { ok: false, gain, residue, residuePeak,
      text: `⛔ your voice only lifted the level by ${plus(gain)} (it needs ≥ ${GAIN_MIN} dB) — ` +
            'the mic is being held down during playback and speech cannot get in. bargeIn = false' };
  }
  if (b.talk.vad === 0) {
    return { ok: false, gain, residue, residuePeak,
      text: `⚠️ the level rose by ${plus(gain)} and yet the VAD caught nothing — the signal does get in, ` +
            'so either the AEC shaved the speech into something that no longer looks like speech, or the VAD threshold is too tight. Tune the threshold and re-run before concluding bargeIn = false' };
  }
  // A flat mean has two readings and the analyser cannot tell them apart — it
  // sees the digital signal, not the speaker. Either the phone was too quiet to
  // put anything into the mic (a pass at 10% volume does not transfer to real
  // use), or AEC is suppressing hard. The peak decides: if the phrase attacks
  // still spike above the room floor, the speaker was audible and AEC earned it.
  const caveat = residue >= 3 ? ''
      : residuePeak >= 6
        ? ` (the mean was pushed below the noise floor while the peak is ${plus(residuePeak)} above it — ` +
          'the AEC clamps hard in steady state and leaks on attack transients, which is normal)'
        : ` (note: mean ${plus(residue)}, peak ${plus(residuePeak)} — almost nothing from the speaker reached the mic. ` +
          'Check the phone is at a normal playback volume; too quiet and this run never tested the AEC at all)';
  return { ok: true, gain, residue, residuePeak,
    text: `✅ zero VAD hits while only it was speaking (echo residue ${plus(residue)}); your voice added ${plus(gain)} and the VAD caught ` +
          `${b.talk.vad} frames → bargeIn = true holds${caveat}` };
}

function render() {
  if (!st.wallStart) return;
  const wall = (Date.now() - st.wallStart) / 1000;
  const fed = st.frames * st.frameMs / 1000;
  const kws = st.frames ? st.kwsSum / st.frames : 0;
  const vad = st.frames ? st.vadSum / st.frames : 0;

  $('elapsed').textContent = `${fmt(wall, 0)} s wall / ${fmt(fed, 0)} s fed`;
  $('alive').textContent = fed >= wall - 5
      ? '✅ audio never dropped out' : `⚠️ ${fmt(wall - fed, 0)} s missing`;
  $('kwsCost').textContent = `mean ${fmt(kws, 2)} ms / peak ${fmt(st.kwsMax, 1)} ms`;
  $('vadCost').textContent = `mean ${fmt(vad, 2)} ms / peak ${fmt(st.vadMax, 1)} ms`;
  $('totalCost').textContent =
      `${fmt(kws + vad, 2)} ms / ${st.frameMs} ms = ${fmt((kws + vad) / st.frameMs * 100, 1)}%`;
  $('counts').textContent = `${st.wakes} / ${st.transcripts}`;

  $('spkTime').textContent = `${fmt(st.speakMs / 1000, 1)} s (${st.speakFrames} frames)`;
  $('selfVad').textContent = String(st.selfVad);
  $('selfKws').textContent = String(st.selfKws);

  // dBFS reads better than a 0–1 RMS here: speech and near-silence differ by
  // orders of magnitude, and a linear number makes "quiet" and "dead" look the
  // same. -60 dB is effectively nothing; normal speech lands around -30..-15.
  const spkAvg = st.speakFrames ? st.rmsSpeakSum / st.speakFrames : 0;
  const idleAvg = st.idleFrames ? st.rmsIdleSum / st.idleFrames : 0;
  $('lvlSpeak').textContent = `mean ${dbs(spkAvg)} / peak ${dbs(st.rmsSpeakMax)}`;
  $('lvlIdle').textContent = `mean ${dbs(idleAvg)} / peak ${dbs(st.rmsIdleMax)}`;

  // The guided probe. These rows are only comparable to each other, which is
  // the whole point — the absolute dBFS of a phone mic means nothing on its
  // own, and it was the single mixed window that made the old verdict wrong.
  const b = probe.bins;
  const row = (id, k, tail = '') => {
    const x = b[k];
    $(id).textContent = !x || !x.frames
        ? '—'
        : `mean ${dbs(avgOf(x))} / peak ${dbs(x.max)}${tail ? ` · ${tail(x)}` : ''}`;
  };
  const vk = (x) => `VAD ${x.vad} frames / KWS ${x.kws}`;
  row('pFloor', 'floor', (x) => `VAD ${x.vad} frames`);
  row('pControl', 'control', vk);
  row('pQuiet', 'quiet', vk);
  row('pTalk', 'talk', vk);
  row('pSettle', 'settle', vk);
  const plus = (v) => `${v >= 0 ? '+' : ''}${fmt(v, 1)} dB`;
  $('pGain').textContent = probe.result?.gain == null ? '—'
      : `${plus(probe.result.gain)} (needs ≥ ${GAIN_MIN} dB)`;
  $('pResidue').textContent = probe.result?.residue == null ? '—'
      : `mean ${plus(probe.result.residue)} / peak ${plus(probe.result.residuePeak)} above the noise floor`;

  $('pRef').textContent = READ_LINE;
  $('pSttControl').textContent = probe.stt?.control ?? '—';
  $('pSttTalk').textContent = probe.stt?.talk ?? '—';
  $('pSttVerdict').textContent = probe.active ? 'self-test running…' : sttVerdict();
  // `bargeIn = true` (spec §5.3) needs both halves: the robot must not reach
  // VAD as speech, AND a human must still get through. One window could show
  // at most one of those, and could not tell which one it was showing.
  $('aecVerdict').textContent = probe.active ? 'self-test running…'
      : probe.result?.text ?? 'no self-test has been run yet (press “Barge-in self-test” above)';

  if (st.batt) {
    $('battery').textContent =
        `${fmt(st.batt.level * 100, 0)}% (down ${fmt((st.battStart - st.batt.level) * 100, 0)}%)`;
  }
  localStorage.setItem('audio-spike', JSON.stringify({
    wall, fed, kws, vad, frameMs: st.frameMs, wakes: st.wakes,
    transcripts: st.transcripts, speakMs: st.speakMs,
    selfVad: st.selfVad, selfKws: st.selfKws, speakFrames: st.speakFrames,
    probe: probe.result ? {
      verdict: probe.result.text,
      bargeIn: probe.result.ok,
      gainDb: probe.result.gain, residueDb: probe.result.residue,
      residuePeakDb: probe.result.residuePeak,
      stt: probe.stt, sttVerdict: sttVerdict(),
      bins: Object.fromEntries(Object.entries(probe.bins).map(([k, x]) => [k, {
        frames: x.frames, avgDb: dbOf(avgOf(x)), maxDb: dbOf(x.max),
        vad: x.vad, kws: x.kws,
      }])),
    } : null,
    keepAlive: kaOn ? { wave: $('kaWave').value, db: Number($('kaDb').value) } : false,
    battDrop: st.batt ? (st.battStart - st.batt.level) * 100 : null,
    at: new Date().toISOString(),
  }));
}

// ------------------------------------------------------------ the wiring

let ctx = null, micStream = null, node = null, wakeLock = null;
let kws = null, kwsStream = null, vad = null;
// Our own remainder buffer instead of sherpa's CircularBuffer: that one is a
// top-level `class` in a classic script, so it lands in the global lexical
// environment and never on `window` — invisible to a module. The VAD wants
// exactly VAD_WINDOW samples per call and our frames are 1600, so something
// has to hold the leftover 64 either way.
let pending = new Float32Array(0);
let stt = null, tts = null;
let speaking = false;

function toInt16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    out[i] = Math.max(-1, Math.min(1, f32[i])) * 32767;
  }
  return out;
}

function onFrame(e) {
  if (e.data.hello) {
    st.frameMs = Math.round(e.data.size / e.data.sampleRate * 1000);
    log(`worklet: ${e.data.sampleRate} Hz, frame ${st.frameMs} ms`);
    return;
  }
  if (!st.running) return;
  const samples = e.data.frame;
  st.frames++;
  const level = rms(samples);
  if (probe.active) {
    // The worklet transfers a fresh buffer each frame, so holding the reference
    // is enough — no copy needed. 8 s at 16 kHz is 256 KB per window.
    probe.rec[probe.phase]?.push(samples);
    const b = bin();
    if (b) {
      b.frames++;
      b.sum += level;
      if (level > b.max) b.max = level;
    }
  }
  if (speaking) {
    st.speakFrames++;
    st.rmsSpeakSum += level;
    if (level > st.rmsSpeakMax) st.rmsSpeakMax = level;
  } else {
    st.idleFrames++;
    st.rmsIdleSum += level;
    if (level > st.rmsIdleMax) st.rmsIdleMax = level;
  }

  // --- KWS: always subscribed, in every state (spec §5.3) ---------------
  let t0 = performance.now();
  kwsStream.acceptWaveform(RATE, samples);
  while (kws.isReady(kwsStream)) {
    kws.decode(kwsStream);
    const r = kws.getResult(kwsStream);
    if (r.keyword.length > 0) {
      kws.reset(kwsStream);
      onKeyword(r.keyword);
    }
  }
  let cost = performance.now() - t0;
  st.kwsSum += cost;
  if (cost > st.kwsMax) st.kwsMax = cost;

  // --- VAD: fed in every state EXCEPT SLEEPING --------------------------
  // During SPEAKING it is fed but not acted on — that is the AEC measurement.
  if (state !== 'SLEEPING') {
    t0 = performance.now();
    const merged = new Float32Array(pending.length + samples.length);
    merged.set(pending); merged.set(samples, pending.length);
    let off = 0;
    for (; off + VAD_WINDOW <= merged.length; off += VAD_WINDOW) {
      vad.acceptWaveform(merged.subarray(off, off + VAD_WINDOW));
    }
    pending = merged.slice(off);
    if (vad.isDetected()) {
      if (speaking) st.selfVad++;
      else lastVoiceAt = Date.now();
      // Per phase, and regardless of `speaking`: a VAD hit in `floor` means you
      // were not quiet and invalidates the run, which is worth knowing.
      if (probe.active) { const b = bin(); if (b) b.vad++; }
    }
    while (!vad.isEmpty()) {
      const seg = vad.front();
      vad.pop();
      if (speaking) {
        // Which voice this was is exactly what a single window cannot tell you.
        // Inside the probe the script does know, because it told you when to
        // talk; outside it, say so instead of guessing.
        const who = !probe.active ? 'source unknown (itself, or you)'
            : probe.phase === 'talk' ? 'the talk window, so it should be you — which is exactly what barge-in needs'
            : 'the quiet window, so it can only be itself';
        log(`⚠️ the VAD cut a segment during playback (${fmt(seg.samples.length / RATE, 2)} s) — ${who}`);
      } else {
        onSegment(seg);
      }
    }
    cost = performance.now() - t0;
    st.vadSum += cost;
    if (cost > st.vadMax) st.vadMax = cost;
  }

  // Not during the probe: its floor and settle windows are deliberate silence,
  // and dropping to SLEEPING there would cut VAD out from under the run.
  if (!probe.active && state === 'LISTENING'
      && Date.now() - lastVoiceAt > IDLE_TO_SLEEP_MS) {
    setState('SLEEPING');
    vad.clear();
    vad.reset();
  }
}

function onKeyword(word) {
  if (speaking) {
    st.selfKws++;
    if (probe.active) {
      const b = bin();
      if (b) b.kws++;
      // Cancelling here would end the window early and leave the rest of the
      // probe measuring silence. Count the hit, keep the script running.
      log(`🎯 KWS hit ${word} during playback — the self-test is running, so TTS is not cut this time`);
      return;
    }
    log(`🎯 KWS hit ${word} during playback — cutting TTS (this is interruption on the bargeIn = false path)`);
    tts.cancel();
    return;
  }
  log(`🎯 KWS hit ${word}`);
  if (word.startsWith('all_stop')) { setState('SLEEPING'); return; }
  st.wakes++;
  lastVoiceAt = Date.now();
  vad.clear();
  vad.reset();
  setState('LISTENING');
}

async function onSegment(seg) {
  const secs = seg.samples.length / RATE;
  log(`🎙 VAD cut ${fmt(secs, 2)} s`);
  if (state === 'SLEEPING') return;
  // Mid-probe this would run STT and then speak the transcript back, and that
  // playback would land on top of the probe's own. The segment is still
  // counted (in onFrame); it just must not start a turn.
  if (probe.active) { log('(self-test running — this segment does not go to STT)'); return; }
  setState('THINKING');
  try {
    const t0 = performance.now();
    const text = await stt.transcribe(toInt16(seg.samples), RATE);
    const dt = performance.now() - t0;
    st.transcripts++;
    log(`📝 STT ${fmt(dt, 0)} ms: ${text}`);
    $('transcript').textContent = text;
    if (!text.trim()) { setState('LISTENING'); return; }
    await speak(text);
  } catch (err) {
    log('❌ STT: ' + err.message);
    setState('LISTENING');
  }
}

async function speak(text) {
  setState('SPEAKING');
  speaking = true;
  const t0 = Date.now();
  try {
    await tts.speak(text);
  } catch (err) {
    log('❌ TTS: ' + err.message);
  }
  st.speakMs += Date.now() - t0;
  speaking = false;
  // Whatever the VAD accumulated from the robot's own voice is not input.
  vad.clear();
  vad.reset();
  lastVoiceAt = Date.now();
  setState('LISTENING');
}

// ------------------------------------------------------------- lifecycle

async function requestWakeLock() {
  if (!navigator.wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => log('Wake Lock was released'));
  } catch (err) { log('Wake Lock failed: ' + err.message); }
}

document.addEventListener('visibilitychange', () => {
  log(`visibility → ${document.visibilityState}`);
  if (document.visibilityState === 'visible' && st.running) requestWakeLock();
});

async function start() {
  const bad = checkKeywords($('keywords').value);
  if (bad.length) { log(`❌ tokens that are not in tokens.txt: ${bad.join(' ')}`); return; }

  $('start').disabled = true;
  startKeepAlive();   // before any await: the autoplay gesture is spent by one
  log('requesting microphone permission… (wait for the system prompt and allow it)');
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, autoGainControl: false, noiseSuppression: false },
    });
    try { ctx = new AudioContext({ sampleRate: RATE }); }
    catch { ctx = new AudioContext(); }
    if (ctx.sampleRate !== RATE) log(`⚠️ actual rate is ${ctx.sampleRate} Hz, not 16 kHz`);
    await ctx.audioWorklet.addModule('capture-worklet.js');

    kws = createSpotter();
    kwsStream = kws.createStream();
    vad = createVoiceDetector();
    pending = new Float32Array(0);
    log('KWS and VAD both created (out of the same wasm module)');

    node = new AudioWorkletNode(ctx, 'capture');
    node.port.onmessage = onFrame;
    ctx.createMediaStreamSource(micStream).connect(node);

    Object.assign(st, {
      frames: 0, kwsSum: 0, kwsMax: 0, vadSum: 0, vadMax: 0,
      wakes: 0, transcripts: 0, speakMs: 0, selfVad: 0, selfKws: 0,
      speakFrames: 0, rmsSpeakSum: 0, rmsSpeakMax: 0,
      rmsIdleSum: 0, rmsIdleMax: 0, idleFrames: 0,
    });
    st.running = true;
    st.wallStart = Date.now();
    st.audioStart = ctx.currentTime;
    lastVoiceAt = Date.now();
    setState('SLEEPING');
    await requestWakeLock();
    if (navigator.getBattery) {
      st.batt = await navigator.getBattery();
      st.battStart = st.batt.level;
    }
    log('▶︎ started. Say “hey steven” to wake it, then say something.');
    $('stop').disabled = false;
    $('probe').disabled = false;
  } catch (err) {
    log('❌ ' + err.message);
    $('start').disabled = false;
  }
}

function stop() {
  st.running = false;
  $('ka').pause();
  kaOn = false;
  tts?.cancel();
  node?.port.close();
  micStream?.getTracks().forEach((t) => t.stop());
  ctx?.close();
  wakeLock?.release();
  wakeLock = null;
  setState('SLEEPING');
  render();
  log('■ stopped.');
  $('stop').disabled = true;
  $('start').disabled = false;
  $('probe').disabled = true;
  if (probe.active) { probe.aborted = true; probe.active = false; enterPhase('off'); }
}

$('start').onclick = start;
$('stop').onclick = stop;
$('say').onclick = () => speak(SCRIPT_TEXT);
$('probe').onclick = runProbe;
$('copy').onclick = () => navigator.clipboard.writeText(
    $('log').textContent + '\n\n' + localStorage.getItem('audio-spike'));

setInterval(render, 2000);

(async () => {
  const cfg = loadConfig();
  const missing = [];
  if (!cfg.stt?.baseURL || !cfg.stt?.apiKey || !cfg.stt?.model) missing.push('STT');
  if (!cfg.tts?.baseURL || !cfg.tts?.apiKey || !cfg.tts?.model) missing.push('TTS');
  if (missing.length) {
    $('cfgWarn').textContent =
        `${missing.join(' and ')} are not configured. Fill them in on setup.html and save; this page only reads the same config.`;
  }
  stt = new OpenAiCompatStt(cfg.stt ?? {});
  tts = new WebAudioTts(cfg.tts ?? {});

  const t0 = performance.now();
  await loadTokens();
  await loadWasm();
  const dt = performance.now() - t0;
  let bytes = 0;
  for (const r of performance.getEntriesByType('resource')) {
    if (r.name.includes('/models/kws/')) bytes += r.transferSize || 0;
  }
  $('boot').textContent =
      `loaded in ${fmt(dt / 1000, 1)} s, ${fmt(bytes / 1048576, 2)} MB actually transferred` +
      (bytes === 0 ? ' (cache hit)' : '');
  log($('boot').textContent);
  $('start').disabled = false;
})().catch((err) => {
  $('boot').textContent = '❌ ' + err.message;
  log('❌ ' + err.message);
});
