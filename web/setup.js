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

const STT_FIXTURES = /** @type {const} */ ([
  { path: 'fixtures/zh.wav', label: 'Chinese' },
  { path: 'fixtures/en.wav', label: 'English' },
  { path: 'fixtures/mixed.wav', label: 'mixed in one sentence' },
]);

async function fixtureReadme() {
  try {
    const response = await fetch('fixtures/README.md');
    if (response.ok) return await response.text();
  } catch {
    // fall through to the generic message below
  }
  return '(could not read fixtures/README.md — open web/fixtures/README.md in the repo instead.)';
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
    const response = await fetch(fixture.path);
    // Cloudflare Pages (wrangler pages dev included) does not 404 a missing
    // static path — it falls back to serving index.html with status 200.
    // response.ok alone would call that "found" and hand decodeAudioData an
    // HTML page, which fails with a cryptic decode error instead of ever
    // showing the README instructions. The content-type gives it away: a
    // real .wav is never served as text/html.
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok || contentType.includes('text/html')) {
      const readme = await fixtureReadme();
      throw new Error(`${fixture.path} is missing, and this test must not be skipped silently.\n\n${readme}`);
    }
    const audioBuffer = await ctx.decodeAudioData(await response.arrayBuffer());
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
