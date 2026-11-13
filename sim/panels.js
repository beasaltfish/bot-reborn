// The page around the bench: the buttons (Wire it for me, Parts, Wiring diagram, Hint, Reset
// bench), the one-line status at the bottom, the parts bin, the wiring diagram
// and the character picker that opens when the bench powers up. Plain DOM;
// what any of it means is main.js's business. A burnt part is not swapped out
// any more: it stays on the bench until the user drops it in the bin (spec §5.4).
//
// Nothing here is shown by default but the buttons: explanations and the parts
// bin wait until asked for (spec §5, anti-goal: a busy screen).

import { TARGET } from './target.js';
import { SCREENS } from '../core/screens.js';
import { catalogueView } from './ui/catalogue-model.js';
import { createCataloguePanel } from './ui/catalogue-panel.js';
import { createProjectPanel } from './ui/project-panel.js';
import { simText } from './ui/strings.js';
import { createLanguageControl } from './ui/language-control.js';
import { RECIPES, DEFAULT_SCREEN } from './recipes.js';
import { PROJECTS } from './projects.js';
import { WIRE_PALETTE } from './wire-color.js';
import { createPropertyEditor } from './ui/property-editor.js';
import { createBme280Panel } from './ui/bme280-panel.js';
import { createPartThumbnails } from './scene/thumbnails.js';

/** @typedef {{ id: string, name: string, note: string | null }} Choice */

const SVG = 'http://www.w3.org/2000/svg';
const HINT_MS = 7000;

/**
 * @param {string} tag
 * @param {Record<string, string>} [attrs]
 * @param {(Node | string)[]} [kids]
 */
function el(tag, attrs = {}, kids = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}

/**
 * @param {string} tag
 * @param {Record<string, string | number>} [attrs]
 */
function svg(tag, attrs = {}) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/**
 * A point the way the diagram labels it: "GPIO 12", "mic SCK", "speaker 2 +".
 * @param {string} point
 */
function pointName(point) {
  const [id, pin] = point.split(':');
  if (id === 'esp') return pin.replace(/^GPIO(\d+)$/, 'GPIO $1');
  const m = /^([a-z]+?)(\d*)$/.exec(id);
  const stem = m ? m[1] : id;
  const num = m ? m[2] : '';
  const label = /** @type {Record<string, string>} */ ({ mic: 'mic', amp: 'amp', spk: 'speaker', scr: 'screen' })[stem] ?? stem;
  return `${label}${num ? ` ${num}` : ''} ${pin}`;
}

// ---- The wiring diagram ---------------------------------------------------

/** Where each pin sits on the drawing: the ESP32 on the left, the modules on the right. */
const LAYOUT = {
  esp: { x: 30, y: 30, w: 120, h: 350, title: 'ESP32-S3', side: 'right', pins: { '3V3': 64, '5V': 92, GND: 120, GPIO12: 172, GPIO13: 200, GPIO14: 228, GPIO15: 256, GPIO4: 292, GPIO5: 314, GPIO6: 336, GPIO7: 358 } },
  mic: { x: 430, y: 20, w: 110, h: 160, title: 'INMP441', side: 'left', pins: { VDD: 50, GND: 72, 'L/R': 94, SCK: 116, WS: 138, SD: 160 } },
  amp: { x: 430, y: 200, w: 110, h: 150, title: 'MAX98357A', side: 'left', pins: { Vin: 230, GND: 252, BCLK: 274, LRC: 296, DIN: 318, '+': 270, '-': 304 } },
  spk: { x: 590, y: 236, w: 56, h: 84, title: 'Speaker', side: 'left', pins: { '+': 270, '-': 304 } },
  toy: { x: 430, y: 370, w: 110, h: 110, title: 'Toy robot', side: 'left', pins: { U3A: 388, U3B: 408, U5A: 428, U5B: 448, GND: 468 } },
};

/** @param {string} point @returns {{ x: number, y: number }} */
function where(point) {
  const [id, pin] = point.split(':');
  const box = LAYOUT[/** @type {keyof typeof LAYOUT} */ (id)];
  // The amp's screw terminal is on its right edge; every other pin on the side facing its partner.
  const right = box.side === 'right' || (id === 'amp' && (pin === '+' || pin === '-'));
  return { x: right ? box.x + box.w : box.x, y: /** @type {Record<string, number>} */ (box.pins)[pin] };
}

/** @param {{ a: string, b: string }} l */
function kindOf(l) {
  if (/:(3V3|5V|VDD|Vin)$/.test(l.a) || /:(3V3|5V)$/.test(l.b)) return 'power';
  if (/:GND$/.test(l.b) || /:-$/.test(l.a)) return 'ground';
  return 'signal';
}

function diagram() {
  const s = svg('svg', { viewBox: '0 0 670 500', role: 'img', 'aria-label': 'Schematic of the target wiring' });
  for (const [id, box] of Object.entries(LAYOUT)) {
    s.append(svg('rect', { x: box.x, y: box.y, width: box.w, height: box.h, rx: 6, class: 'chip' }));
    const t = svg('text', { x: box.x + box.w / 2, y: box.y + 18, class: 'title' });
    t.textContent = box.title;
    s.append(t);
    for (const [pin, y] of Object.entries(box.pins)) {
      const { x } = where(`${id}:${pin}`);
      const inside = x === box.x ? 8 : -8;
      const label = svg('text', { x: x + inside, y: y + 4, class: 'pin', 'text-anchor': inside > 0 ? 'start' : 'end' });
      label.textContent = pin.replace(/^GPIO/, 'GPIO ');
      s.append(label, svg('circle', { cx: x, cy: y, r: 2.6, class: 'dot' }));
    }
  }
  // Each link from the ESP32 runs out on its own vertical lane, so a pin
  // feeding two chips (GND, the clocks) visibly fans out.
  let lane = 0;
  /** @type {Map<string, { x: number, y: number, kind: string }[]>} */
  const turns = new Map();
  TARGET.forEach((l, i) => {
    const a = where(l.a);
    const b = where(l.b);
    let d;
    if (l.b.startsWith('esp:')) {
      // Sixteen links end on the ESP32 now, so the lanes are closer together:
      // the last one has to stay left of the modules column at x = 430.
      const x = 180 + lane++ * 16;
      d = `M${b.x} ${b.y} H${x} V${a.y} H${a.x}`;
      turns.set(l.b, [...(turns.get(l.b) ?? []), { x, y: b.y, kind: kindOf(l) }]);
    } else {
      d = `M${b.x} ${b.y} H${565} V${a.y} H${a.x}`;
    }
    s.append(svg('path', { d, class: `wire ${kindOf(l)}`, 'data-link': i }));
    const n = svg('text', { x: a.x - 13, y: a.y - 4, class: 'num', 'text-anchor': 'middle' });
    n.textContent = String(i + 1);
    s.append(n);
  });
  // Wires off one pin share its run, and each turns away where a later one
  // carries on. Only those turns get a dot: a crossing without one is no join.
  for (const t of turns.values()) {
    for (const { x, y, kind } of t.slice(0, -1)) s.append(svg('circle', { cx: x, cy: y, r: 3.4, class: `junction ${kind}` }));
  }
  return s;
}

// ---- The panels -------------------------------------------------------------

/**
 * @param {{
 *   hint(projectId?: string): string|null,
 *   reset(): void,
 *   follow(el: HTMLElement, id: string): void,
 *   add(part: string): void,
 *   carry(part: string, e: PointerEvent): void,
 *   learn?(part: string): void,
 *   changeLanguage?(lang:'en'|'zh'): boolean,
 *   projectState?(id: string): import('./ui/project-panel.js').State,
 *   focusProject?(points: string[]): void,
 *   clearProjectFocus?(): void,
 *   start(recipeId: string, screenId: string | undefined, mode: 'watch' | 'step',
 *     hooks: { onSay(text: string): void, onEnd(): void }, wand: boolean, speed: number): { next(): void, finish(): void, skip(): void, stop(): void, speed(x: number): void } | null,
 *   speed: number,
 *   rememberSpeed(x: number): void,
 * }} opts
 */
export function createPanels(opts) {
  const lang = document.documentElement.lang === 'zh' ? 'zh' : 'en';
  const t = (/** @type {string} */ key) => simText(lang, `tools.${key}`);
  const bar = el('div', { id: 'tools' });
  const diagramBtn = el('button', { type: 'button', class: 'pill' }, [t('diagram')]);
  const hintBtn = el('button', { type: 'button', class: 'pill' }, [t('hint')]);
  const resetBtn = el('button', { type: 'button', class: 'pill' }, [t('reset')]);
  const resetAsk = el('span', { class: 'pill confirm', hidden: '' }, [
    t('confirmReset'),
    el('button', { type: 'button', class: 'link danger' }, [t('confirm')]),
    el('button', { type: 'button', class: 'link' }, [t('keep')]),
  ]);
  bar.append(diagramBtn, hintBtn, resetBtn, resetAsk);
  if (opts.changeLanguage) bar.append(createLanguageControl(document.documentElement.lang === 'zh' ? 'zh' : 'en', opts.changeLanguage).element);

  const bubble = el('div', { id: 'hint', role: 'status', hidden: '' });
  const status = el('div', { id: 'status', role: 'status', hidden: '' });
  const picker = el('div', { id: 'picker', hidden: '' });

  const drawing = diagram();
  const list = el('ol');
  /**
   * One line of the diagram's list.
   * @param {{ a: string, b: string, why: string }} l @param {number} i
   */
  const row = (l, i) => {
    const r = el('li', { 'data-link': String(i) }, [
      el('span', { class: 'num' }, [String(i + 1)]),
      el('span', {}, [el('b', {}, [`${pointName(l.a)} → ${pointName(l.b)}`]), el('span', { class: 'why' }, [l.why])]),
    ]);
    // Pointing at a line picks its wire out on the drawing, when there is one.
    const path = drawing.querySelector(`path[data-link="${i}"]`);
    r.addEventListener('mouseenter', () => path?.classList.add('lit'));
    r.addEventListener('mouseleave', () => path?.classList.remove('lit'));
    return r;
  };
  /**
   * The list of wires to make: the audio ones always, then the screens that
   * are on the bench (spec §5.5), with the one-model rule said once.
   * @param {{ a: string, b: string, why: string }[]} all @param {string[]} screenIds
   */
  function links(all, screenIds) {
    list.replaceChildren();
    let screens = false;
    let toys = false;
    all.forEach((l, i) => {
      const isScreen = screenIds.includes(l.a.slice(0, l.a.indexOf(':')));
      if (isScreen && !screens) {
        screens = true;
        list.append(el('li', { class: 'section' }, ['Screen']));
      }
      const isToy = l.a.startsWith('toy:') || l.b.startsWith('toy:');
      if (isToy && !toys) {
        toys = true;
        list.append(el('li', { class: 'section' }, ['Toy robot']));
      }
      list.append(row(l, i));
    });
    if (screens) {
      list.append(el('li', { class: 'section note' }, [
        'Only one kind of screen at a time: the firmware drives the model you pick on its serial console.',
      ]));
    }
    if (toys) {
      list.append(el('li', { class: 'section note' }, [
        'U3 drives the wheels and U5 swings the steering axle: four inputs, one shared ground.',
      ]));
    }
  }
  links(TARGET, []);
  const close = el('button', { type: 'button', class: 'close', 'aria-label': t('close') }, ['×']);
  const panel = el('div', { id: 'diagram', role: 'dialog', 'aria-label': t('diagram'), hidden: '' }, [
    el('header', {}, [el('h2', {}, [t('diagram')]), close]),
    drawing,
    el('p', { class: 'note' }, ['GAIN and SD on the amp stay unconnected. The speaker plays the same either way round.']),
    list,
  ]);
  // ---- The parts catalogue ----
  const favouriteKey = 'botreborn.sim.favourites';
  /** @type {string[]} */
  let favourites = [];
  try {
    const stored = JSON.parse(window.localStorage.getItem(favouriteKey) ?? '[]');
    if (Array.isArray(stored)) favourites = stored.filter(value => typeof value === 'string');
  } catch { /* storage unavailable or corrupt: use an empty list */ }
  let query = '';
  /** @type {string[]} */ let categories = [];
  /** @type {string[]} */ let tags = [];
  /** @param {string[]} values @param {string} value */
  const toggle = (values, value) => values.includes(value) ? values.filter(v => v !== value) : [...values, value];
  const all = catalogueView({ lang }).map(section => ({ ...section, entries: section.entries.filter(entry => entry.part !== 'esp32') })).filter(section => section.entries.length);
  const availableCategories = all.map(section => ({ id: section.id, label: section.label }));
  const availableTags = [...new Set(all.flatMap(section => section.entries.flatMap(entry => entry.interfaces)))].sort();
  /** @type {ReturnType<typeof createPartThumbnails>|null} */ let thumbnails = null;
  const catalogue = createCataloguePanel({
    lang,
    thumbnail: part => thumbnails ? thumbnails(part) : null,
    add: opts.add,
    carry: opts.carry,
    learn: part => opts.learn?.(part),
    setQuery: value => { query = value; renderCatalogue(); },
    toggleCategory: value => { categories = toggle(categories, value); renderCatalogue(); },
    toggleTag: value => { tags = toggle(tags, value); renderCatalogue(); },
    toggleFavourite: value => {
      favourites = toggle(favourites, value);
      try { window.localStorage.setItem(favouriteKey, JSON.stringify(favourites)); } catch { /* not saved */ }
      renderCatalogue();
    },
  });
  function renderCatalogue() {
    const sections = catalogueView({ query, categories, tags, favourites, lang }).map(section => ({ ...section, entries: section.entries.filter(entry => entry.part !== 'esp32') })).filter(section => section.entries.length);
    catalogue.render({ query, sections, categories: availableCategories, tags: availableTags, selectedCategories: categories, selectedTags: tags });
  }
  renderCatalogue();
  const partsPanel = catalogue.element;
  partsPanel.id = 'partsbin';
  partsPanel.setAttribute('role', 'dialog');
  const partsBtn = el('button', { type: 'button', class: 'pill' }, [t('parts')]);
  const projectBtn = el('button', { type: 'button', class: 'pill' }, [simText(lang, 'project.button')]);
  bar.prepend(partsBtn, projectBtn);
  const projectView = createProjectPanel({ lang, focus: points => {
    // On a phone the sidebar leaves too little bench visible to frame two pins.
    if (window.innerWidth < 600) showProject(false);
    opts.focusProject?.(points);
  }, leave: () => {
    projectSelect.value = '';
    projectView.showProject('');
    opts.clearProjectFocus?.();
    refreshProject();
  } });
  const projectSelect = /** @type {HTMLSelectElement} */ (el('select', { 'aria-label': simText(lang, 'project.choose') }));
  for (const project of PROJECTS) {
    const label = simText(lang, `project.${project.id}`);
    projectSelect.append(el('option', { value: project.id }, [label === `project.${project.id}` ? project.name : label]));
  }
  projectSelect.selectedIndex = -1;
  const projectClose = el('button', { type: 'button', class: 'close', 'aria-label': simText(lang, 'project.close') }, ['×']);
  const projectPanel = el('div', { id: 'project-panel', role: 'region', 'aria-label': simText(lang, 'project.button'), hidden: '' }, [
    el('header', {}, [el('h2', {}, [simText(lang, 'project.button')]), projectClose]), projectSelect, projectView.element,
  ]);
  function refreshProject() {
    if (projectPanel.hidden) return;
    const state = opts.projectState?.(projectSelect.value);
    const free = opts.projectState?.('');
    if (state) projectView.render(state, free ?? state);
  }
  /** @param {string} id */
  function selectProject(id) { projectSelect.value = id; projectView.showProject(id); refreshProject(); }
  const showProject = (/** @type {boolean} */ on) => {
    if (!on && !projectPanel.hidden) opts.clearProjectFocus?.();
    projectPanel.hidden = !on;
    if (on) refreshProject();
  };
  projectSelect.addEventListener('change', () => { opts.clearProjectFocus?.(); projectView.showProject(projectSelect.value); refreshProject(); });
  projectClose.addEventListener('click', () => showProject(false));
  projectBtn.addEventListener('click', () => { showParts(false); showDiagram(false); showWire(false); showProject(Boolean(projectPanel.hidden)); });
  const showParts = (/** @type {boolean} */ on) => {
    if (on && !thumbnails) { thumbnails = createPartThumbnails(); renderCatalogue(); }
    if (on) catalogue.open(); else catalogue.close();
  };
  partsBtn.addEventListener('click', () => { showProject(false); showDiagram(false); showWire(false); showParts(Boolean(partsPanel.hidden)); });
  document.body.append(bar, bubble, status, picker, panel, partsPanel, projectPanel);

  // ---- Wire it for me ----
  const wireBtn = el('button', { type: 'button', class: 'pill' }, [t('wire')]);
  bar.prepend(wireBtn);
  const recipeBoxes = RECIPES.map((r, i) => {
    const input = /** @type {HTMLInputElement} */ (el('input', { type: 'radio', name: 'recipe', value: r.id }));
    if (r.id === 'screen') input.setAttribute('checked', '');
    return input;
  });
  const screenSel = el('select', { 'aria-label': t('screen') }, SCREENS.map((s) => {
    const o = el('option', { value: s.id }, [s.label]);
    if (s.id === DEFAULT_SCREEN) o.setAttribute('selected', '');
    return o;
  }));
  const wandBox = /** @type {HTMLInputElement} */ (el('input', { type: 'checkbox', name: 'wand' }));
  const watchBtn = el('button', { type: 'button', class: 'pill' }, [t('watch')]);
  const stepBtn = el('button', { type: 'button', class: 'pill' }, [t('step')]);
  const wireClose = el('button', { type: 'button', class: 'close', 'aria-label': t('close') }, ['×']);
  const wirePanel = el('div', { id: 'wire', role: 'dialog', 'aria-label': t('wire'), hidden: '' }, [
    el('header', {}, [el('h2', {}, [t('wire')]), wireClose]),
    ...RECIPES.map((r, i) => el('label', { class: 'opt' }, [recipeBoxes[i], simText(lang, `project.${r.id}`)])),
    screenSel,
    el('label', { class: 'opt' }, [wandBox, t('wand')]),
    el('div', { class: 'go' }, [watchBtn, stepBtn]),
  ]);
  const runBar = el('div', { id: 'runbar', role: 'status', hidden: '' });
  document.body.append(wirePanel, runBar);
  const chosen = () => recipeBoxes.find((b) => b.checked);
  const syncScreen = () => { screenSel.hidden = chosen()?.value !== 'screen'; };
  for (const b of recipeBoxes) b.addEventListener('change', syncScreen);
  syncScreen();
  const showWire = (/** @type {boolean} */ on) => { wirePanel.hidden = !on; };
  wireBtn.addEventListener('click', () => { hideHint(); showParts(false); showProject(false); showDiagram(false); showWire(Boolean(wirePanel.hidden)); });
  wireClose.addEventListener('click', () => showWire(false));

  /**
   * The bar while a run is on: the step's words (step by step) and the controls.
   * @param {'watch' | 'step'} mode
   */
  function go(mode) {
    const id = chosen()?.value;
    if (!id) return;
    runBar.replaceChildren();
    const words = el('span', { class: 'say' });
    // The remembered pace, if it is one of the buttons; 1× otherwise.
    let speed = [1, 2, 3, 4].includes(opts.speed) ? opts.speed : 1;
    /** @type {ReturnType<typeof opts.start>} */
    const run = opts.start(id, id === 'screen' ? /** @type {HTMLSelectElement} */ (screenSel).value : undefined, mode, {
      onSay: (text) => { words.textContent = text; },
      onEnd: () => { runBar.hidden = true; runBar.replaceChildren(); },
    }, wandBox.checked, speed);
    if (!run) return;
    showWire(false);
    /** @param {string} label @param {() => void} f */
    const button = (label, f) => {
      const b = el('button', { type: 'button', class: 'link' }, [label]);
      b.addEventListener('click', f);
      return b;
    };
    // The pace belongs to the run, not to the dialog it was started from: any
    // of them can be picked while the bench is being built, and it is
    // remembered. Each button keeps its place, so none of them dodges the pointer.
    const paces = el('span', { class: 'pace' });
    /** @type {HTMLButtonElement[]} */
    const paceButtons = [1, 2, 3, 4].map((x) => {
      const b = /** @type {HTMLButtonElement} */ (el('button', {
        type: 'button', class: 'link', 'aria-pressed': String(x === speed),
      }, [`${x}×`]));
      b.addEventListener('click', () => {
        speed = x;
        run.speed(speed);
        opts.rememberSpeed(speed);
        for (const other of paceButtons) other.setAttribute('aria-pressed', String(other === b));
      });
      paces.append(b);
      return b;
    });
    if (mode === 'step') runBar.append(words, paces, button('Next', run.next), button('Finish', run.finish), button('Stop', run.stop));
    else runBar.append(words, paces, button('Skip', run.skip), button('Stop', run.stop));
    runBar.hidden = false;
  }
  watchBtn.addEventListener('click', () => go('watch'));
  stepBtn.addEventListener('click', () => go('step'));

  // ---- Wiring diagram ----
  const showDiagram = (/** @type {boolean} */ on) => { panel.hidden = !on; };
  diagramBtn.addEventListener('click', () => {
    if (!projectSelect.value) { explainNeedsPlan(); return; }
    hideHint(); showParts(false); showProject(false); showWire(false); showDiagram(Boolean(panel.hidden));
  });
  close.addEventListener('click', () => showDiagram(false));

  // ---- Hint ----
  /** @type {ReturnType<typeof setTimeout> | null} */
  let hintTimer = null;
  const hideHint = () => {
    bubble.hidden = true;
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = null;
  };
  /** Put a one-line reason in the existing hint bubble. */
  function explainNeedsPlan() {
    hideHint();
    bubble.textContent = simText(lang, 'guidance.needsPlan');
    bubble.hidden = false;
    hintTimer = setTimeout(hideHint, HINT_MS);
  }
  hintBtn.addEventListener('click', () => {
    if (!bubble.hidden) return hideHint();
    if (!projectSelect.value) { explainNeedsPlan(); return; }
    showDiagram(false);
    bubble.textContent = opts.hint(projectSelect.value || undefined) ?? '';
    bubble.hidden = false;
    hintTimer = setTimeout(hideHint, HINT_MS);
  });

  // ---- Reset bench, confirmed in place ----
  const asking = (/** @type {boolean} */ on) => {
    resetBtn.hidden = on;
    resetAsk.hidden = !on;
  };
  resetBtn.addEventListener('click', () => asking(true));
  const [yes, no] = resetAsk.querySelectorAll('button');
  yes.addEventListener('click', () => { asking(false); hideHint(); opts.reset(); });
  no.addEventListener('click', () => asking(false));

  addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;
    showDiagram(false);
    showWire(false);
    showParts(false);
    showProject(false);
    hideHint();
    asking(false);
  });

  // ---- Status line ----
  /**
   * One line at the bottom; null hides it. Text only, except a pointer: a
   * link that opens in a new tab, or an action that runs in place.
   * @param {string | null} text
   * @param {{ href: string, label: string } | { action: { label: string, run(): void } } | { actions: { label: string, run(): void }[] }} [link]
   */
  function setStatus(text, link) {
    status.hidden = !text;
    status.replaceChildren(text ?? '');
    if (!text || !link) return;
    if ('action' in link || 'actions' in link) {
      const all = 'actions' in link ? link.actions : [link.action];
      all.forEach((act, i) => {
        const a = el('a', { href: '#', role: 'button' }, [act.label]);
        a.addEventListener('click', (e) => { e.preventDefault(); act.run(); });
        status.append(i ? ' · ' : ' ', a);
      });
    } else {
      status.append(' ', el('a', { href: link.href, target: '_blank', rel: 'noopener' }, [link.label]));
    }
  }

  // ---- Character picker ----
  /** @type {(() => void) | null} */
  let onCancel = null;
  function closePicker() {
    picker.hidden = true;
    picker.replaceChildren();
    onCancel = null;
  }
  /**
   * Which character this bench plugs in as. Those that cannot be used now
   * are listed, greyed, with why.
   * @param {Choice[]} choices
   * @param {{ pick(id: string, name: string): void, cancel(): void }} on
   */
  function pick(choices, on) {
    closePicker();
    onCancel = on.cancel;
    const list = el('div', { class: 'choices' });
    for (const c of choices) {
      const b = el('button', { type: 'button', class: 'choice' }, [el('span', { class: 'name' }, [c.name])]);
      if (c.note) {
        b.setAttribute('disabled', '');
        b.append(el('span', { class: 'why' }, [c.note]));
      }
      b.addEventListener('click', () => { closePicker(); on.pick(c.id, c.name); });
      list.append(b);
    }
    const cancel = el('button', { type: 'button', class: 'link' }, ['Unplug']);
    cancel.addEventListener('click', () => { const f = onCancel; closePicker(); f?.(); });
    picker.append(el('div', { class: 'head' }, ['Power is on. Plug into which character?']), list, cancel);
    picker.hidden = false;
    /** @type {HTMLButtonElement | null} */ (list.querySelector('button:not([disabled])'))?.focus();
  }
  addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || picker.hidden) return;
    const f = onCancel;
    closePicker();
    f?.();
  });

  const wireMenuElement = el('div', { id: 'wire-menu', hidden: '', role: 'group', 'aria-label': 'Wire options' });
  /** @type {(() => void) | null} */
  let releasePressed = null;
  /** @type {{id:string, editor:ReturnType<typeof createPropertyEditor>, sensor:ReturnType<typeof createBme280Panel>|null} | null} */
  let activePart = null;
  function closeOptions() {
    const release = releasePressed;
    releasePressed = null;
    activePart = null;
    wireMenuElement.hidden = true;
    release?.();
  }
  document.body.append(wireMenuElement);
  document.addEventListener('pointerdown', (event) => {
    if (!wireMenuElement.hidden && event.target instanceof Node && !wireMenuElement.contains(event.target)) closeOptions();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeOptions();
  });
  /** @param {string} id @param {number} x @param {number} y @param {{color(value: string): void, remove(): void}} actions */
  function wireMenu(id, x, y, actions) {
    closeOptions();
    wireMenuElement.replaceChildren(el('span', {}, [`Wire ${id}`]));
    for (const { id: name, color } of WIRE_PALETTE) {
      if (!color) continue;
      const label = name[0].toUpperCase() + name.slice(1);
      const button = el('button', { type: 'button', 'aria-label': label, title: label, class: 'swatch', style: `background:${color}` });
      button.addEventListener('click', () => { actions.color(color); wireMenuElement.hidden = true; });
      wireMenuElement.append(button);
    }
    const remove = el('button', { type: 'button', class: 'link danger' }, ['Remove']);
    remove.addEventListener('click', () => { actions.remove(); wireMenuElement.hidden = true; });
    const closeMenu = el('button', { type: 'button', class: 'link', 'aria-label': 'Close wire options' }, ['×']);
    closeMenu.addEventListener('click', () => { wireMenuElement.hidden = true; });
    wireMenuElement.append(remove, closeMenu);
    wireMenuElement.style.left = `${Math.max(8, Math.min(x, window.innerWidth - Math.min(340, window.innerWidth - 16)))}px`;
    wireMenuElement.style.top = `${Math.max(8, Math.min(y, window.innerHeight - 60))}px`;
    wireMenuElement.hidden = false;
  }
  /** @param {string} id @param {number} x @param {number} y @param {Record<string, import('./devices/catalog.js').PropertyDef>} schema @param {Record<string, number|string|boolean>} values @param {{state:string,currentMa:number}|null} led @param {(key:string,value:number|string|boolean)=>void} change @param {{state:import('./ui/bme280-panel.js').SensorState,environment:import('./ui/bme280-panel.js').Environment,change(key:string,value:number):void}} [bme] */
  function partMenu(id, x, y, schema, values, led, change, bme) {
    closeOptions();
    wireMenuElement.replaceChildren(el('strong', {}, [id]));
    if (led) {
      const message = /** @type {Record<string, string>} */ ({ off: 'No powered loop detected.', short: 'The supply terminals are shorted; separate the positive and negative connections.', reversed: 'LED polarity is reversed; connect A towards positive and K towards negative.', on: 'LED is lit.', limited: 'Supply current limit is active.', overcurrent: 'Current exceeds the LED rating.', unsupported: 'This circuit topology is not supported.', burnt: 'LED is burnt. Replace it and check the current limit.' })[led.state] ?? led.state;
      wireMenuElement.append(el('span', {}, [`${message} ${led.currentMa.toFixed(2)} mA`]));
    }
    const { pressed, ...ordinarySchema } = schema;
    if (pressed?.kind === 'boolean') {
      const press = /** @type {HTMLButtonElement} */ (el('button', { type: 'button', class: 'pin', 'aria-label': 'Hold to press' }, ['Hold to press']));
      let down = false;
      const release = () => { if (down) { down = false; change('pressed', false); } };
      releasePressed = release;
      press.addEventListener('pointerdown', event => { event.preventDefault(); down = true; press.setPointerCapture(event.pointerId); change('pressed', true); });
      press.addEventListener('pointerup', release);
      press.addEventListener('pointercancel', release);
      press.addEventListener('lostpointercapture', release);
      press.addEventListener('keydown', event => { if (!event.repeat && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); down = true; change('pressed', true); } });
      press.addEventListener('keyup', event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); release(); } });
      press.addEventListener('blur', release);
      wireMenuElement.append(press);
    }
    const editor = createPropertyEditor(ordinarySchema, values, change);
    const sensor = bme ? createBme280Panel({ lang, change: bme.change }) : null;
    if (sensor && bme) sensor.update(bme.state, bme.environment);
    activePart = { id, editor, sensor };
    wireMenuElement.append(editor.element);
    if (sensor) wireMenuElement.append(sensor.element);
    const close = el('button', { type: 'button', class: 'link', 'aria-label': 'Close part options' }, ['×']);
    close.addEventListener('click', closeOptions);
    wireMenuElement.append(close);
    wireMenuElement.style.left = `${Math.max(8, Math.min(x, window.innerWidth - Math.min(340, window.innerWidth - 16)))}px`;
    wireMenuElement.style.top = `${Math.max(8, Math.min(y, window.innerHeight - 100))}px`;
    wireMenuElement.hidden = false;
    const rect = wireMenuElement.getBoundingClientRect();
    wireMenuElement.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    wireMenuElement.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
  }
  /** @param {string} id @param {Record<string, number|string|boolean> | null} values @param {import('./ui/bme280-panel.js').SensorState} [state] @param {import('./ui/bme280-panel.js').Environment} [environment] */
  function refreshPart(id, values, state, environment) {
    if (!activePart || activePart.id !== id || wireMenuElement.hidden) return;
    if (values === null) closeOptions();
    else {
      activePart.editor.update(values);
      if (state && environment) activePart.sensor?.update(state, environment);
    }
  }
  return { status: setStatus, pick, closePicker, links, wireMenu, partMenu, refreshPart, openPartId: () => activePart?.id ?? null, refreshProject, selectProject, openProject: (/** @type {string} */ id) => { selectProject(id); showParts(false); showDiagram(false); showWire(false); showProject(true); } };
}
