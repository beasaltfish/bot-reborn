// A plan's wiring presented spatially when the legacy layout knows every
// endpoint, otherwise as an ordered link list. No schematic is guessed.
import { PARTS } from '../parts.js';

const SVG = 'http://www.w3.org/2000/svg';

/** @param {string} tag @param {Record<string, string | number>} [attrs] */
function svg(tag, attrs = {}) {
  const element = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  return element;
}

/** Where each pin sits on the legacy drawing. */
const LAYOUT = {
  esp: { x: 30, y: 30, w: 120, h: 350, title: 'ESP32-S3', side: 'right', pins: { '3V3': 64, '5V': 92, GND: 120, GPIO12: 172, GPIO13: 200, GPIO14: 228, GPIO15: 256, GPIO4: 292, GPIO5: 314, GPIO6: 336, GPIO7: 358 } },
  mic: { x: 430, y: 20, w: 110, h: 160, title: 'INMP441', side: 'left', pins: { VDD: 50, GND: 72, 'L/R': 94, SCK: 116, WS: 138, SD: 160 } },
  amp: { x: 430, y: 200, w: 110, h: 150, title: 'MAX98357A', side: 'left', pins: { Vin: 230, GND: 252, BCLK: 274, LRC: 296, DIN: 318, '+': 270, '-': 304 } },
  spk: { x: 590, y: 236, w: 56, h: 84, title: 'Speaker', side: 'left', pins: { '+': 270, '-': 304 } },
  toy: { x: 430, y: 370, w: 110, h: 110, title: 'Toy robot', side: 'left', pins: { U3A: 388, U3B: 408, U5A: 428, U5B: 448, GND: 468 } },
};
/** @typedef {keyof typeof LAYOUT} LayoutId */

/** @param {string} point */
function hasPosition(point) {
  const [id, pin] = point.split(':');
  const box = LAYOUT[/** @type {LayoutId} */ (id)];
  return Boolean(box && Object.hasOwn(box.pins, pin));
}

/** @param {string} point @returns {{ x: number, y: number }} */
function where(point) {
  const [id, pin] = point.split(':');
  const box = LAYOUT[/** @type {LayoutId} */ (id)];
  const right = box.side === 'right' || (id === 'amp' && (pin === '+' || pin === '-'));
  return { x: right ? box.x + box.w : box.x, y: /** @type {Record<string, number>} */ (box.pins)[pin] };
}

/** @param {{ a: string, b: string }} link */
function kindOf(link) {
  if (/:(3V3|5V|VDD|Vin)$/.test(link.a) || /:(3V3|5V)$/.test(link.b)) return 'power';
  if (/:GND$/.test(link.b) || /:-$/.test(link.a)) return 'ground';
  return 'signal';
}

/** @param {import('../target.js').Link[]} links */
function schematic(links) {
  const root = svg('svg', { viewBox: '0 0 670 500', role: 'img', 'aria-label': 'Schematic of the target wiring' });
  for (const [id, box] of Object.entries(LAYOUT)) {
    root.append(svg('rect', { x: box.x, y: box.y, width: box.w, height: box.h, rx: 6, class: 'chip' }));
    const title = svg('text', { x: box.x + box.w / 2, y: box.y + 18, class: 'title' });
    title.textContent = box.title;
    root.append(title);
    for (const [pin, y] of Object.entries(box.pins)) {
      const { x } = where(`${id}:${pin}`);
      const inside = x === box.x ? 8 : -8;
      const label = svg('text', { x: x + inside, y: y + 4, class: 'pin', 'text-anchor': inside > 0 ? 'start' : 'end' });
      label.textContent = pin.replace(/^GPIO/, 'GPIO ');
      root.append(label, svg('circle', { cx: x, cy: y, r: 2.6, class: 'dot' }));
    }
  }
  let lane = 0;
  /** @type {Map<string, { x: number, y: number, kind: string }[]>} */
  const turns = new Map();
  links.forEach((link, i) => {
    const a = where(link.a);
    const b = where(link.b);
    let d;
    if (link.b.startsWith('esp:')) {
      const x = 180 + lane++ * 16;
      d = `M${b.x} ${b.y} H${x} V${a.y} H${a.x}`;
      turns.set(link.b, [...(turns.get(link.b) ?? []), { x, y: b.y, kind: kindOf(link) }]);
    } else {
      d = `M${b.x} ${b.y} H${565} V${a.y} H${a.x}`;
    }
    root.append(svg('path', { d, class: `wire ${kindOf(link)}`, 'data-link': i }));
    const n = svg('text', { x: a.x - 13, y: a.y - 4, class: 'num', 'text-anchor': 'middle' });
    n.textContent = String(i + 1);
    root.append(n);
  });
  for (const list of turns.values()) {
    for (const { x, y, kind } of list.slice(0, -1)) root.append(svg('circle', { cx: x, cy: y, r: 3.4, class: `junction ${kind}` }));
  }
  return root;
}


const NODE_W = 150;
const NODE_GAP_X = 72;
const NODE_GAP_Y = 18;
const PIN_H = 16;
const TITLE_H = 24;
const MARGIN = 24;

/** Lay a plan out as a left-to-right graph without knowing physical positions. @param {import('../plan.js').Plan} plan */
function autoLayout(plan) {
  /** @type {Map<string, { pins: string[], first: number, links: number[] }>} */
  const nodes = new Map();
  const ensure = (/** @type {string} */ id) => {
    if (!nodes.has(id)) nodes.set(id, { pins: [], first: Infinity, links: [] });
    return /** @type {{pins:string[],first:number,links:number[]}} */ (nodes.get(id));
  };
  /** @type {Map<string, Set<string>>} */
  const neighbours = new Map();
  plan.links.forEach((/** @type {import('../target.js').Link} */ link, /** @type {number} */ index) => {
    for (const point of [link.a, link.b]) {
      const [id, pin] = point.split(':');
      const node = ensure(id);
      if (!node.pins.includes(pin)) node.pins.push(pin);
      node.first = Math.min(node.first, index);
      node.links.push(index);
      if (!neighbours.has(id)) neighbours.set(id, new Set());
    }
    const [aId] = link.a.split(':');
    const [bId] = link.b.split(':');
    neighbours.get(aId)?.add(bId);
    neighbours.get(bId)?.add(aId);
  });
  const partById = new Map(plan.parts.map((/** @type {import('../plan.js').PlanPart} */ part) => [part.id, part.part]));
  const label = (/** @type {string} */ id) => id === 'esp' ? 'ESP32-S3' : PARTS[partById.get(id) ?? '']?.label ?? id;

  /** @type {Map<string, number>} */
  const layer = new Map();
  const walk = (/** @type {string} */ start, /** @type {number} */ base) => {
    const queue = [start];
    layer.set(start, base);
    for (let i = 0; i < queue.length; i++) {
      for (const next of neighbours.get(queue[i]) ?? []) {
        if (layer.has(next)) continue;
        layer.set(next, /** @type {number} */ (layer.get(queue[i])) + 1);
        queue.push(next);
      }
    }
  };
  if (nodes.has('esp')) walk('esp', 0);
  let nextLayer = layer.size ? Math.max(...layer.values()) + 1 : 0;
  for (const id of nodes.keys()) if (!layer.has(id)) { walk(id, nextLayer); nextLayer = Math.max(...layer.values()) + 1; }

  /** @type {string[][]} */
  const columns = [];
  for (const id of nodes.keys()) {
    const index = /** @type {number} */ (layer.get(id));
    (columns[index] ??= []).push(id);
  }
  for (const column of columns) column?.sort((a, b) => (nodes.get(a)?.first ?? 0) - (nodes.get(b)?.first ?? 0));

  let maxHeight = 0;
  columns.forEach((column, index) => {
    let y = MARGIN;
    for (const id of column ?? []) {
      const node = /** @type {{pins:string[],first:number,links:number[]}} */ (nodes.get(id));
      node.pins.sort((a, b) => {
        const at = (/** @type {string} */ pin) => node.links.find(linkIndex => [plan.links[linkIndex].a, plan.links[linkIndex].b].some(point => point === `${id}:${pin}`)) ?? 0;
        return at(a) - at(b);
      });
      const height = TITLE_H + node.pins.length * PIN_H + 8;
      /** @type {any} */ (node).x = MARGIN + index * (NODE_W + NODE_GAP_X);
      /** @type {any} */ (node).y = y;
      /** @type {any} */ (node).height = height;
      y += height + NODE_GAP_Y;
    }
    maxHeight = Math.max(maxHeight, y);
  });
  const width = MARGIN * 2 + columns.length * NODE_W + Math.max(0, columns.length - 1) * NODE_GAP_X;
  const height = Math.max(maxHeight + MARGIN, 180);
  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Wiring overview' });
  /** @param {string} id @param {string} pin @param {'left'|'right'} side */
  const pinPoint = (id, pin, side) => {
    const node = /** @type {any} */ (nodes.get(id));
    const index = node.pins.indexOf(pin);
    return { x: side === 'right' ? node.x + NODE_W : node.x, y: node.y + TITLE_H + index * PIN_H + PIN_H / 2 };
  };
  for (const [id, node] of nodes) {
    const any = /** @type {any} */ (node);
    root.append(svg('rect', { x: any.x, y: any.y, width: NODE_W, height: any.height, rx: 6, class: 'chip' }));
    const title = svg('text', { x: any.x + NODE_W / 2, y: any.y + 16, class: 'title' });
    title.textContent = label(id);
    root.append(title);
    node.pins.forEach((pin, index) => {
      const y = any.y + TITLE_H + index * PIN_H + PIN_H / 2;
      const text = svg('text', { x: any.x + NODE_W - 8, y: y + 3.5, class: 'pin', 'text-anchor': 'end' });
      text.textContent = pin;
      root.append(text, svg('circle', { cx: any.x + NODE_W, cy: y, r: 2.4, class: 'dot' }), svg('circle', { cx: any.x, cy: y, r: 2.4, class: 'dot' }));
    });
  }
  plan.links.forEach((/** @type {import('../target.js').Link} */ link, /** @type {number} */ index) => {
    const [aId, aPin] = link.a.split(':');
    const [bId, bPin] = link.b.split(':');
    const a = pinPoint(aId, aPin, 'right');
    const b = pinPoint(bId, bPin, 'left');
    const bend = Math.max(30, Math.abs(b.x - a.x) / 2);
    const d = `M${a.x} ${a.y} C${a.x + bend} ${a.y}, ${b.x - bend} ${b.y}, ${b.x} ${b.y}`;
    root.append(svg('path', { d, class: `wire ${kindOf(link)}`, 'data-link': index }));
    const number = svg('text', { x: a.x + 6, y: a.y - 4, class: 'num' });
    number.textContent = String(index + 1);
    root.append(number);
  });
  return root;
}

/** @param {import('../plan.js').Plan} plan */
function list(plan) {
  /** @type {[string, string][]} */ const entries = [['esp', 'ESP32-S3'], ...plan.parts.map(part => /** @type {[string, string]} */ ([part.id, PARTS[part.part]?.label ?? part.part]))];
  const labels = new Map(entries);
  const root = document.createElement('ol');
  for (const link of plan.links) {
    const row = document.createElement('li');
    const endpoints = document.createElement('strong');
    endpoints.textContent = `${link.a} → ${link.b}`;
    const names = document.createElement('p');
    const [aId, aPin] = link.a.split(':');
    const [bId, bPin] = link.b.split(':');
    names.textContent = `${labels.get(aId) ?? aId} ${aPin} → ${labels.get(bId) ?? bId} ${bPin}`;
    row.append(endpoints, names);
    if (link.why) {
      const why = document.createElement('p');
      why.className = 'why';
      why.textContent = link.why;
      row.append(why);
    }
    root.append(row);
  }
  return root;
}

/**
 * A spatial diagram when the legacy layout covers every endpoint, otherwise a
 * link list. `dataset.layout` tells the caller whether the note applies.
 * @param {import('../plan.js').Plan} plan
 */
export function createWiringOverview(plan) {
  const fits = plan.links.length > 0 && plan.links.every(link => hasPosition(link.a) && hasPosition(link.b));
  if (!fits && plan.links.length > 0) {
    const host = document.createElement('div');
    host.dataset.layout = 'auto';
    host.append(autoLayout(plan));
    return host;
  }
  const element = fits ? schematic(plan.links) : list(plan);
  if (element.namespaceURI === SVG) {
    const host = document.createElement('div');
    host.dataset.layout = 'true';
    host.append(element);
    return host;
  }
  element.dataset.layout = 'false';
  return element;
}
