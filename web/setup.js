// Connectivity-test page and typed end-to-end driver (task 12).
//
// entry file: allowed to touch document/navigator at the top level (spec §10's
// exception). localStorage is not touched here at all any more — config.js is
// the only module in the app that does, so that §8.2's schema has exactly one
// definition instead of one per page.

import { CONFIG_KEY, loadConfig, saveConfig } from './config.js';
import { Ftdi } from './ftdi.js';
import { Executor } from './executor.js';
import { OpenAiCompatStt } from './providers/stt-openai-compat.js';
import { OpenAiCompatLlm } from './providers/llm-openai-compat.js';
import { WebAudioTts } from './providers/tts-webaudio.js';
import { Brain, TOOLS, buildSystemPrompt } from './brain.js';
import { AudioPipeline, RATE } from './audio/pipeline.js';
import { joinFrames, toInt16 } from './audio/pcm.js';
import { encodeWav } from './audio/wav.js';
import { matchFixture, saveFixture, recordedAt } from './fixture-store.js';

/**
 * @typedef {import('./config.js').Config} Config
 * @typedef {import('./config.js').Layer} Layer
 * The form only knows the three provider layers; the four preferences beside
 * them (§8.2) are produced by voice and by §7.3's calibration, not typed in.
 * @typedef {Pick<Config, 'stt' | 'llm' | 'tts'>} ProviderLayers
 */

// --- Typed DOM helpers (Ruling P2: keep strict, no @ts-nocheck) -----------
// Same convention as bench.js.

const el = (/** @type {string} */ id) =>
  /** @type {HTMLElement} */ (document.getElementById(id));

/** @param {string} name */
function namedInput(name) {
  return /** @type {HTMLInputElement} */ (document.querySelector(`input[name="${name}"]`));
}

// --- One AudioContext for the whole page ----------------------------------
//
// Chrome hard-caps a document at 6 AudioContexts and throws on the seventh:
//   "Failed to construct 'AudioContext': the number of hardware contexts
//    provided (6) is greater than or equal to the maximum bound (6)"
// and the page is bricked until reload. Every `new WebAudioTts()` builds one
// unless it is handed one, and this page constructs a TTS provider on every
// test click plus one more in ensureBrain() — while calibration ⑪ (spec §12)
// is literally "listen to the same sentence through each TTS provider in
// turn": edit the config, click again, once per provider. The page would break
// doing the exact thing it exists for.
//
// Lazy, not module-level: constructing it before a user gesture gets a
// suspended context and a console warning for nothing.

/** @type {AudioContext | null} */
let sharedCtx = null;

/** @returns {AudioContext} */
function audioContext() {
  if (!sharedCtx) sharedCtx = new AudioContext();
  return sharedCtx;
}

/** @param {string} name */
function testButton(name) {
  return /** @type {HTMLButtonElement} */ (document.querySelector(`[data-test="${name}"]`));
}

// --- Config form: read the live values, fill from a loaded config ---------

/** @returns {ProviderLayers} */
function readForm() {
  return {
    stt: {
      baseURL: namedInput('stt.baseURL').value.trim(),
      apiKey: namedInput('stt.apiKey').value.trim(),
      model: namedInput('stt.model').value.trim(),
    },
    llm: {
      baseURL: namedInput('llm.baseURL').value.trim(),
      apiKey: namedInput('llm.apiKey').value.trim(),
      model: namedInput('llm.model').value.trim(),
    },
    tts: {
      baseURL: namedInput('tts.baseURL').value.trim(),
      apiKey: namedInput('tts.apiKey').value.trim(),
      model: namedInput('tts.model').value.trim(),
      voice: namedInput('tts.voice').value.trim(),
    },
  };
}

/** @param {ProviderLayers} cfg */
function fillForm(cfg) {
  namedInput('stt.baseURL').value = cfg.stt.baseURL;
  namedInput('stt.apiKey').value = cfg.stt.apiKey;
  namedInput('stt.model').value = cfg.stt.model;
  namedInput('llm.baseURL').value = cfg.llm.baseURL;
  namedInput('llm.apiKey').value = cfg.llm.apiKey;
  namedInput('llm.model').value = cfg.llm.model;
  namedInput('tts.baseURL').value = cfg.tts.baseURL;
  namedInput('tts.apiKey').value = cfg.tts.apiKey;
  namedInput('tts.model').value = cfg.tts.model;
  namedInput('tts.voice').value = cfg.tts.voice;
}

/** @param {Layer} cfg @param {string} label */
function assertFilled(cfg, label) {
  if (!cfg.baseURL || !cfg.apiKey || !cfg.model) {
    throw new Error(`fill in ${label}'s baseURL / apiKey / model under Configuration above first`);
  }
}

el('cfgForm').addEventListener('submit', (event) => {
  event.preventDefault();
  // Merge, never replace: this form only knows the three provider layers, and
  // overwriting the stored config with it would drop lang / replyLang /
  // bargeIn / ttsPath. A calibrated `bargeIn: false` silently reverting to the
  // default is the exact failure config.js's `??` is there to prevent — it
  // must not come back in through the save path instead.
  saveConfig({ ...loadConfig(), ...readForm() });
  el('cfgStatus').textContent = `saved to localStorage (${CONFIG_KEY})`;
});

fillForm(loadConfig());

// --- USB connect ------------------------------------------------------------
//
// WebUSB's requestDevice() needs a user gesture, so this cannot happen on
// page load — a dedicated button, then the Ftdi/Executor pair is reused by
// both the USB connectivity test and the typed-drive section below.

/** @type {Ftdi | null} */
let ftdi = null;
/** @type {Executor | null} */
let executor = null;

/** @param {string} text */
function setUsbStatus(text) {
  el('usbStatus').textContent = `Status: ${text}`;
}

/** @returns {Ftdi} */
function requireFtdi() {
  if (!ftdi) throw new Error('press “Connect the FT232H” above first');
  return ftdi;
}

el('connectBtn').addEventListener('click', async () => {
  const usb = navigator.usb;
  if (!usb) {
    setUsbStatus('this browser has no WebUSB (needs a Chromium engine: Chrome / Edge)');
    return;
  }
  try {
    const opened = await Ftdi.open(usb);
    ftdi = opened;
    // Executor's constructor wires ftdi.onDisconnect itself (spec §4.6) — do
    // not also set it here, that would just overwrite Executor's own handler.
    executor = new Executor(opened, {
      onError: (err) => {
        setUsbStatus(`!! ${err.message}`);
        logTurn(`!! executor: ${err.message}`);
      },
    });
    setUsbStatus('connected');
    logTurn('USB connected');
  } catch (err) {
    const e = /** @type {Error} */ (err);
    setUsbStatus(`connect failed: ${e.message}`);
  }
});

// --- Connectivity tests (spec §9.3) -----------------------------------------
//
// Every test exercises the hardest case on purpose — an easy input passing
// tells you nothing. See web/fixtures/README.md for why the three STT
// fixtures are what they are.

// `say` is what the recorder puts on screen, so the three sentences have one
// definition rather than one here and one in fixtures/README.md. They are not
// UI text and are never translated: they are the audio under test, and the
// third one only tests code-switching while it stays exactly this shape.
const STT_FIXTURES = /** @type {const} */ ([
  { path: 'fixtures/zh.wav', label: 'Chinese', say: '往前开两秒然后左转' },
  { path: 'fixtures/en.wav', label: 'English', say: 'keep going forward until I say stop' },
  { path: 'fixtures/mixed.wav', label: 'mixed in one sentence', say: '这个 sentence 里的 transition word 用得对吗' },
]);

/**
 * The one place a fixture is read, whether it was recorded on this page or
 * dropped into web/fixtures/ with ffmpeg. Both arrive as a Response carrying
 * audio/wav (that is why fixture-store.js is a Cache and not a database), so
 * the test and the recorder's status line share a single code path instead of
 * each deciding for itself what "present" means.
 * @param {string} path
 * @returns {Promise<{ response: Response, source: 'recording' | 'file' } | null>}
 */
async function loadFixture(path) {
  const recorded = await matchFixture(path);
  if (recorded) return { response: recorded, source: 'recording' };

  const response = await fetch(path);
  // Cloudflare Pages (wrangler pages dev included) does not 404 a missing
  // static path — it falls back to serving index.html with status 200.
  // response.ok alone would call that "found" and hand decodeAudioData an
  // HTML page, which fails with a cryptic decode error instead of ever
  // saying the clip is missing. The content-type gives it away: a real .wav
  // is never served as text/html.
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok || contentType.includes('text/html')) return null;
  return { response, source: 'file' };
}

/** @param {AudioBuffer} buffer @returns {{ pcm: Int16Array, sampleRate: number }} */
function toInt16Pcm(buffer) {
  const float = buffer.getChannelData(0);
  const pcm = new Int16Array(float.length);
  for (let i = 0; i < float.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float[i]));
    pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return { pcm, sampleRate: buffer.sampleRate };
}

/** @param {OpenAiCompatStt} stt @returns {Promise<string>} */
async function testStt(stt) {
  // Borrow the shared context rather than opening (and closing) one per click:
  // see audioContext() for why this page counts its AudioContexts.
  const ctx = audioContext();
  const lines = [];
  for (const fixture of STT_FIXTURES) {
    const found = await loadFixture(fixture.path);
    if (!found) {
      throw new Error(
        `${fixture.path} has not been recorded, and this test must not be skipped silently.\n\n`
        + `Record 「${fixture.say}」 under Fixtures above.`);
    }
    const audioBuffer = await ctx.decodeAudioData(await found.response.arrayBuffer());
    const { pcm, sampleRate } = toInt16Pcm(audioBuffer);
    const text = await stt.transcribe(pcm, sampleRate);
    lines.push(`${fixture.label}: ${text || '(empty)'}`);
  }
  return lines.join('\n');
}

/**
 * Two assertions, because "can chat" and "can call tools" are different
 * capabilities and a provider can have the first without the second.
 * @param {OpenAiCompatLlm} llm @returns {Promise<string>}
 */
async function testLlm(llm) {
  const chat = await llm.chat(
    [{ role: 'user', content: 'Reply with exactly: ok' }], TOOLS);
  if (!chat.text) throw new Error('the model returned no text');

  const tool = await llm.chat(
    [{ role: 'system', content: buildSystemPrompt({ replyLang: null, bargeIn: true }) },
      { role: 'user', content: 'go forward for one second' }], TOOLS);
  if (tool.toolCalls.length === 0) {
    throw new Error('the model can chat but did not call a tool — tool calling is unusable on this provider');
  }
  return `text ✅ “${chat.text}” · tool ✅ ${tool.toolCalls[0].name}`;
}

/** @param {WebAudioTts} tts @returns {Promise<string>} */
async function testTts(tts) {
  const text = '「往前走」的英文是 go forward';
  await tts.speak(text);
  return `played 「${text}」 — were both languages intelligible? (your ears decide this one, not the code)`;
}

/** @param {Ftdi} dev @returns {Promise<string>} */
async function testUsb(dev) {
  await dev.write(dev.buildStream(0x10, 200));
  return 'sent 200 ms of forward — did the car move?';
}

/** @param {HTMLElement} target @param {string} text @param {'ok' | 'error' | 'pending'} state */
function setResult(target, text, state) {
  target.textContent = text;
  target.className = `result ${state}`;
}

/** @param {string} name @returns {Promise<string>} */
async function performTest(name) {
  const cfg = readForm();
  switch (name) {
    case 'stt':
      assertFilled(cfg.stt, 'STT');
      return testStt(new OpenAiCompatStt(cfg.stt));
    case 'llm':
      assertFilled(cfg.llm, 'LLM');
      return testLlm(new OpenAiCompatLlm(cfg.llm));
    case 'tts':
      assertFilled(cfg.tts, 'TTS');
      // TTS is the one layer with a fourth required field (spec §8.2) —
      // assertFilled only checks the three ProviderCfg fields, so voice
      // needs its own check or an empty one would reach the API silently.
      if (!cfg.tts.voice) throw new Error('fill in the TTS voice under Configuration above first');
      return testTts(new WebAudioTts(cfg.tts, { audioContext: audioContext() }));
    case 'usb':
      return testUsb(requireFtdi());
    default:
      throw new Error(`unknown test "${name}"`);
  }
}

/** @param {string} name */
async function runConnectivityTest(name) {
  const button = testButton(name);
  const resultEl = el(`${name}Result`);
  button.disabled = true;
  setResult(resultEl, 'testing…', 'pending');
  try {
    const message = await performTest(name);
    setResult(resultEl, message, 'ok');
  } catch (err) {
    const e = /** @type {Error} */ (err);
    setResult(resultEl, `❌ ${e.message}`, 'error');
  } finally {
    button.disabled = false;
  }
}

for (const button of document.querySelectorAll('[data-test]')) {
  const btn = /** @type {HTMLButtonElement} */ (button);
  const name = btn.dataset.test;
  if (!name) continue;
  btn.addEventListener('click', () => { runConnectivityTest(name); });
}

// --- Recording the fixtures (spec §9.3) ------------------------------------
//
// The three clips have to be in your own voice (web/fixtures/README.md), and
// on a phone there is no repo to drop a file into and no ffmpeg to make one —
// so the page that needs them is the only place that can collect them. The
// rows are built from STT_FIXTURES rather than written into setup.html so
// that "which clips exist" has one definition.
//
// Recording sits above the tests and the tests gain no side effect from it: a
// clip that was never recorded still fails the STT test loudly, it just points
// at this section now instead of at a command line.

/** A forgotten Stop should cost a re-record, not a ten-minute clip. */
const RECORD_CAP_MS = 15000;
const RECORDER_SUB = 'setup-fixture-recorder';

/** @type {Promise<AudioPipeline> | null} */
let micPipeline = null;

/**
 * Started on the first Record click and then held for the life of the page.
 * §5.3: capture is turned on and off by subscribing, not by stopping the
 * track — stopping it would spend a permission prompt on every single clip.
 * A failed start is not cached, or a denied permission would be permanent
 * until reload even after the user grants it.
 */
function microphone() {
  if (!micPipeline) {
    micPipeline = AudioPipeline.start().catch((err) => { micPipeline = null; throw err; });
  }
  return micPipeline;
}

/** @typedef {{ status: HTMLElement, record: HTMLButtonElement, play: HTMLButtonElement }} FixtureRow */

/** @type {Map<string, FixtureRow>} */
const fixtureRows = new Map();

/** @type {{ path: string, finish: () => void } | null} */
let recording = null;

/** @param {string} label @returns {HTMLButtonElement} */
function rowButton(label) {
  const button = document.createElement('button');
  button.textContent = label;
  return button;
}

for (const fixture of STT_FIXTURES) {
  const item = document.createElement('li');

  const say = document.createElement('p');
  say.className = 'say';
  // Not a label but the material: lang="" keeps a browser from picking a font
  // per the page's lang="en" and rendering the Chinese in it.
  say.lang = fixture.path === 'fixtures/en.wav' ? 'en' : 'zh';
  say.textContent = fixture.say;

  const controls = document.createElement('div');
  controls.className = 'controls';
  const record = rowButton('Record');
  const play = rowButton('Play');
  play.disabled = true;
  controls.append(record, play);

  const status = document.createElement('span');
  status.className = 'result';

  item.append(say, controls, status);
  el('fixtures').append(item);
  fixtureRows.set(fixture.path, { status, record, play });

  record.addEventListener('click', () => { toggleRecording(fixture.path); });
  play.addEventListener('click', () => { playFixture(fixture.path); });
}

/** @param {string} path */
async function refreshFixtureRow(path) {
  const row = fixtureRows.get(path);
  if (!row) return;
  const found = await loadFixture(path);
  row.play.disabled = !found;
  if (!found) {
    setResult(row.status, 'not recorded yet', 'pending');
    return;
  }
  if (found.source === 'file') {
    // Already on disk via ffmpeg. Saying so beats "not recorded", which would
    // be a lie the STT test then contradicts by passing.
    setResult(row.status, `${path} on disk`, 'ok');
    return;
  }
  const when = recordedAt(found.response);
  // The date is here because a recorded fixture is a moving baseline in a way
  // a committed file is not: comparing two models is only meaningful while
  // both heard the same take, and this is what makes "same take" visible.
  setResult(row.status, `recorded ${when ? when.toLocaleString() : 'earlier'}`, 'ok');
}

/** @param {string} path */
async function toggleRecording(path) {
  // Any Record button stops the take in progress — a second concurrent
  // subscriber would interleave two clips into both files.
  if (recording) { recording.finish(); return; }

  const row = fixtureRows.get(path);
  const fixture = STT_FIXTURES.find((f) => f.path === path);
  if (!row || !fixture) return;

  setResult(row.status, 'starting the microphone…', 'pending');
  /** @type {AudioPipeline} */
  let pipeline;
  try {
    pipeline = await microphone();
  } catch (err) {
    setResult(row.status, `❌ ${/** @type {Error} */ (err).message}`, 'error');
    return;
  }

  /** @type {Float32Array[]} */
  const frames = [];
  const startedAt = Date.now();
  row.record.textContent = 'Stop';
  for (const [other, r] of fixtureRows) if (other !== path) r.record.disabled = true;

  await new Promise((resolve) => {
    const cap = setTimeout(finish, RECORD_CAP_MS);
    function finish() {
      clearTimeout(cap);
      pipeline.unsubscribe(RECORDER_SUB);
      recording = null;
      resolve(undefined);
    }
    recording = { path, finish };
    pipeline.subscribe(RECORDER_SUB, (frame) => {
      frames.push(frame);
      const seconds = (Date.now() - startedAt) / 1000;
      setResult(row.status, `recording… ${seconds.toFixed(1)} s — click Stop when the sentence is finished`, 'pending');
    });
  });

  row.record.textContent = 'Record';
  for (const r of fixtureRows.values()) r.record.disabled = false;

  if (frames.length === 0) {
    // Not the same failure as a short clip: the mic was open and delivered
    // nothing, which a saved 44-byte file would hide behind an empty
    // transcript later.
    setResult(row.status, '❌ the microphone delivered no audio — nothing was saved', 'error');
    return;
  }

  try {
    await saveFixture(path, encodeWav(toInt16(joinFrames(frames)), RATE));
  } catch (err) {
    setResult(row.status, `❌ ${/** @type {Error} */ (err).message}`, 'error');
    return;
  }
  await refreshFixtureRow(path);
}

/**
 * Listening back is not a convenience. A clip where the sentence got clipped,
 * or where the two languages in `mixed.wav` fell either side of a pause, still
 * transcribes into something plausible — so the STT test goes green while the
 * case §9.3 cares about was never in the audio at all. Only your ears catch it.
 * @param {string} path
 */
async function playFixture(path) {
  const row = fixtureRows.get(path);
  const found = await loadFixture(path);
  if (!row || !found) return;
  const ctx = audioContext();
  const source = ctx.createBufferSource();
  source.buffer = await ctx.decodeAudioData(await found.response.arrayBuffer());
  source.connect(ctx.destination);
  source.start();
}

for (const fixture of STT_FIXTURES) refreshFixtureRow(fixture.path);

// --- Typed drive: the full chain minus the microphone ----------------------

/** @type {Brain | null} */
let brain = null;
/** @type {Executor | null} */
let brainExecutor = null;

/**
 * Built lazily against the currently-connected executor, and rebuilt only
 * when a *different* executor shows up (a reconnect) — never on every send,
 * because that would throw away Brain's own conversation history and the
 * replyLang preference set_reply_language may have written into it (spec
 * §6.4, §11.1). Editing the config after this point requires reconnecting.
 * @param {Executor} exec
 * @returns {Brain}
 */
function ensureBrain(exec) {
  if (brain && brainExecutor === exec) return brain;
  const cfg = readForm();
  brain = new Brain({
    llm: new OpenAiCompatLlm(cfg.llm),
    executor: logged(exec),
    tts: loggedTts(new WebAudioTts(cfg.tts, { audioContext: audioContext() })),
    // Real earcons are earcon.js, which belongs to the second plan (spec
    // §5.6). Here they are log lines: this page tests the chain, not the
    // sound design.
    earcon: (name) => logTurn(`♪ ${name}`),
    config: { lang: 'zh', replyLang: null, bargeIn: true },
  });
  brainExecutor = exec;
  return brain;
}

// --- What the model actually did, in the log ------------------------------
//
// Calibration ⑨ (spec §12) asks the human to count, over 20 real turns, how
// many replies are pure restatement carrying zero information, and
// to decide from that whether §6.3 should go back to discarding `content`.
// With only `♪ done` in the log there is nothing to count. The two things ⑨
// needs are the dispatched actions and the spoken sentence, so both go through
// a thin decorator on the way to Brain. Brain itself learns nothing about the
// DOM from this: it still sees an executor and a tts.

/** @param {Executor} exec */
function logged(exec) {
  return {
    get connected() { return exec.connected; },
    /** @param {Array<{ drive: string, steer: string, duration_ms: number }>} steps */
    move(steps) {
      logTurn(`→ move ${steps.map((s) => `${s.drive}+${s.steer} ${s.duration_ms}ms`).join(' → ')}`);
      return exec.move(steps);
    },
    /** @param {string} drive @param {string} steer */
    cruise(drive, steer) {
      logTurn(`→ cruise ${drive}+${steer}`);
      return exec.cruise(drive, steer);
    },
    stop() {
      logTurn('→ stop');
      return exec.stop();
    },
  };
}

/** @param {WebAudioTts} tts */
function loggedTts(tts) {
  return {
    /** @param {string} text */
    speak(text) {
      logTurn(`♫ 「${text}」`);
      return tts.speak(text);
    },
    cancel() { tts.cancel(); },
  };
}

const turnLogEl = el('turnLog');
let turnLogText = '';

/** @param {string} text */
function logTurn(text) {
  const time = new Date().toISOString().slice(11, 19);
  turnLogText += `[${time}] ${text}\n`;
  turnLogEl.textContent = turnLogText;
  turnLogEl.scrollTop = turnLogEl.scrollHeight;
}

el('textForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = /** @type {HTMLInputElement} */ (el('textInput'));
  const text = input.value;
  if (!text.trim()) return;
  input.value = '';
  logTurn(`> ${text}`);

  if (!executor) {
    logTurn('!! connect USB first');
    return;
  }

  const sendBtn = /** @type {HTMLButtonElement} */
    (document.querySelector('#textForm button[type="submit"]'));
  sendBtn.disabled = true;
  try {
    await ensureBrain(executor).handle(text);
  } catch (err) {
    const e = /** @type {Error} */ (err);
    logTurn(`!! ${e.name}: ${e.message}`);
  } finally {
    sendBtn.disabled = false;
  }
});

// --- Emergency stop — spec §4.1 layer 2. Works from page load: it reads the
// module-level `executor` directly and never goes through Brain, so it does
// not depend on a turn ever having been sent. ------------------------------

el('stopBtn').addEventListener('click', () => {
  if (!executor) {
    logTurn('■ emergency stop: USB is not connected, so there is no car to stop');
    return;
  }
  executor.stop(); // sync gen++ happens before this returns
  logTurn('■ emergency stop');
});
