// Setup, as a sheet instead of a page (spec §8 of the 2026-09-17 design).
//
// The page it replaces is still there and still needed — fixtures in your own
// voice, the typed driver, comparing one TTS provider against another. Those
// are instrument questions, asked by somebody who already has a working robot.
// This asks the one question standing between a person and their first turn of
// the wheels: what are your three keys. (A fourth, the reflex, is optional
// and comes last.)
//
// Three things follow from that, and they are the whole design:
//
//   1. One layer at a time, behind tabs. Three stacked layers is eleven fields
//      on one phone screen, and a panel that scrolls inside a sheet that is
//      itself the height of the screen — with a select somewhere in the middle
//      opening its own scrolling list. Setting up a key is not a form-filling
//      session; it is the same three-field errand done three times.
//   2. Only the key is typed. baseURL and model come from a built-in list,
//      because they are identical for everybody on the same provider and every
//      paste is another chance to produce a failure that reads as a bad key.
//   3. Each layer carries its own test, next to its own fields. A status line
//      at the foot of a sheet can say "something failed" and cannot say which
//      of three keys is wrong, which is the only thing its reader wants to
//      know. There is no "test all three": the three are configured one at a
//      time and each is tested where it is configured.
//
// Saving is not a button. A key is pasted, and the very next thing anybody
// does is press Test — a Save in between exists only to be forgotten, and the
// failure it produces ("bad key") points at the wrong thing.

import { t } from './strings.js';
import { PRESETS, CUSTOM, presetIdFor, presetById, voicesFor } from './provider-presets.js';
import { checkStt, checkLlm, checkTts, checkReflex } from './checks.js';
import { layerReady } from './config.js';
import { OpenAiCompatStt } from './providers/stt-openai-compat.js';
import { OpenAiCompatLlm } from './providers/llm-openai-compat.js';
import { WebAudioTts } from './providers/tts-webaudio.js';
import { Reflex } from './reflex.js';
import { TOOLS, buildSystemPrompt } from './brain.js';

const $ = (/** @type {string} */ id) =>
  /** @type {HTMLElement} */ (document.getElementById(id));

/**
 * @typedef {{
 *   name: 'stt' | 'llm' | 'tts' | 'reflex',
 *   label: import('./strings.js').StringKey,
 *   what: import('./strings.js').StringKey,
 *   note: import('./strings.js').StringKey,
 *   optional: boolean,
 * }} LayerRow
 */

/**
 * In the order the robot uses them: it hears, then decides, then answers.
 * `optional` is not a judgement about importance — it is whether steps.js
 * counts the layer as gating, and only STT and LLM are. The reflex comes last
 * because it is the one layer the robot is whole without (reflex spec §1).
 *
 * @type {LayerRow[]}
 */
const LAYERS = [
  { name: 'stt', label: 'setupEars', what: 'setupEarsWhat', note: 'setupEarsNote', optional: false },
  { name: 'llm', label: 'setupMind', what: 'setupMindWhat', note: 'setupEarsNote', optional: false },
  { name: 'tts', label: 'setupVoice', what: 'setupVoiceWhat', note: 'setupVoiceOptional', optional: true },
  { name: 'reflex', label: 'setupReflex', what: 'setupReflexWhat', note: 'setupReflexOptional', optional: true },
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
  const tabs = $('setupTabs');
  const rows = $('setupRows');
  const note = $('setupNote');
  const foot = $('setupFoot');

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

  /** @type {LayerRow['name']} */
  let active = 'stt';

  /**
   * Where closing this sheet goes, when it was opened from somewhere that is
   * not the main screen.
   *
   * A sheet closes whatever opened it — two bottom sheets on one phone leave
   * the lower one showing around the edges of the upper — so without this,
   * every door into here is one-way.
   *
   * @type {(() => void) | null}
   */
  let back = null;

  $('setupTitle').textContent = t(deps.lang, 'setupTitle');
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });

  /** @param {{ back?: () => void }} [opts] */
  function open(opts = {}) {
    back = opts.back ?? null;
    for (const layer of LAYERS) {
      const cfg = deps.config[layer.name];
      const presetId = presetIdFor(layer.name, cfg);
      const preset = presetById(layer.name, presetId);
      ui[layer.name] = {
        presetId,
        freeModel: !preset || !preset.models.includes(cfg.model),
      };
      // A voice that names a model it is no longer paired with is not a
      // preference, it is a stale string the provider will refuse.
      if (layer.name === 'tts') {
        const voices = voicesFor(preset, cfg.model);
        if (voices.length && !voices.includes(deps.config.tts.voice)) {
          deps.config.tts.voice = voices[0];
        }
      }
    }
    // Opens on the first layer that is not finished, not always on the first
    // tab. Somebody who came back to fix their Voice key should not have to
    // walk past two ticked layers to reach it. Never the reflex, though: an
    // empty one is a choice, and landing on it every time would nag.
    active = (LAYERS.find((l) => l.name !== 'reflex' && !layerReady(deps.config[l.name]))
      ?? LAYERS[0]).name;
    render();
    sheet.hidden = false;
  }

  function close() {
    sheet.hidden = true;
    deps.onChange();
    const to = back;
    // Cleared before it runs, not after: whatever it reopens may open this
    // sheet again from a different door, and it must not inherit this one.
    back = null;
    to?.();
  }

  function render() {
    renderTabs();
    rows.textContent = '';
    const layer = /** @type {LayerRow} */ (LAYERS.find((l) => l.name === active));
    rows.append(renderLayer(layer));
    note.textContent = t(deps.lang, layer.note);
    renderFoot();
  }

  /**
   * A tab per layer, each carrying whether that layer is finished. The mark is
   * the reason the tabs can replace the stack without losing anything: three
   * open panels showed you at a glance which ones were empty, and three bare
   * words would not.
   */
  function renderTabs() {
    tabs.textContent = '';
    for (const layer of LAYERS) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'tab';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(layer.name === active));
      if (layer.name === active) tab.classList.add('tab-on');
      if (layerReady(deps.config[layer.name])) tab.classList.add('tab-done');
      tab.textContent = t(deps.lang, layer.label);
      tab.addEventListener('click', () => { active = layer.name; render(); });
      tabs.append(tab);
    }
  }

  /** Back and Close are both offered, because they are different intentions:
   *  one returns to the drawer this was opened from, the other is done. */
  function renderFoot() {
    foot.textContent = '';
    if (back) foot.append(footButton('back', () => close()));
    foot.append(footButton('close', () => {
      back = null;
      close();
    }));
  }

  /**
   * @param {import('./strings.js').StringKey} key
   * @param {() => void} fn
   */
  function footButton(key, fn) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'quiet';
    b.textContent = t(deps.lang, key);
    b.addEventListener('click', fn);
    return b;
  }

  /** @param {LayerRow} layer */
  function renderLayer(layer) {
    const box = document.createElement('section');
    box.className = 'layer';

    const head = document.createElement('div');
    head.className = 'layer-head';
    const what = document.createElement('span');
    what.className = 'layer-what';
    what.textContent = t(deps.lang, layer.what);
    head.append(what);
    box.append(head, fields(layer));
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
          // `?? cfg.model` matters: a preset that lists no models on purpose
          // (OpenRouter) would otherwise write `undefined` over whatever was
          // there, and undefined is not a string the config schema allows.
          if (!picked.models.includes(cfg.model)) {
            cfg.model = picked.models[0] ?? cfg.model;
          }
          state.freeModel = !picked.models.includes(cfg.model);
          // The voice belongs to the model on some providers, so a provider
          // that cannot supply the stored one has invalidated it.
          const voices = voicesFor(picked, cfg.model);
          if (voices.length && !voices.includes(cfg.voice)) cfg.voice = voices[0];
        } else {
          state.freeModel = true;
        }
        commit();
        render();
      });
    grid.append(labelled('setupProvider', provider, true));

    // --- baseURL, only when there is no preset to supply it ----------------
    if (!preset) {
      grid.append(labelled('setupBaseUrl', text(cfg.baseURL, 'https://…',
        (v) => { cfg.baseURL = v; commit(); }), true));
    }

    // --- model ------------------------------------------------------------
    //
    // The list never goes away. Replacing it with a text box the moment
    // somebody picks "Other" left them typing with no way back to the names
    // they had a second ago — the one thing this sheet exists to save them
    // from. "Other" adds a field underneath; picking a name again removes it.
    // A provider that lists no models on purpose gets the text box alone. An
    // empty select whose only entry is "Other" is a control that offers one
    // choice and takes a tap to make it.
    if (preset && !preset.openModels) {
      grid.append(labelled('setupModel', select(
        [...preset.models.map((m) => /** @type {[string, string]} */ ([m, m])),
        /** @type {[string, string]} */ (['', t(deps.lang, 'setupCustom')])],
        state.freeModel ? '' : cfg.model,
        (v) => {
          state.freeModel = v === '';
          if (v !== '') {
            cfg.model = v;
            const voices = voicesFor(preset, v);
            if (voices.length && !voices.includes(cfg.voice)) cfg.voice = voices[0];
            commit();
          }
          render();
        }), true));
    }
    const listed = Boolean(preset) && !preset?.openModels;
    if (!listed || state.freeModel) {
      const typed = text(cfg.model, t(deps.lang, 'setupModel'),
        (v) => { cfg.model = v; commit(); render(); });
      grid.append(listed ? wide(typed) : labelled('setupModel', typed, true));
    }

    // --- voice: TTS only, and §11.1 fixes one for every language -----------
    if (layer.name === 'tts') {
      const voices = voicesFor(preset, cfg.model);
      grid.append(labelled('setupVoiceField', voices.length
        ? select(voices.map((v) => /** @type {[string, string]} */ ([v, v])),
          cfg.voice || voices[0],
          (v) => { cfg.voice = v; commit(); })
        : text(cfg.voice, '', (v) => { cfg.voice = v; commit(); }), true));
    }

    // --- key: the only field anybody actually types ------------------------
    const key = text(cfg.apiKey, 'sk-…', (v) => { cfg.apiKey = v; commit(); });
    key.type = 'password';
    key.autocomplete = 'off';
    grid.append(labelled('setupKey', key, true));

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quiet layer-test';
    button.textContent = t(deps.lang, 'setupTest');
    const result = document.createElement('p');
    result.className = 'layer-result';
    button.addEventListener('click', () => void runCheck(layer, button, result));

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
      // A pass is what turns the tab's mark green, and the tab is rendered
      // from the config rather than from the result — so this redraws.
      renderTabs();
    } catch (err) {
      const e = /** @type {Error} */ (err);
      deps.log(`${layer.name} check: ${e.message}`);
      say(result, e.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  /** @param {LayerRow['name']} name @returns {Promise<string>} */
  async function perform(name) {
    if (name === 'stt') {
      const heard = await checkStt(
        new OpenAiCompatStt(deps.config.stt), deps.audioContext(), deps.lang);
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
    if (name === 'reflex') return checkReflex(new Reflex(deps.config.reflex));
    return checkTts(new WebAudioTts(deps.config.tts,
      { audioContext: deps.audioContext() }), deps.lang);
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

  /** A field with no caption of its own, for the box that appears under a list
   *  rather than beside it.
   *  @param {HTMLElement} field */
  function wide(field) {
    const label = document.createElement('label');
    label.className = 'wide';
    label.append(field);
    return label;
  }

  /**
   * @param {import('./strings.js').StringKey} key
   * @param {HTMLElement} field
   * @param {boolean} [full]
   */
  function labelled(key, field, full = false) {
    const label = document.createElement('label');
    if (full) label.className = 'wide';
    const span = document.createElement('span');
    span.className = 'field-caption';
    span.textContent = t(deps.lang, key);
    label.append(span, field);
    return label;
  }

  return { open, close };
}
