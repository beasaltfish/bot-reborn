// The firmware drawer: a view of the board's firmware, an editor for the
// custom draft, and the run timeline. It owns no board state; every action is
// reported to the page through callbacks. Selection only decides what is being
// read or flashed; the run area always describes the firmware on the board.
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
  const root = el('section', { id: 'firmware-studio', role: 'complementary', 'aria-label': simText(lang, 'studio.title'), tabindex: '-1' });
  root.hidden = true;
  /** @type {any} */
  let state = {
    board: { firmware: 'body' },
    custom: null,
    selection: { kind: 'body' },
    view: 'run',
    paused: false,
    usb: false,
    errors: [],
    runError: null,
    timings: { interpreterMs: 0, uiMs: 0 },
    exampleV1: false,
    source: '',
    traces: [],
    rendered: 0,
    highlight: 0,
  };

  const bar = el('div', { class: 'studio-bar' });
  const title = el('h2');
  title.textContent = simText(lang, 'studio.title');
  const selector = /** @type {HTMLSelectElement} */ (el('select', { 'data-role': 'selector', 'aria-label': simText(lang, 'studio.title') }));
  const boardMark = el('span', { class: 'studio-mark', 'data-role': 'board-mark' });
  const download = /** @type {HTMLButtonElement} */ (el('button', { type: 'button', 'data-role': 'download' }));
  download.textContent = simText(lang, 'studio.download');
  const copy = /** @type {HTMLButtonElement} */ (el('button', { type: 'button', 'data-role': 'copy' }));
  copy.textContent = simText(lang, 'studio.copy');
  const flash = /** @type {HTMLButtonElement} */ (el('button', { type: 'button', 'data-role': 'flash' }));
  flash.textContent = simText(lang, 'studio.flash');
  const close = /** @type {HTMLButtonElement} */ (el('button', { type: 'button', 'data-role': 'toggle', 'aria-label': simText(lang, 'studio.close') }));
  close.textContent = '×';
  bar.append(title, selector, boardMark, download, copy, flash, close);

  const meta = el('div', { class: 'studio-meta' });
  const boardLabel = el('span', { 'data-role': 'board' });
  const runTab = el('button', { type: 'button', 'data-role': 'view-run' });
  runTab.textContent = simText(lang, 'studio.run');
  const draftTab = el('button', { type: 'button', 'data-role': 'view-draft' });
  draftTab.textContent = simText(lang, 'studio.draft');
  const seg = el('span', { class: 'studio-seg' });
  seg.append(runTab, draftTab);
  const dirty = el('span', { class: 'studio-dirty', 'data-role': 'dirty' });
  const timing = el('span', { 'data-role': 'timing' });
  meta.append(boardLabel, seg, dirty, timing);

  const code = el('div', { class: 'studio-code' });
  const numbers = el('div', { 'data-role': 'line-numbers', class: 'studio-lines' });
  const runSource = el('div', { 'data-role': 'run-source', class: 'studio-source' });
  const runLabel = el('div', { class: 'studio-label' });
  runLabel.textContent = simText(lang, 'studio.run');
  const runPre = el('pre', { 'data-role': 'run-code' });
  runSource.append(runLabel, runPre);
  const draftWrap = el('label', { class: 'studio-draft' });
  const draftArea = /** @type {HTMLTextAreaElement} */ (el('textarea', { 'data-role': 'draft', spellcheck: 'false', 'aria-label': simText(lang, 'studio.draft') }));
  draftWrap.append(draftArea);
  code.append(numbers, runSource, draftWrap);

  const error = el('div', { 'data-role': 'error', class: 'studio-error' });
  const controls = el('div', { class: 'studio-controls' });
  const pause = /** @type {HTMLButtonElement} */ (el('button', { type: 'button', 'data-role': 'pause' }));
  pause.textContent = simText(lang, 'studio.pause');
  const clear = /** @type {HTMLButtonElement} */ (el('button', { type: 'button', 'data-role': 'clear' }));
  clear.textContent = simText(lang, 'studio.clear');
  controls.append(pause, clear);
  const note = el('div', { class: 'studio-note', 'data-role': 'run-note' });
  const timeline = el('div', { 'data-role': 'timeline', class: 'studio-timeline' });

  root.append(bar, meta, code, error, controls, note, timeline);

  const optionsFor = () => {
    const items = o.firmwares ?? [
      { id: 'body', name: 'body' },
      { id: 'custom', name: simText(lang, 'studio.mine') },
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

  selector.addEventListener('change', () => {
    state.view = 'run';
    state.highlight = 0;
    o.onSelect?.(selectionOf());
  });
  runTab.addEventListener('click', () => { state.view = 'run'; render(); });
  draftTab.addEventListener('click', () => { state.view = 'draft'; render(); });
  draftArea.addEventListener('input', () => {
    state.view = 'draft';
    o.onDraft?.(draftArea.value);
  });
  download.addEventListener('click', () => o.onDownload?.(state.selection));
  copy.addEventListener('click', () => o.onCopyExample?.(state.selection));
  flash.addEventListener('click', () => { void o.onFlash?.(state.selection); });
  close.addEventListener('click', () => { root.hidden = true; });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !root.hidden) root.hidden = true;
  });
  pause.addEventListener('click', () => {
    state.paused = !state.paused;
    pause.textContent = state.paused ? simText(lang, 'studio.resume') : simText(lang, 'studio.pause');
    if (!state.paused) schedule();
  });
  clear.addEventListener('click', () => { state.traces = []; state.rendered = 0; timeline.replaceChildren(); });

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

  /** @param {string} source @param {number[]} [errorLines] */
  function renderNumbers(source, errorLines = []) {
    numbers.replaceChildren();
    linesOf(source).forEach((_, index) => {
      const line = document.createElement('span');
      line.textContent = String(index + 1);
      if (errorLines.includes(index + 1)) line.classList.add('error');
      if (state.highlight === index + 1) line.classList.add('current');
      numbers.append(line);
    });
  }

  function renderTrace() {
    if (state.paused) return;
    const started = typeof performance !== 'undefined' ? performance.now() : 0;
    const pending = state.traces.slice(state.rendered, state.rendered + 20);
    state.rendered += pending.length;
    for (const record of pending) {
      if (!['statement', 'log', 'error'].includes(record.kind)) continue;
      const row = el('div', { 'data-role': 'trace' });
      row.textContent = `${record.line ?? ''} ${record.text ?? record.kind}`.trim();
      row.addEventListener('click', () => {
        state.view = 'run';
        state.highlight = record.line ?? 0;
        render();
      });
      timeline.append(row);
    }
    while (timeline.children.length > 200) timeline.firstElementChild?.remove();
    if (typeof performance !== 'undefined') {
      const measured = performance.now() - started;
      state.timings = { ...(state.timings ?? {}), uiMs: measured };
      timing.textContent = timingLine();
    }
    if (state.rendered < state.traces.length) schedule();
  }

  const timingLine = () => `解释器 ${Number(state.timings?.interpreterMs ?? 0).toFixed(1)}/6 ms · UI ${Number(state.timings?.uiMs ?? 0).toFixed(1)}/2 ms`;

  function render() {
    root.dataset.view = state.view;
    const boardFirmware = state.board?.firmware || '';
    const boardName = boardFirmware || simText(lang, 'studio.noFirmware');
    const selection = state.selection ?? { kind: 'body' };
    const selectionId = selection.kind === 'sketch' ? selection.id : selection.kind;
    const isCustom = selection.kind === 'custom';
    const custom = state.custom;
    const draft = custom?.draft ?? '';
    const flashed = custom?.flashed ?? '';
    const isDirty = Boolean(custom) && draft !== flashed;

    boardLabel.textContent = `${simText(lang, 'studio.board')}: ${boardName}`;
    boardMark.textContent = simText(lang, 'studio.onBoard');
    boardMark.hidden = !boardFirmware || selectionId !== boardFirmware;
    dirty.textContent = simText(lang, 'studio.notFlashed');
    dirty.hidden = !(isCustom && isDirty);

    if ([...selector.options].some((option) => option.value === selectionId)) selector.value = selectionId;

    // The code area follows the selection; the timeline below stays on the
    // firmware the board actually runs (spec §11, selection ≠ board).
    const codeSource = isCustom ? (state.view === 'draft' ? draft : flashed) : (state.source ?? '');
    if (runPre.textContent !== codeSource) runPre.textContent = codeSource;
    if (draftArea.value !== draft) draftArea.value = draft;
    const runError = state.runError;
    const gutterErrors = isCustom
      ? (state.view === 'run'
        ? (runError ? [runError] : [])
        : (state.errors ?? []))
      : [];
    renderNumbers(codeSource, gutterErrors.map((/** @type {any} */ e) => e.line));
    runSource.hidden = isCustom && state.view !== 'run';
    draftWrap.hidden = !(isCustom && state.view === 'draft');
    seg.hidden = !isCustom;
    runTab.setAttribute('aria-pressed', String(state.view === 'run'));
    draftTab.setAttribute('aria-pressed', String(state.view === 'draft'));
    runLabel.textContent = !isCustom
      ? (selection.kind === 'sketch' ? simText(lang, 'studio.illustrative') : simText(lang, 'studio.realC'))
      : simText(lang, 'studio.run');

    const boardKind = boardFirmware === 'custom' ? 'custom'
      : boardFirmware === 'body' ? 'body'
        : boardFirmware.startsWith('sketch-') ? 'sketch' : '';
    note.textContent = boardKind === 'body' ? simText(lang, 'studio.bodyRun')
      : boardKind === 'sketch' ? simText(lang, 'studio.sketchRun')
        : boardKind === 'custom'
          ? (flashed ? simText(lang, 'studio.timelineSource') : simText(lang, 'studio.customEmpty'))
          : simText(lang, 'studio.emptyRun');

    copy.disabled = !state.exampleV1;
    flash.disabled = Boolean(state.errors?.length);
    flash.textContent = state.usb
      ? simText(lang, 'studio.flash')
      : `${simText(lang, 'studio.insertFlash')} ${selectionId}`;
    const listed = [...(state.errors ?? []), ...(isCustom && state.view === 'run' && runError ? [runError] : [])];
    error.textContent = listed.map((/** @type {any} */ e) => `${e.line}:${e.column} ${e.message}`).join('\n');
    error.hidden = !listed.length;
    timing.textContent = timingLine();
  }

  render();

  return {
    element: root,
    open() { root.hidden = false; render(); root.focus(); },
    close() { root.hidden = true; },
    toggle() { root.hidden = !root.hidden; if (!root.hidden) { render(); root.focus(); } },
    /** @param {any} [next] */
    update(next = {}) {
      state = { ...state, ...next, timings: next.timings ? { ...state.timings, ...next.timings } : state.timings };
      render();
    },
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
    /** @param {{ interpreterMs?: number, uiMs?: number }} next */
    setTiming(next) {
      state.timings = { ...(state.timings ?? {}), ...next };
      timing.textContent = timingLine();
    },
    get state() { return state; },
  };
}
