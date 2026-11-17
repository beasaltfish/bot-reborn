// The firmware drawer: a view of the board's firmware, an editor for the
// custom draft, and (Task 13) the run timeline. It owns no board state; every
// action is reported to the page through callbacks.
import { simText } from './strings.js';

const el = (/** @type {string} */ tag, /** @type {Record<string, string>} */ attrs = {}) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};

/** @param {string} source @returns {string[]} */
const linesOf = (source) => (source ? source.split('\n') : []);

/**
 * @param {{
 *   lang: 'en'|'zh',
 *   firmwares?: { id: string, name: string }[],
 *   getState?: () => any,
 *   loadSource?: (selection: any) => Promise<string>,
 *   onSelect?: (selection: any) => void,
 *   onDraft?: (source: string) => void,
 *   onDownload?: (selection: any) => void,
 *   onCopyExample?: (selection: any) => void,
 *   onFlash?: (selection: any) => Promise<{ ok: boolean, errors?: any[] }> | void,
 *   scheduleFrame?: (fn: () => void) => void,
 * }} o
 */
export function createFirmwareStudio(o) {
  const lang = o.lang;
  const root = el('section', { id: 'firmware-studio', role: 'complementary', 'aria-label': simText(lang, 'studio.title') });
  root.hidden = true;
  /** @type {any} */
  let state = {
    board: { firmware: 'body' },
    custom: null,
    selection: { kind: 'body' },
    view: 'run',
    running: true,
    usb: false,
    errors: [],
    timings: { interpreterMs: 0, uiMs: 0 },
    exampleV1: false,
    source: '',
  };

  const bar = el('div', { class: 'studio-bar' });
  const title = el('h2');
  title.textContent = simText(lang, 'studio.title');
  const selector = /** @type {HTMLSelectElement} */ (el('select', { 'data-role': 'selector', 'aria-label': simText(lang, 'studio.title') }));
  const download = /** @type {HTMLButtonElement} */ (el('button', { type: 'button', 'data-role': 'download' }));
  download.textContent = simText(lang, 'studio.download');
  const copy = /** @type {HTMLButtonElement} */ (el('button', { type: 'button', 'data-role': 'copy' }));
  copy.textContent = simText(lang, 'studio.copy');
  const flash = /** @type {HTMLButtonElement} */ (el('button', { type: 'button', 'data-role': 'flash' }));
  flash.textContent = simText(lang, 'studio.flash');
  const close = /** @type {HTMLButtonElement} */ (el('button', { type: 'button', 'data-role': 'toggle', 'aria-label': simText(lang, 'studio.close') }));
  close.textContent = '×';
  bar.append(title, selector, download, copy, flash, close);

  const meta = el('div', { class: 'studio-meta' });
  const boardLabel = el('span', { 'data-role': 'board' });
  const runTab = el('button', { type: 'button', 'data-role': 'view-run' });
  runTab.textContent = simText(lang, 'studio.run');
  const draftTab = el('button', { type: 'button', 'data-role': 'view-draft' });
  draftTab.textContent = simText(lang, 'studio.draft');
  const seg = el('span', { class: 'studio-seg' });
  seg.append(runTab, draftTab);
  const timing = el('span', { 'data-role': 'timing' });
  meta.append(boardLabel, seg, timing);

  const code = el('div', { class: 'studio-code' });
  const numbers = el('div', { 'data-role': 'line-numbers', class: 'studio-lines' });
  const runSource = el('div', { 'data-role': 'run-source', class: 'studio-source' });
  const runLabel = el('div', { class: 'studio-label' });
  runLabel.textContent = simText(lang, 'studio.run');
  const runPre = el('pre', { 'data-role': 'run-code' });
  runSource.append(runLabel, runPre);
  const draftWrap = el('label', { class: 'studio-draft' });
  const draftArea = /** @type {HTMLTextAreaElement} */ (el('textarea', { 'data-role': 'draft', spellcheck: 'false' }));
  draftWrap.append(draftArea);
  code.append(numbers, runSource, draftWrap);

  const error = el('div', { 'data-role': 'error', class: 'studio-error' });
  const timeline = el('div', { 'data-role': 'timeline', class: 'studio-timeline' });
  const controls = el('div', { class: 'studio-controls' });
  const pause = /** @type {HTMLButtonElement} */ (el('button', { type: 'button', 'data-role': 'pause' }));
  pause.textContent = simText(lang, 'studio.pause');
  const clear = /** @type {HTMLButtonElement} */ (el('button', { type: 'button', 'data-role': 'clear' }));
  clear.textContent = simText(lang, 'studio.clear');
  controls.append(pause, clear);

  root.append(bar, meta, code, error, controls, timeline);

  const optionsFor = () => {
    const items = o.firmwares ?? [
      { id: 'body', name: 'body' },
      { id: 'custom', name: 'my firmware' },
    ];
    selector.replaceChildren();
    for (const item of items) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      selector.append(option);
    }
  };
  optionsFor();

  /** @returns {any} */
  const selectionOf = () => {
    const value = selector.value;
    if (value === 'body' || value === 'custom') return { kind: value };
    return { kind: 'sketch', id: value };
  };

  selector.addEventListener('change', () => o.onSelect?.(selectionOf()));
  runTab.addEventListener('click', () => { state.view = 'run'; render(); });
  draftTab.addEventListener('click', () => { state.view = 'draft'; render(); });
  draftArea.addEventListener('input', () => o.onDraft?.(draftArea.value));
  download.addEventListener('click', () => o.onDownload?.(state.selection));
  copy.addEventListener('click', () => o.onCopyExample?.(state.selection));
  flash.addEventListener('click', () => { void o.onFlash?.(state.selection); });
  close.addEventListener('click', () => { root.hidden = true; });
  pause.addEventListener('click', () => {
    state.paused = !state.paused;
    pause.textContent = state.paused ? simText(lang, 'studio.resume') : simText(lang, 'studio.pause');
    if (!state.paused) schedule();
  });
  clear.addEventListener('click', () => { state.traces = []; state.rendered = 0; timeline.replaceChildren(); });

  /** @type {any[]} */
  state.traces = [];
  state.rendered = 0;
  state.paused = false;
  let scheduled = false;
  const scheduleFrame = o.scheduleFrame ?? ((fn) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
    else setTimeout(fn, 16);
  });
  function schedule() {
    if (scheduled || state.paused) return;
    scheduled = true;
    scheduleFrame(() => { scheduled = false; renderTrace(); });
  }

  /** @param {string} source */
  function renderNumbers(source) {
    numbers.replaceChildren();
    for (let i = 1; i <= linesOf(source).length; i += 1) {
      const line = document.createElement('span');
      line.textContent = String(i);
      numbers.append(line);
    }
  }

  function renderTrace() {
    if (state.paused) return;
    const pending = state.traces.slice(state.rendered, state.rendered + 20);
    state.rendered += pending.length;
    for (const record of pending) {
      const row = el('div', { 'data-role': 'trace' });
      row.textContent = `${record.line ?? ''} ${record.text ?? record.kind}`.trim();
      row.addEventListener('click', () => { state.view = 'run'; render(); });
      timeline.append(row);
    }
    while (timeline.children.length > 200) timeline.firstElementChild?.remove();
    if (state.rendered < state.traces.length) schedule();
  }

  function render() {
    root.dataset.view = state.view;
    const firmware = state.board?.firmware || '';
    boardLabel.textContent = `${simText(lang, 'studio.board')}: ${firmware || simText(lang, 'studio.noFirmware')}`;
    const custom = state.custom;
    const selection = state.selection ?? { kind: 'body' };
    const selectionId = selection.kind === 'sketch' ? selection.id : selection.kind;
    if ([...selector.options].some((option) => option.value === selectionId)) selector.value = selectionId;
    const runningSource = custom?.flashed ?? state.source ?? '';
    const draftSource = custom?.draft ?? '';
    runPre.textContent = runningSource;
    draftArea.value = draftSource;
    renderNumbers(state.view === 'draft' ? draftSource : runningSource);
    runSource.hidden = state.view !== 'run';
    draftWrap.hidden = state.view !== 'draft';
    runTab.setAttribute('aria-pressed', String(state.view === 'run'));
    draftTab.setAttribute('aria-pressed', String(state.view === 'draft'));
    copy.disabled = !state.exampleV1;
    flash.disabled = Boolean(state.errors?.length);
    error.textContent = (state.errors ?? []).map((/** @type {any} */ e) => `${e.line}:${e.column} ${e.message}`).join('\n');
    error.hidden = !(state.errors?.length);
    timing.textContent = `解释器 ${Number(state.timings?.interpreterMs ?? 0).toFixed(1)}/6 ms · UI ${Number(state.timings?.uiMs ?? 0).toFixed(1)}/2 ms`;
    draftArea.readOnly = false;
  }

  render();

  return {
    element: root,
    open() { root.hidden = false; render(); },
    close() { root.hidden = true; },
    toggle() { root.hidden = !root.hidden; if (!root.hidden) render(); },
    /** @param {any} [next] */
    update(next = {}) { state = { ...state, ...next }; render(); },
    /** @param {any[]} records */
    pushTrace(records) {
      state.traces.push(...records);
      const overflow = state.traces.length - 500;
      if (overflow > 0) {
        state.traces.splice(0, overflow);
        state.rendered = Math.max(0, state.rendered - overflow);
      }
      schedule();
    },
    /** @param {boolean} on */
    setBusy(on) { flash.disabled = on || Boolean(state.errors?.length); },
    get state() { return state; },
  };
}
