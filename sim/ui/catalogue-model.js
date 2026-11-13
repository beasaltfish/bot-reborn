import { DEVICES, firmwareIndependent } from '../devices/catalog.js';
import { PROFILES } from '../devices/profiles.js';
import { PARTS } from '../parts.js';
import { screenById } from '../../core/screens.js';
import { DEFAULT_LED_FORWARD_VOLTAGE } from '../electrical/led.js';
import { BATTERY_CHEMISTRIES } from '../electrical/power-sources.js';
import { simText } from './strings.js';

/** @typedef {{ part: string, name: string, summary: string, category: string, tags: string[], voltage: string|null, interfaces: string[], onBoard: boolean, simulated: boolean, firmwareSupported: boolean, required: boolean, recent: boolean, favourite: boolean, structural?: boolean, simulationLimited?: boolean, firmwareIndependent?: boolean }} CatalogueEntry */
/** @typedef {{ id: string, label: string, entries: CatalogueEntry[] }} CatalogueSection */
/** @param {string} value */
const normalize = (value) => value.normalize('NFKC').trim().toLocaleLowerCase();

/** @param {string} partId @param {string} lang @returns {string|null} */
function voltageLabel(partId, lang) {
  const text = (/** @type {string} */ key, /** @type {Record<string, string|number>} */ vars = {}) => simText(lang, `voltage.${key}`, vars);
  if (partId === 'bme280-i2c') return text('bme280');
  if (partId === 'hc-sr04') return text('hcSr04');
  if (partId === 'usb-5v-source') return text('usb');
  if (partId === 'button-module') return text('button');
  if (partId === 'battery-4xaa') return text('battery', { full: BATTERY_CHEMISTRIES.alkaline.fullVoltage, empty: BATTERY_CHEMISTRIES.alkaline.emptyVoltage });
  if (partId === 'bench-supply') return text('bench');
  if (partId === 'breadboard-regulator') return text('regulator');
  if (partId === 'ssd1306') return text('oled');
  if (partId === 'sg90') return text('servo');
  if (partId === 'tb6612fng') return text('tb6612');
  if (partId === 'ws2812-strip') return text('strip');
  if (partId === 'dc-motor-small') return text('motor');
  if (partId === 'led-5mm') return text('led', { voltage: DEFAULT_LED_FORWARD_VOLTAGE });
  if (partId === 'dc-source') {
    const spec = DEVICES[partId]?.properties.voltage;
    if (spec?.kind === 'number' && spec.min !== undefined && spec.max !== undefined) return text('dcSource', { min: spec.min, max: spec.max });
  }
  const model = PARTS[partId]?.model;
  const screen = model ? screenById(model) : undefined;
  if (screen) return text('screen', { voltage: screen.vcc === '3v3' ? '3.3' : '5' });
  return null;
}

/** @param {string} partId @param {string} [lang] @returns {CatalogueEntry | undefined} */
export function catalogueEntry(partId, lang = 'en') {
  if (partId === 'breadboard') return { part: partId, name: simText(lang, 'name.breadboard'), summary: simText(lang, 'summary.breadboard'), category: 'fundamental', tags: [], voltage: null, interfaces: [], onBoard: false, simulated: true, firmwareSupported: false, required: false, recent: false, favourite: false, structural: true };
  if (!Object.hasOwn(DEVICES, partId) || !Object.hasOwn(PARTS, partId)) return undefined;
  const device = DEVICES[partId], part = PARTS[partId];
  if (!device || !part) return undefined;
  const interfaces = [...new Set(device.capabilities.flatMap(cap => {
    if (cap.kind === 'i2c') return ['I2C'];
    if (cap.kind === 'spi') return ['SPI'];
    if (cap.kind === 'gpio') return ['GPIO'];
    if (cap.kind === 'pwm') return ['PWM'];
    if (cap.kind === 'oneWire') return ['1-Wire'];
    return [];
  }))];
  const nameKey = `name.${partId}`;
  const translatedName = simText(lang, nameKey);
  const summaryKey = `summary.${device.category === 'display' ? 'display' : device.summaryKey}`;
  return { part: partId, name: translatedName === nameKey ? part.label : translatedName,
    summary: simText(lang, summaryKey), category: device.category,
    tags: [...new Set([...device.tags, ...interfaces])], voltage: voltageLabel(partId, lang), interfaces,
    onBoard: part.onBoard, simulated: !['bme280-i2c', 'hc-sr04'].includes(partId), firmwareSupported: PROFILES[0].supportedParts.includes(partId),
    simulationLimited: ['led-5mm', 'resistor', 'dc-source', 'push-button'].includes(partId),
    firmwareIndependent: firmwareIndependent(partId),
    required: false, recent: false, favourite: false };
}

/**
 * @param {{query?: string, categories?: string[], tags?: string[], required?: string[], recent?: string[], favourites?: string[], lang?: string}} [options]
 * @returns {CatalogueSection[]}
 */
export function catalogueView({ query = '', categories = [], tags = [], required = [], recent = [], favourites = [], lang = 'en' } = {}) {
  const entries = ['breadboard', ...Object.keys(DEVICES)].flatMap(id => {
    const entry = catalogueEntry(id, lang);
    return entry ? [{ ...entry, required: required.includes(id), recent: recent.includes(id), favourite: favourites.includes(id) }] : [];
  });
  const requiredEntries = entries.filter(entry => entry.required);
  const term = normalize(query);
  const filtered = entries.filter(entry => {
    const search = [entry.part, entry.name, entry.summary, entry.category, ...entry.tags, ...entry.interfaces].map(normalize);
    return (!term || search.some(value => value.includes(term)))
      && (!categories.length || categories.some(category => normalize(category) === normalize(entry.category)))
      && tags.every(tag => entry.tags.some(value => normalize(value) === normalize(tag)));
  });
  const order = ['controller', 'audio', 'sensor', 'actuator', 'display'];
  const categoriesPresent = [...new Set(filtered.map(entry => entry.category))];
  categoriesPresent.sort((a, b) => (order.indexOf(a) < 0 ? order.length : order.indexOf(a)) - (order.indexOf(b) < 0 ? order.length : order.indexOf(b)) || a.localeCompare(b));
  /** @type {CatalogueSection[]} */
  const sections = categoriesPresent.map(id => ({ id, label: simText(lang, id), entries: filtered.filter(entry => entry.category === id) }));
  if (requiredEntries.length) sections.unshift({ id: 'required', label: simText(lang, 'required'), entries: requiredEntries });
  return sections;
}
