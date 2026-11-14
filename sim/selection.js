// Stable bench selections, independent of scene objects and DOM lifetimes.
import { PARTS } from './parts.js';
import { deviceByPart } from './devices/catalog.js';
import { catalogueEntry } from './ui/catalogue-model.js';
import { simText } from './ui/strings.js';
import { pinDescription } from './pin-info.js';

/** @typedef {null | {kind:'part', id:string} | {kind:'pin', point:string} | {kind:'wire', id:string}} Selection */
/** @param {import('./bench.js').Bench} bench @param {Selection} selection @returns {Selection} */
export function normalizeSelection(bench, selection) {
  if (!selection) return null;
  if (selection.kind === 'part') return bench.placed.some(p => p.id === selection.id) ? selection : null;
  if (selection.kind === 'wire') return bench.wires.some(w => w.id === selection.id) ? selection : null;
  if (selection.kind === 'pin') {
    const colon = selection.point.indexOf(':');
    if (colon < 1) return null;
    const p = bench.placed.find(p => p.id === selection.point.slice(0, colon));
    return p && PARTS[p.part].pins.some(pin => pin.name === selection.point.slice(colon + 1)) ? selection : null;
  }
  return null;
}

/**
 * Keep selection independent of scene lifetimes and notify on meaningful changes.
 * @param {() => import('./bench.js').Bench} getBench
 * @param {(selection: Selection) => void} onSelect
 */
export function createSelection(getBench, onSelect) {
  /** @type {Selection} */
  let current = null;
  /** @param {Selection} next */
  function select(next) {
    const value = normalizeSelection(getBench(), next);
    if (JSON.stringify(current) === JSON.stringify(value)) return;
    current = value;
    onSelect(current);
  }
  return { select, refresh: () => select(current), selection: () => current };
}

/** @param {string} part @param {string} name @param {string} lang */
function pinRoles(part, name, lang) {
  /** @type {string[]} */
  const roles = [];
  if (part === 'dc-source' && name === '+') roles.push(simText(lang, 'selection.sourcePositive'));
  if (part === 'dc-source' && name === '-') roles.push(simText(lang, 'selection.sourceReturn'));
  for (const cap of deviceByPart(part)?.capabilities ?? []) {
    if (cap.kind === 'supply') {
      if (cap.positive === name) roles.push('Supply +');
      if (cap.ground === name) roles.push('Ground');
    } else if (cap.kind === 'i2c') {
      if (cap.sda === name) roles.push('I2C SDA');
      if (cap.scl === name) roles.push('I2C SCL');
    } else if (cap.kind === 'spi') {
      if (cap.sck === name) roles.push('SPI SCK');
      if (cap.mosi === name) roles.push('SPI MOSI');
      if (cap.cs === name) roles.push('SPI CS');
    } else if (cap.kind === 'source' && 'positive' in cap) {
      if (cap.positive === name) roles.push(simText(lang, 'selection.sourcePositive'));
      if (cap.negative === name) roles.push(simText(lang, 'selection.sourceReturn'));
    } else if (cap.kind === 'battery') {
      if (cap.positive === name) roles.push(simText(lang, 'selection.sourcePositive'));
      if (cap.negative === name) roles.push(simText(lang, 'selection.sourceReturn'));
    } else if (cap.kind === 'regulator') {
      if (cap.input === name) roles.push(simText(lang, 'selection.regulatorInput'));
      if (cap.output === name) roles.push(simText(lang, 'selection.regulatorOutput'));
      if (cap.ground === name) roles.push('Ground');
    } else if ((cap.kind === 'gpio' || cap.kind === 'pwm' || cap.kind === 'oneWire') && cap.pin === name) roles.push(cap.kind);
    else if (cap.kind === 'source' && 'pin' in cap && cap.pin === name) roles.push('Source');
  }
  const pin = PARTS[part]?.pins.find(p => p.name === name);
  if (pin?.role) roles.push(pin.role);
  return [...new Set(roles)];
}

/** @param {import('./bench.js').Bench} bench @param {Selection} selection @param {string} lang */
export function describeSelection(bench, selection, lang) {
  const s = normalizeSelection(bench, selection);
  if (!s) return null;
  const text = (/** @type {string} */ key) => simText(lang, `selection.${key}`);
  if (s.kind === 'part') {
    const p = bench.placed.find(p => p.id === s.id);
    if (!p) return null;
    return { kind: s.kind, title: `${catalogueEntry(p.part, lang)?.name ?? PARTS[p.part].label} (${p.id})`, rows: [], actions: [], points: PARTS[p.part].pins.map(pin => `${p.id}:${pin.name}`) };
  }
  if (s.kind === 'pin') {
    const colon = s.point.indexOf(':');
    const p = bench.placed.find(p => p.id === s.point.slice(0, colon));
    if (!p) return null;
    const name = s.point.slice(colon + 1);
    const roles = pinRoles(p.part, name, lang);
    const pin = PARTS[p.part].pins.find(item => item.name === name);
    const rows = [{ label: text('role'), value: roles.join(', ') || text('unknownRole') }];
    if (pin) rows.push({ label: text('description'), value: pinDescription(p.part, pin, lang) });
    return { kind: s.kind, title: s.point, rows, actions: [{ id: 'start-wire', label: text('startWire') }], points: [s.point] };
  }
  const wire = bench.wires.find(w => w.id === s.id);
  if (!wire) return null;
  return { kind: s.kind, title: `${text('wire')} ${wire.id}`, rows: [{ label: text('endpointA'), value: wire.a }, { label: text('endpointB'), value: wire.b }, { label: text('color'), value: wire.color }], actions: [{ id: 'remove-wire', label: text('removeWire') }], points: [wire.a, wire.b] };
}
