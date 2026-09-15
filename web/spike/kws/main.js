// Throwaway spike for spec item ⑤: what does a resident sherpa-onnx KWS cost
// on this phone? Produces four numbers (download size, per-frame cost / frame
// length, battery drain, still-alive after 30 min) and nothing else. None of
// this code is meant to survive into web/.

const MODELS = '../../models/kws/';
const TARGET_RATE = 16000;

const $ = (id) => document.getElementById(id);
const fmt = (n, d = 1) => Number(n).toFixed(d);

// ---------------------------------------------------------------- logging

const logLines = [];
function log(msg) {
  const t = new Date().toTimeString().slice(0, 8);
  logLines.push(`${t}  ${msg}`);
  if (logLines.length > 400) logLines.shift();
  $('log').textContent = logLines.join('\n');
  $('log').scrollTop = $('log').scrollHeight;
}

// ------------------------------------------------------- keyword checking

// A token that is not in tokens.txt does NOT degrade gracefully: sherpa-onnx
// logs "Cannot find ID for token" and calls SHERPA_ONNX_EXIT(-1), which aborts
// the whole wasm module — the page then has to be reloaded before it can try
// again. So the keyword box is validated here, in JS, before createKws() ever
// sees it. This is also what makes the wake-word spelling question (ARPAbet vs
// pinyin, still open) safe to answer by typing rather than by rebuilding.
let TOKENS = null;

async function loadTokens() {
  const text = await (await fetch(MODELS + 'tokens.txt')).text();
  TOKENS = new Set(
      text.split('\n').map((l) => l.split(' ')[0]).filter(Boolean));
  log(`tokens.txt: ${TOKENS.size} tokens`);
}

function checkKeywords(text) {
  const bad = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    for (const w of line.trim().split(/\s+/)) {
      if (':#@'.includes(w[0])) continue;  // :boost  #threshold  @label
      if (!TOKENS.has(w)) bad.push(w);
    }
  }
  return bad;
}

// ------------------------------------------------------------ wasm module

let kws = null;
let stream = null;

function loadWasm() {
  return new Promise((resolve, reject) => {
    // The emscripten glue reads a global `Module`, and its defaults point at
    // the epoch-12 fp32 model that is not in our .data (docs/hardware.md).
    window.Module = {
      locateFile: (path) => MODELS + path,
      setStatus: (s) => { if (s) $('boot').textContent = s; },
      onRuntimeInitialized: () => resolve(),
      onAbort: (why) => reject(new Error('wasm abort: ' + why)),
      printErr: (s) => log('[wasm] ' + s),
    };
    const glue = document.createElement('script');
    glue.src = MODELS + 'sherpa-onnx-kws.js';
    glue.onload = () => {
      const main = document.createElement('script');
      main.src = MODELS + 'sherpa-onnx-wasm-kws-main.js';
      main.onerror = () => reject(new Error('failed to load wasm main'));
      document.body.appendChild(main);
    };
    glue.onerror = () => reject(new Error('failed to load sherpa-onnx-kws.js'));
    document.body.appendChild(glue);
  });
}

function createSpotter() {
  return createKws(window.Module, {
    featConfig: { samplingRate: TARGET_RATE, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: './encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx',
        decoder: './decoder-epoch-13-avg-2-chunk-16-left-64.onnx',
        joiner: './joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx',
      },
      tokens: './tokens.txt',
      provider: 'cpu',
      numThreads: 1,
      debug: 1,  // prints decode_chunk_len and T, i.e. the real chunk in ms
    },
    maxActivePaths: 4,
    numTrailingBlanks: 1,
    keywordsScore: Number($('score').value),
    keywordsThreshold: Number($('threshold').value),
    keywords: $('keywords').value.trim(),
  });
}

// ------------------------------------------------------------- keep-alive
//
// Every screen-off run so far died the same way ~60 s after the page went
// hidden, with the audio clock and the fed clock stopping *together* — not a
// frozen main thread but the capture pipeline itself being shut down. That is
// Android's rule, not Chrome's: an app that is not in the foreground does not
// get the microphone. A tab that is playing audio makes Chrome hold a media
// session, and that keeps it foreground enough to keep the mic.
//
// So: play something, quietly. Two mechanisms at once, because this run asks
// "is it possible at all", not "which half did it":
//   - an <audio> element on a loop with MediaSession metadata. Chrome hangs
//     its media notification on this, and it does not live on the capture
//     AudioContext, so it survives that context being suspended.
//   - an oscillator on the capture context itself.
// 60 Hz at -40 dBFS is well above Chrome's silence threshold (~-60 dBFS, so
// the tab counts as audible) and well below what a phone speaker reproduces
// (they roll off hard under ~300 Hz) — inaudible in the room, and nothing
// meaningful reaches the mic.
// Three shapes to listen to, not to measure. The hiss reported on the first
// run is probably not the tone at all: playing anything powers up the phone's
// amplifier, and an idle amplifier hisses on its own. Set the level to -58
// (just over the silence threshold) and if the hiss is unchanged, that is the
// answer and no waveform will fix it.
const KA_WAVES = {
  // Below what a phone speaker can reproduce, so it comes out as distortion
  // rather than as 60 Hz. Kept because it is what the passing run used.
  hum:    { rate: 8000,  secs: 1, carrier: 60 },
  // A slow swell, four seconds per breath: if it is audible at all it reads as
  // "the thing is alive", not as a fault. 220 Hz is inside the speech band, so
  // this is the one whose effect on the noise floor has to be measured.
  breath: { rate: 8000,  secs: 4, carrier: 220, lfo: 0.25, depth: 0.7 },
  // Above the 8 kHz ceiling of a 16 kHz capture, so it cannot reach KWS at all
  // — but children hear well above where adults stop.
  high:   { rate: 48000, secs: 1, carrier: 18000 },
};

const dbToAmp = (db) => 10 ** (db / 20);

/**
 * One seamless loop of the chosen shape, as a 16-bit WAV built here so there
 * is no asset to ship. Every carrier divides evenly into its window, so the
 * loop point has no click.
 */
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
    // The trough of the breath still has to clear the silence threshold, or
    // the tab flickers out of "audible" once per cycle and the whole trick
    // becomes intermittent. depth 0.7 leaves 30% of the level at the bottom.
    const env = w.lfo
        ? 1 - w.depth * (0.5 - 0.5 * Math.cos(2 * Math.PI * w.lfo * t))
        : 1;
    dv.setInt16(44 + i * 2,
        Math.sin(2 * Math.PI * w.carrier * t) * amp * env * 32767, true);
  }
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

let kaOsc = null, kaLfo = null, kaGain = null, kaMute = null;
let kaOn = false, kaWave = 'hum', kaDb = -40, kaOnlyHidden = false;

function kaDescribe() {
  if (!kaOn) return 'off (control run)';
  const names = { hum: '60 Hz hum', breath: 'breathing', high: '18 kHz' };
  return `${names[kaWave]} / ${kaDb} dBFS` + (kaOnlyHidden ? ' / only while the screen is off' : '');
}

/**
 * Call this synchronously from the click handler. Autoplay is granted on a
 * user gesture and an await in front of it can spend that gesture, which would
 * fail the run for a reason that has nothing to do with what is measured.
 * Even the screen-off-only mode plays once here, so that the element counts as
 * user-started and can be resumed later while the page is already hidden.
 */
function startKeepAliveElement() {
  kaOn = $('keepAlive').checked;
  kaWave = $('kaWave').value;
  kaDb = Number($('kaDb').value);
  kaOnlyHidden = $('kaOnlyHidden').checked;
  $('kaState').textContent = kaDescribe();
  if (!kaOn) { log('keep-alive: off (control run)'); return; }

  const el = $('ka');
  if (el.src) URL.revokeObjectURL(el.src);
  el.src = keepAliveWavUrl(kaWave, dbToAmp(kaDb));
  el.volume = 1;   // the quietness lives in the samples, not here
  el.play().then(() => {
    log(`🔈 keep-alive playing: ${kaDescribe()}`);
    if (kaOnlyHidden && document.visibilityState === 'visible') kaSetPlaying(false);
  }).catch((err) => {
    $('kaState').textContent = '❌ playback failed: ' + err.message;
    log('❌ keep-alive playback failed: ' + err.message + ' (this run does not count as a keep-alive run)');
  });
  if (navigator.mediaSession) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'KWS keep-alive', artist: 'bot-reborn spike',
      });
      navigator.mediaSession.playbackState = 'playing';
    } catch (err) { log('MediaSession setup failed: ' + err.message); }
  }
}

/** The oscillator half, once the capture context exists. */
function startKeepAliveOsc() {
  if (!kaOn || !ctx) return;
  const w = KA_WAVES[kaWave];
  // A carrier above the context's Nyquist frequency does not go silent, it
  // folds back down into an audible whistle — worse than not playing it.
  if (w.carrier * 2 >= ctx.sampleRate) {
    log(`oscillator skipped: ${w.carrier} Hz is above what a ${ctx.sampleRate} Hz ` +
        'context can represent and would alias into a squeal. Only <audio> is sounding here');
    return;
  }
  const amp = dbToAmp(kaDb);
  kaGain = ctx.createGain();
  kaOsc = ctx.createOscillator();
  kaOsc.frequency.value = w.carrier;
  if (w.lfo) {
    kaGain.gain.value = amp * (1 - w.depth / 2);
    kaLfo = ctx.createOscillator();
    kaLfo.frequency.value = w.lfo;
    const swing = ctx.createGain();
    swing.gain.value = amp * (w.depth / 2);
    kaLfo.connect(swing).connect(kaGain.gain);
    kaLfo.start();
  } else {
    kaGain.gain.value = amp;
  }
  kaMute = ctx.createGain();
  kaMute.gain.value = 1;
  kaOsc.connect(kaGain).connect(kaMute).connect(ctx.destination);
  kaOsc.start();
  if (kaOnlyHidden && document.visibilityState === 'visible') kaSetPlaying(false);
  log(`oscillator attached to the capture context (${w.carrier} Hz)`);
}

/** Both halves at once: the element carries the media session, the oscillator
 *  keeps the capture context itself producing output. */
function kaSetPlaying(on) {
  if (!kaOn) return;
  const el = $('ka');
  if (on) {
    el.play().catch((err) => log('❌ could not resume the keep-alive after the screen went off: ' + err.message));
  } else {
    el.pause();
  }
  if (kaMute) kaMute.gain.value = on ? 1 : 0;
  if (navigator.mediaSession) navigator.mediaSession.playbackState = on ? 'playing' : 'paused';
}

function stopKeepAlive() {
  $('ka').pause();
  try { kaOsc?.stop(); kaLfo?.stop(); } catch { /* already stopped with the context */ }
  kaOsc = kaLfo = kaGain = kaMute = null;
  if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused';
  kaOn = false;
}

// -------------------------------------------------------------- the stats

const st = {
  running: false,
  wallStart: 0,     // Date.now() at start
  audioStart: 0,    // ctx.currentTime at start
  frames: 0,        // frames actually fed to KWS
  frameMs: 100,     // length of one frame, measured not assumed
  costSum: 0,
  costMax: 0,
  slow: 0,          // frames whose cost exceeded the frame length
  hits: 0,
  maxLag: 0,        // worst main-thread backlog, seconds
  lastRecv: 0,      // Date.now() of the previous frame
  gaps: 0,          // delivery gaps over 2 s — the freeze signature
  battStart: null,
  batt: null,
};

async function initBattery() {
  if (!navigator.getBattery) {
    $('battery').textContent = 'unavailable (read the battery level in Settings yourself)';
    return;
  }
  const b = await navigator.getBattery();
  st.batt = b;
  st.battStart = b.level;
  log(`battery starts at ${fmt(b.level * 100, 0)}%${b.charging ? ' (CHARGING — the drain figure is void)' : ''}`);
}

function render() {
  if (!st.wallStart) return;
  const wall = (Date.now() - st.wallStart) / 1000;
  const audio = ctx ? ctx.currentTime - st.audioStart : 0;
  const fed = st.frames * st.frameMs / 1000;
  const avg = st.frames ? st.costSum / st.frames : 0;

  $('elapsed').textContent =
      `${fmt(wall, 0)} s wall / ${fmt(audio, 0)} s audio clock / ${fmt(fed, 0)} s fed to KWS`;
  $('alive').textContent = fed >= wall - 5
      ? '✅ audio never dropped out'
      : `⚠️ ${fmt(wall - fed, 0)} s missing (audio clock ${fmt(wall - audio, 0)} s)`;
  $('cost').textContent =
      `mean ${fmt(avg, 2)} ms / peak ${fmt(st.costMax, 2)} ms, frame ${st.frameMs} ms ` +
      `→ ${fmt(avg / st.frameMs * 100, 1)}% of one core (frames over budget: ${st.slow})`;
  $('hits').textContent = String(st.hits);
  $('lag').textContent =
      `worst backlog ${fmt(st.maxLag, 2)} s, delivery gaps over 2 s: ${st.gaps}`;
  $('kaState').textContent = kaDescribe();
  if (st.batt) {
    const drop = (st.battStart - st.batt.level) * 100;
    $('battery').textContent =
        `${fmt(st.batt.level * 100, 0)}% (down ${fmt(drop, 0)}%)` +
        (st.batt.charging ? ' — charging, so this number is useless' : '');
  }
  // Survives a reload, and is readable after the phone has been face-down for
  // half an hour with the screen off and nothing repainting.
  localStorage.setItem('kws-spike', JSON.stringify({
    wall, audio, fed, avg, max: st.costMax, frameMs: st.frameMs,
    hits: st.hits, slow: st.slow, maxLag: st.maxLag, gaps: st.gaps,
    keepAlive: kaOn, kaWave, kaDb, kaOnlyHidden,
    battDrop: st.batt ? (st.battStart - st.batt.level) * 100 : null,
    at: new Date().toISOString(),
  }));
}

// ------------------------------------------------------------ audio + run

let ctx = null;
let micStream = null;
let node = null;
let wakeLock = null;

function downsample(input, from) {
  if (from === TARGET_RATE) return input;
  const ratio = from / TARGET_RATE;
  const out = new Float32Array(Math.round(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.round(i * ratio), b = Math.round((i + 1) * ratio);
    let sum = 0;
    for (let j = a; j < b && j < input.length; j++) sum += input[j];
    out[i] = sum / Math.max(1, b - a);
  }
  return out;
}

function onFrame(e) {
  if (e.data.hello) {
    st.frameMs = Math.round(e.data.size / e.data.sampleRate * 1000);
    log(`worklet: ${e.data.sampleRate} Hz, frame ${e.data.size} samples = ${st.frameMs} ms`);
    return;
  }
  if (!st.running) return;

  const now = Date.now();
  if (st.lastRecv && now - st.lastRecv > 2000) {
    st.gaps++;
    log(`⚠️ delivery gap of ${fmt((now - st.lastRecv) / 1000, 1)} s`);
  }
  st.lastRecv = now;
  st.maxLag = Math.max(st.maxLag, ctx.currentTime - e.data.tEnd);

  const samples = downsample(e.data.frame, ctx.sampleRate);
  const t0 = performance.now();
  stream.acceptWaveform(TARGET_RATE, samples);
  while (kws.isReady(stream)) {
    kws.decode(stream);
    const r = kws.getResult(stream);
    if (r.keyword.length > 0) {
      st.hits++;
      log(`🎯 hit #${st.hits}: ${JSON.stringify(r)}`);
      kws.reset(stream);  // required right after a hit
    }
  }
  const cost = performance.now() - t0;

  st.frames++;
  st.costSum += cost;
  if (cost > st.costMax) st.costMax = cost;
  if (cost > st.frameMs) st.slow++;
}

async function requestWakeLock() {
  if (!navigator.wakeLock) { log('no Wake Lock API here'); return; }
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    log('Wake Lock acquired');
    wakeLock.addEventListener('release', () => log('Wake Lock was released'));
  } catch (err) {
    log('Wake Lock failed: ' + err.message);
  }
}

document.addEventListener('visibilitychange', () => {
  const hidden = document.visibilityState === 'hidden';
  log(`visibility → ${document.visibilityState}`);
  // Pressing the power button hides the page and drops the lock; spec §5.7
  // wants it back the moment the page is visible again.
  if (!hidden && st.running) requestWakeLock();
  // The hiss only matters when someone's ear is near the phone, and that never
  // happens while the car is driving with the screen off. So: play it only
  // then. This fires before the ~60 s cutoff, so the keep-alive is up in time.
  if (st.running && kaOn && kaOnlyHidden) kaSetPlaying(hidden);
});

async function start() {
  const bad = checkKeywords($('keywords').value);
  if (bad.length) {
    log(`❌ these tokens are not in tokens.txt and would abort the wasm module outright: ${bad.join(' ')}`);
    return;
  }

  $('start').disabled = true;
  // Before any await: see startKeepAliveElement().
  startKeepAliveElement();
  // The permission prompt can sit there for a while, and until it is answered
  // the page has nothing to show — which looks exactly like a dead button.
  log('requesting microphone permission… (wait for the system prompt below and allow it)');
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      // Copied from spec §5.1 on purpose: the cost we want is the cost under
      // the configuration the real thing will use.
      audio: { echoCancellation: true, autoGainControl: false, noiseSuppression: false },
    });

    try {
      ctx = new AudioContext({ sampleRate: TARGET_RATE });
    } catch {
      ctx = new AudioContext();
    }
    if (ctx.sampleRate !== TARGET_RATE) {
      log(`⚠️ could not get 16 kHz; actual rate is ${ctx.sampleRate} Hz, resampling on the main thread`);
    }
    await ctx.audioWorklet.addModule('capture-worklet.js');

    kws = createSpotter();
    stream = kws.createStream();
    log('spotter created');

    node = new AudioWorkletNode(ctx, 'capture');
    node.port.onmessage = onFrame;
    ctx.createMediaStreamSource(micStream).connect(node);
    // The capture path is not connected to destination: nothing of the mic
    // comes back out. The keep-alive oscillator is a separate branch.
    startKeepAliveOsc();

    // A second run must not inherit the first run's totals — a 30 minute
    // measurement quietly averaged with a 20 second smoke test is worse than
    // no measurement.
    Object.assign(st, {
      frames: 0, costSum: 0, costMax: 0, slow: 0, hits: 0, maxLag: 0, gaps: 0,
    });
    st.running = true;
    st.wallStart = Date.now();
    st.audioStart = ctx.currentTime;
    st.lastRecv = 0;
    await requestWakeLock();
    await initBattery();
    log('▶︎ started. Lock the screen for 30 minutes, come back, press Stop, then read the figures.');
    $('stop').disabled = false;
  } catch (err) {
    log('❌ ' + err.message);
    $('start').disabled = false;
  }
}

function stop() {
  st.running = false;
  stopKeepAlive();
  node?.port.close();
  micStream?.getTracks().forEach((t) => t.stop());
  ctx?.close();
  wakeLock?.release();
  wakeLock = null;
  render();
  log('■ stopped. The four figures are above; copy them into docs/hardware.md.');
  $('stop').disabled = true;
  $('start').disabled = false;
}

// ---------------------------------------------------------------- startup

// 2 s, not rAF: once the screen is off rAF stops but the counters must keep
// being flushed to localStorage, which is the only thing readable afterwards
// if the tab gets killed.
setInterval(render, 2000);

$('start').onclick = start;
$('stop').onclick = stop;
// A keep-alive that gets paused out from under us (another app taking the
// media session, the system stopping it) explains a failed run that would
// otherwise look like the keep-alive simply not working.
$('ka').addEventListener('pause', () => {
  if (kaOn) log('⚠️ the keep-alive got paused — the system or another app took playback away');
});
$('ka').addEventListener('error', () => log('❌ keep-alive errored'));
// Comparing three waveforms by ear should not cost three microphone grants and
// three model loads. These play sound and nothing else.
//
// The two halves get their own buttons because the first report back was "the
// audition does nothing", and at -40 dBFS that has three different causes with
// the same symptom: it is playing and is correctly inaudible at arm's length,
// the element failed to play, or the speaker path is not producing anything at
// all. The -20 dBFS button settles the third; separate buttons settle which
// half is making the hiss.
function audState(text) { $('kaAudState').textContent = text; log(text); }

let audCtx = null, audOsc = null, audLfo = null;

function stopAudition() {
  $('ka').pause();
  try { audOsc?.stop(); audLfo?.stop(); } catch { /* not started */ }
  audOsc = audLfo = null;
}

function auditionElement(db) {
  stopAudition();
  const el = $('ka');
  const wave = $('kaWave').value;
  if (el.src) URL.revokeObjectURL(el.src);
  el.src = keepAliveWavUrl(wave, dbToAmp(db));
  el.volume = 1;
  el.play()
      .then(() => audState(`▶ <audio> playing: ${wave} / ${db} dBFS — put your ear to the speaker`))
      .catch((err) => audState('❌ <audio> playback failed: ' + err.message));
}

function auditionOsc(db) {
  stopAudition();
  const wave = $('kaWave').value;
  const w = KA_WAVES[wave];
  // Its own context, at the device's own rate: the capture context runs at
  // 16 kHz, where the 18 kHz option would fold back into an audible whistle
  // and the audition would be of the wrong sound entirely.
  audCtx = audCtx ?? new AudioContext();
  audCtx.resume();
  const amp = dbToAmp(db);
  const g = audCtx.createGain();
  audOsc = audCtx.createOscillator();
  audOsc.frequency.value = w.carrier;
  if (w.lfo) {
    g.gain.value = amp * (1 - w.depth / 2);
    audLfo = audCtx.createOscillator();
    audLfo.frequency.value = w.lfo;
    const swing = audCtx.createGain();
    swing.gain.value = amp * (w.depth / 2);
    audLfo.connect(swing).connect(g.gain);
    audLfo.start();
  } else {
    g.gain.value = amp;
  }
  audOsc.connect(g).connect(audCtx.destination);
  audOsc.start();
  audState(`▶ oscillator playing: ${wave} / ${db} dBFS (context ${audCtx.sampleRate} Hz)`);
}

$('kaAudition').onclick = () => auditionElement(Number($('kaDb').value));
$('kaAuditionOsc').onclick = () => auditionOsc(Number($('kaDb').value));
$('kaAuditionLoud').onclick = () => auditionElement(-20);
$('kaAuditionStop').onclick = () => { stopAudition(); audState('■ audition stopped'); };
$('copy').onclick = () => navigator.clipboard.writeText(
    $('log').textContent + '\n\n' + localStorage.getItem('kws-spike'));

(async () => {
  const t0 = performance.now();
  await loadTokens();
  await loadWasm();
  const dt = performance.now() - t0;

  // Transfer size is what actually crossed the network (brotli from Pages),
  // which is the number spec §9.1 guessed at. It reads 0 on a cache hit.
  let bytes = 0;
  for (const r of performance.getEntriesByType('resource')) {
    if (r.name.includes('/models/kws/')) bytes += r.transferSize || 0;
  }
  $('boot').textContent =
      `loaded in ${fmt(dt / 1000, 1)} s, ${fmt(bytes / 1048576, 2)} MB actually transferred` +
      (bytes === 0 ? ' (cache hit — the first run is the number that counts)' : '');
  log($('boot').textContent);

  const prev = localStorage.getItem('kws-spike');
  if (prev) log('previous readings: ' + prev);

  $('start').disabled = false;
})().catch((err) => {
  $('boot').textContent = '❌ ' + err.message;
  log('❌ ' + err.message);
});
