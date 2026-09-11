// Connectivity-test page and typed end-to-end driver (task 12).
//
// entry file: allowed to touch document/localStorage/navigator at the top
// level (spec §10's exception). localStorage access is confined to the two
// functions below — loadConfig() and saveConfig() — nothing else in this
// file, and no provider or brain.js, touches it.

import { Ftdi } from './ftdi.js';
import { Executor } from './executor.js';
import { OpenAiCompatStt } from './providers/stt-openai-compat.js';
import { OpenAiCompatLlm } from './providers/llm-openai-compat.js';
import { WebAudioTts } from './providers/tts-webaudio.js';
import { Brain, TOOLS, buildSystemPrompt } from './brain.js';

const CONFIG_KEY = 'voicebot.config';

/**
 * @typedef {{ baseURL: string, apiKey: string, model: string }} ProviderCfg
 * @typedef {{ stt: ProviderCfg, llm: ProviderCfg, tts: ProviderCfg & { voice: string } }} Config
 */

/** @returns {Config} */
function emptyConfig() {
  return {
    stt: { baseURL: '', apiKey: '', model: '' },
    llm: { baseURL: '', apiKey: '', model: '' },
    tts: { baseURL: '', apiKey: '', model: '', voice: '' },
  };
}

// --- The only two functions in this file (or anywhere in the app) that ----
// --- touch localStorage. -----------------------------------------------

/** @returns {Config} */
function loadConfig() {
  const empty = emptyConfig();
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    // Merge over the empty defaults so a config saved before a field existed
    // (or a partially-filled form) never produces `undefined` inputs.
    return {
      stt: { ...empty.stt, ...parsed.stt },
      llm: { ...empty.llm, ...parsed.llm },
      tts: { ...empty.tts, ...parsed.tts },
    };
  } catch {
    return empty;
  }
}

/** @param {Config} cfg */
function saveConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

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

/** @returns {Config} */
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

/** @param {Config} cfg */
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

/** @param {ProviderCfg} cfg @param {string} label */
function assertFilled(cfg, label) {
  if (!cfg.baseURL || !cfg.apiKey || !cfg.model) {
    throw new Error(`请先在上方「配置」里填写 ${label} 的 baseURL / apiKey / model`);
  }
}

el('cfgForm').addEventListener('submit', (event) => {
  event.preventDefault();
  saveConfig(readForm());
  el('cfgStatus').textContent = `已保存到 localStorage（${CONFIG_KEY}）`;
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
  el('usbStatus').textContent = `状态：${text}`;
}

/** @returns {Ftdi} */
function requireFtdi() {
  if (!ftdi) throw new Error('请先点击上方「连接 FT232H」');
  return ftdi;
}

el('connectBtn').addEventListener('click', async () => {
  const usb = navigator.usb;
  if (!usb) {
    setUsbStatus('此浏览器不支持 WebUSB（需要 Chromium 内核：Chrome / Edge）');
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
    setUsbStatus('已连接');
    logTurn('USB 已连接');
  } catch (err) {
    const e = /** @type {Error} */ (err);
    setUsbStatus(`连接失败：${e.message}`);
  }
});

// --- Connectivity tests (spec §9.3) -----------------------------------------
//
// Every test exercises the hardest case on purpose — an easy input passing
// tells you nothing. See web/fixtures/README.md for why the three STT
// fixtures are what they are.

const STT_FIXTURES = /** @type {const} */ ([
  { path: 'fixtures/zh.wav', label: '中文' },
  { path: 'fixtures/en.wav', label: '英文' },
  { path: 'fixtures/mixed.wav', label: '中英混说' },
]);

async function fixtureReadme() {
  try {
    const response = await fetch('fixtures/README.md');
    if (response.ok) return await response.text();
  } catch {
    // fall through to the generic message below
  }
  return '（未能读取 fixtures/README.md，请直接打开仓库里的 web/fixtures/README.md。）';
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
      throw new Error(`找不到 ${fixture.path}，不能静默跳过这段测试。\n\n${readme}`);
    }
    const audioBuffer = await ctx.decodeAudioData(await response.arrayBuffer());
    const { pcm, sampleRate } = toInt16Pcm(audioBuffer);
    const text = await stt.transcribe(pcm, sampleRate);
    lines.push(`${fixture.label}: ${text || '（空）'}`);
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
  if (!chat.text) throw new Error('模型没有返回文本');

  const tool = await llm.chat(
    [{ role: 'system', content: buildSystemPrompt({ replyLang: null, bargeIn: true }) },
      { role: 'user', content: 'go forward for one second' }], TOOLS);
  if (tool.toolCalls.length === 0) {
    throw new Error('模型能聊天但没有调工具 —— 这个 provider 的 tool calling 不可用');
  }
  return `文本 ✅「${chat.text}」 · 工具 ✅ ${tool.toolCalls[0].name}`;
}

/** @param {WebAudioTts} tts @returns {Promise<string>} */
async function testTts(tts) {
  const text = '「往前走」的英文是 go forward';
  await tts.speak(text);
  return `已播放「${text}」—— 两种语言都听清了吗？（这是人耳判断，不是程序判断）`;
}

/** @param {Ftdi} dev @returns {Promise<string>} */
async function testUsb(dev) {
  await dev.write(dev.buildStream(0x10, 200));
  return '已发出 200 ms 前进 —— 车动了吗？';
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
      if (!cfg.tts.voice) throw new Error('请先在上方「配置」里填写 TTS 的 voice');
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
  setResult(resultEl, '测试中…', 'pending');
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
// many replies are 纯复述、零信息量 — pure restatement, zero information — and
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
    logTurn('!! 请先连接 USB');
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
    logTurn('■ 急停：还没连接 USB，没有车可停');
    return;
  }
  executor.stop(); // sync gen++ happens before this returns
  logTurn('■ 急停');
});
