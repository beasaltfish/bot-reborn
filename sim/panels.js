// The page around the bench: the three buttons (Wiring diagram, Hint, Reset
// bench), the one-line status at the bottom, the wiring diagram itself, the
// character picker that opens when the bench powers up. Plain DOM; what any of
// it means is main.js's business. A burnt part is not swapped out any more:
// it stays on the bench until the user drops it in the bin (spec §5.4).
//
// Nothing here is shown by default but the buttons: explanations wait until
// asked for (spec §5).

import { TARGET } from './target.js';

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
 * A point the way the diagram labels it: "GPIO 12", "mic SCK".
 * @param {string} point
 */
function pointName(point) {
  const [id, pin] = point.split(':');
  if (id === 'esp') return pin.replace(/^GPIO(\d+)$/, 'GPIO $1');
  return `${id === 'spk' ? 'speaker' : id} ${pin}`;
}

// ---- The wiring diagram ---------------------------------------------------

/** Where each pin sits on the drawing: the ESP32 on the left, the modules on the right. */
const LAYOUT = {
  esp: { x: 30, y: 30, w: 120, h: 280, title: 'ESP32-S3', side: 'right', pins: { '3V3': 64, '5V': 92, GND: 120, GPIO12: 172, GPIO13: 200, GPIO14: 228, GPIO15: 256 } },
  mic: { x: 430, y: 20, w: 110, h: 160, title: 'INMP441', side: 'left', pins: { VDD: 50, GND: 72, 'L/R': 94, SCK: 116, WS: 138, SD: 160 } },
  amp: { x: 430, y: 200, w: 110, h: 150, title: 'MAX98357A', side: 'left', pins: { Vin: 230, GND: 252, BCLK: 274, LRC: 296, DIN: 318, '+': 270, '-': 304 } },
  spk: { x: 590, y: 236, w: 56, h: 84, title: 'Speaker', side: 'left', pins: { '+': 270, '-': 304 } },
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
  const s = svg('svg', { viewBox: '0 0 670 360', role: 'img', 'aria-label': 'Schematic of the target wiring' });
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
      const x = 180 + lane++ * 19;
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
 *   hint(): string,
 *   reset(): void,
 *   follow(el: HTMLElement, id: string): void,
 * }} opts
 */
export function createPanels(opts) {
  const bar = el('div', { id: 'tools' });
  const diagramBtn = el('button', { type: 'button', class: 'pill' }, ['Wiring diagram']);
  const hintBtn = el('button', { type: 'button', class: 'pill' }, ['Hint']);
  const resetBtn = el('button', { type: 'button', class: 'pill' }, ['Reset bench']);
  const resetAsk = el('span', { class: 'pill confirm', hidden: '' }, [
    'Clear the whole bench? ',
    el('button', { type: 'button', class: 'link danger' }, ['Reset']),
    el('button', { type: 'button', class: 'link' }, ['Keep']),
  ]);
  bar.append(diagramBtn, hintBtn, resetBtn, resetAsk);

  const bubble = el('div', { id: 'hint', role: 'status', hidden: '' });
  const status = el('div', { id: 'status', role: 'status', hidden: '' });
  const picker = el('div', { id: 'picker', hidden: '' });

  const rows = TARGET.map((l, i) => el('li', { 'data-link': String(i) }, [
    el('span', { class: 'num' }, [String(i + 1)]),
    el('span', {}, [el('b', {}, [`${pointName(l.a)} → ${pointName(l.b)}`]), el('span', { class: 'why' }, [l.why])]),
  ]));
  const drawing = diagram();
  const close = el('button', { type: 'button', class: 'close', 'aria-label': 'Close' }, ['×']);
  const panel = el('div', { id: 'diagram', role: 'dialog', 'aria-label': 'Wiring diagram', hidden: '' }, [
    el('header', {}, [el('h2', {}, ['Wiring diagram']), close]),
    drawing,
    el('p', { class: 'note' }, ['GAIN and SD on the amp stay unconnected. The speaker plays the same either way round.']),
    el('ol', {}, rows),
  ]);
  document.body.append(bar, bubble, status, picker, panel);

  // ---- Wiring diagram ----
  const showDiagram = (/** @type {boolean} */ on) => { panel.hidden = !on; };
  diagramBtn.addEventListener('click', () => { hideHint(); showDiagram(Boolean(panel.hidden)); });
  close.addEventListener('click', () => showDiagram(false));
  // Pointing at a line of the list picks its wire out on the drawing.
  for (const r of rows) {
    const path = drawing.querySelector(`path[data-link="${r.dataset.link}"]`);
    r.addEventListener('mouseenter', () => path?.classList.add('lit'));
    r.addEventListener('mouseleave', () => path?.classList.remove('lit'));
  }

  // ---- Hint ----
  /** @type {ReturnType<typeof setTimeout> | null} */
  let hintTimer = null;
  const hideHint = () => {
    bubble.hidden = true;
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = null;
  };
  hintBtn.addEventListener('click', () => {
    if (!bubble.hidden) return hideHint();
    showDiagram(false);
    bubble.textContent = opts.hint();
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
    hideHint();
    asking(false);
  });

  // ---- Status line ----
  /**
   * One line at the bottom; null hides it. Text only, except the admin-page
   * pointer, which is a link.
   * @param {string | null} text
   * @param {{ href: string, label: string }} [link]
   */
  function setStatus(text, link) {
    status.hidden = !text;
    status.replaceChildren(text ?? '');
    if (text && link) status.append(' ', el('a', { href: link.href, target: '_blank', rel: 'noopener' }, [link.label]));
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

  return { status: setStatus, pick, closePicker };
}
