// Setup, as a sheet instead of a page (spec §8 of the 2026-09-17 design).
//
// The page it replaces is still there and still needed — fixtures in your own
// voice, the typed driver, comparing one TTS provider against another. Those
// are instrument questions, asked by somebody who already has a working robot.
// This asks the one question standing between a person and their first turn of
// the wheels: what are your three keys.
//
// Two things follow from that, and they are the whole design:
//
//   1. Only the key is typed. baseURL and model come from a built-in list,
//      because they are identical for everybody on the same provider and every
//      paste is another chance to produce a failure that reads as a bad key.
//   2. Each layer carries its own test. A single status line at the foot of
//      the sheet can say "something failed" and cannot say which of three keys
//      is wrong, which is the only thing its reader wants to know.
//
// Saving is not a button. A key is pasted, and the very next thing anybody
// does is press Test — a Save in between exists only to be forgotten, and the
// failure it produces ("bad key") points at the wrong thing.

import { t } from './strings.js';
import { PRESETS, CUSTOM, presetIdFor, presetById } from './provider-presets.js';
import { checkStt, checkLlm, checkTts } from './checks.js';
import { OpenAiCompatStt } from './providers/stt-openai-compat.js';
import { OpenAiCompatLlm } from './providers/llm-openai-compat.js';
import { WebAudioTts } from './providers/tts-webaudio.js';
import { TOOLS, buildSystemPrompt } from './brain.js';

const $ = (/** @type {string} */ id) =>
  /** @type {HTMLElement} */ (document.getElementById(id));

/**
 * @typedef {{
 *   name: 'stt' | 'llm' | 'tts',
 *   label: import('./strings.js').StringKey,
 *   what: import('./strings.js').StringKey,
 *   optional: boolean,
 * }} LayerRow
 */

/**
 * In the order the robot uses them: it hears, then decides, then answers.
 * `optional` is not a judgement about importance — it is whether steps.js
 * counts the layer as gating, and only STT and LLM are.
 *
 * @type {LayerRow[]}
 */
const LAYERS = [
  { name: 'stt', label: 'setupEars', what: 'setupEarsWhat', optional: false },
  { name: 'llm', label: 'setupMind', what: 'setupMindWhat', optional: false },
  { name: 'tts', label: 'setupVoice', what: 'setupVoiceWhat', optional: true },
];

/**
 * @param {{
 *   lang: 'en' | 'zh',
 *   config: import('./config.js').Config,
 *   save: () => void,
 *   onChange: () => void,
 *   audioContext: () => AudioContext,
 *   log: (msg: string) => void,
 * }} deps
 */
export function createSetupSheet(deps) {
  const sheet = $('setupSheet');
  const rows = $('setupRows');
  const note = $('setupNote');

  /**
   * Which preset each layer is showing, and whether its model is being typed
   * rather than picked. Kept beside the config rather than derived from it on
   * every render: "I chose Other and have not typed the model yet" is a state
   * the config cannot represent, and re-deriving would snap the row back to a
   * dropdown mid-edit.
   *
   * @type {Record<string, { presetId: string, freeModel: boolean }>}
   */
  const ui = {};

  /** The test button and result line of each rendered row, for "test all". */
  /** @type {Map<string, { button: HTMLButtonElement, result: HTMLElement }>} */
  const wired = new Map();

  $('setupTitle').textContent = t(deps.lang, 'setupTitle');
  $('setupClose').textContent = t(deps.lang, 'close');
  $('setupTestAll').textContent = t(deps.lang, 'setupTestAll');
  $('setupClose').addEventListener('click', () => close());
  $('setupTestAll').addEventListener('click', () => void testAll());
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });

  function open() {
    for (const layer of LAYERS) {
      const cfg = deps.config[layer.name];
      const presetId = presetIdFor(layer.name, cfg);
      const preset = presetById(layer.name, presetId);
      ui[layer.name] = {
        presetId,
        freeModel: !preset || !preset.models.includes(cfg.model),
      };
    }
    note.textContent = t(deps.lang, 'setupEarsNote');
    render();
    sheet.hidden = false;
  }

  function close() {
    sheet.hidden = true;
    deps.onChange();
  }

  function render() {
    rows.textContent = '';
    for (const layer of LAYERS) rows.append(renderLayer(layer));
  }

  /** @param {LayerRow} layer */
  function renderLayer(layer) {
    const box = document.createElement('section');
    box.className = 'layer';

    const head = document.createElement('div');
    head.className = 'layer-head';
    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = t(deps.lang, layer.label);
    const what = document.createElement('span');
    what.className = 'layer-what';
    what.textContent = t(deps.lang, layer.what);
    head.append(name, what);
    box.append(head);

    const body = fields(layer);
    if (layer.optional) {
      // Folded, not dropped. The robot starts without a voice and then says
      // nothing, which is a surprising enough outcome to deserve the sentence
      // in the summary rather than silence in the sheet.
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = t(deps.lang, 'setupVoiceOptional');
      details.append(summary, body);
      details.open = Boolean(deps.config.tts.apiKey);
      box.append(details);
    } else {
      box.append(body);
    }
    return box;
  }

  /** @param {LayerRow} layer */
  function fields(layer) {
    const cfg = /** @type {Record<string, string>} */ (
      /** @type {unknown} */ (deps.config[layer.name]));
    const state = ui[layer.name];
    const preset = presetById(layer.name, state.presetId);

    const grid = document.createElement('div');
    grid.className = 'layer-fields';

    // --- provider ---------------------------------------------------------
    const provider = select(
      [...PRESETS[layer.name].map(
        (p) => /** @type {[string, string]} */ ([p.id, p.label])),
      /** @type {[string, string]} */ ([CUSTOM, t(deps.lang, 'setupCustom')])],
      state.presetId,
      (id) => {
        state.presetId = id;
        const picked = presetById(layer.name, id);
        if (picked) {
          cfg.baseURL = picked.baseURL;
          if (!picked.models.includes(cfg.model)) cfg.model = picked.models[0];
          state.freeModel = false;
        } else {
          state.freeModel = true;
        }
        commit();
        render();
      });
    grid.append(labelled('setupProvider', provider));

    // --- baseURL, only when there is no preset to supply it ----------------
    if (!preset) {
      grid.append(labelled('setupBaseUrl', text(cfg.baseURL, 'https://…',
        (v) => { cfg.baseURL = v; commit(); }), true));
    }

    // --- model ------------------------------------------------------------
    if (preset && !state.freeModel) {
      grid.append(labelled('setupModel', select(
        [...preset.models.map((m) => /** @type {[string, string]} */ ([m, m])),
        /** @type {[string, string]} */ (['', t(deps.lang, 'setupCustom')])],
        cfg.model,
        (v) => {
          if (v === '') { state.freeModel = true; render(); return; }
          cfg.model = v;
          commit();
        })));
    } else {
      grid.append(labelled('setupModel', text(cfg.model, '',
        (v) => { cfg.model = v; commit(); })));
    }

    // --- voice: TTS only, and §11.1 fixes one for every language -----------
    if (layer.name === 'tts') {
      const voices = preset?.voices;
      grid.append(labelled('setupVoiceField', voices
        ? select(voices.map((v) => /** @type {[string, string]} */ ([v, v])),
          cfg.voice || voices[0],
          (v) => { cfg.voice = v; commit(); })
        : text(cfg.voice, '', (v) => { cfg.voice = v; commit(); })));
    }

    // --- key: the only field anybody actually types ------------------------
    const key = text(cfg.apiKey, 'sk-…', (v) => { cfg.apiKey = v; commit(); });
    key.type = 'password';
    key.autocomplete = 'off';
    grid.append(labelled('setupKey', key, true));

    const button = document.createElement('button');
    button.className = 'quiet layer-test';
    button.textContent = t(deps.lang, 'setupTest');
    const result = document.createElement('p');
    result.className = 'layer-result';
    button.addEventListener('click', () => void runCheck(layer, button, result));
    // Registered here, not on first click: "Test all three" has to reach a row
    // nobody has pressed yet, which is every row the first time the sheet is
    // opened — the case the button exists for.
    wired.set(layer.name, { button, result });

    const box = document.createElement('div');
    box.className = 'layer-body';
    box.append(grid, button, result);
    return box;
  }

  // --- the checks ---------------------------------------------------------

  /**
   * @param {LayerRow} layer
   * @param {HTMLButtonElement} button
   * @param {HTMLElement} result
   */
  async function runCheck(layer, button, result) {
    const cfg = deps.config[layer.name];
    if (!cfg.baseURL || !cfg.apiKey || !cfg.model) {
      return say(result, t(deps.lang, 'setupNeedKey'), 'error');
    }
    button.disabled = true;
    say(result, '…', 'pending');
    try {
      say(result, await perform(layer.name), 'ok');
    } catch (err) {
      const e = /** @type {Error} */ (err);
      deps.log(`${layer.name} check: ${e.message}`);
      say(result, e.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  /** @param {'stt' | 'llm' | 'tts'} name @returns {Promise<string>} */
  async function perform(name) {
    if (name === 'stt') {
      const heard = await checkStt(
        new OpenAiCompatStt(deps.config.stt), deps.audioContext());
      // Said every time, not once: a transcript that reads correctly is the
      // most convincing wrong evidence on this sheet. It was a recording.
      return `“${heard}”\n${t(deps.lang, 'setupHeardNote')}`;
    }
    if (name === 'llm') {
      return checkLlm(new OpenAiCompatLlm(deps.config.llm), {
        tools: TOOLS,
        systemPrompt: buildSystemPrompt({ replyLang: null, bargeIn: true }),
      });
    }
    return checkTts(new WebAudioTts(deps.config.tts,
      { audioContext: deps.audioContext() }));
  }

  /**
   * All three, one after another rather than at once: the TTS check plays
   * audio, and running it under a transcription request means listening to the
   * answer while the question is still being asked.
   */
  async function testAll() {
    for (const layer of LAYERS) {
      const cell = wired.get(layer.name);
      if (!cell) continue;
      await runCheck(layer, cell.button, cell.result);
    }
  }

  // --- small builders -----------------------------------------------------

  /** @param {HTMLElement} el @param {string} text @param {string} state */
  function say(el, text, state) {
    el.textContent = text;
    el.className = `layer-result ${state}`;
  }

  /** Persist on every edit. See the note at the top on why there is no Save. */
  function commit() {
    deps.save();
    note.textContent = t(deps.lang, 'setupSaved');
  }

  /**
   * @param {[string, string][]} options
   * @param {string} value
   * @param {(v: string) => void} onPick
   */
  function select(options, value, onPick) {
    const el = document.createElement('select');
    for (const [v, label] of options) {
      const option = document.createElement('option');
      option.value = v;
      option.textContent = label;
      option.selected = v === value;
      el.append(option);
    }
    el.addEventListener('change', () => onPick(el.value));
    return el;
  }

  /**
   * @param {string} value
   * @param {string} placeholder
   * @param {(v: string) => void} onEdit
   */
  function text(value, placeholder, onEdit) {
    const el = document.createElement('input');
    el.type = 'text';
    el.value = value;
    el.placeholder = placeholder;
    el.autocomplete = 'off';
    // `change`, not `input`: saving on every keystroke writes half a key to
    // storage dozens of times, and the field is committed on blur anyway.
    el.addEventListener('change', () => onEdit(el.value.trim()));
    return el;
  }

  /**
   * @param {import('./strings.js').StringKey} key
   * @param {HTMLElement} field
   * @param {boolean} [wide]
   */
  function labelled(key, field, wide = false) {
    const label = document.createElement('label');
    if (wide) label.className = 'wide';
    const span = document.createElement('span');
    span.textContent = t(deps.lang, key);
    span.style.fontSize = '12px';
    span.style.opacity = '.6';
    label.append(span, field);
    return label;
  }

  return { open, close };
}
