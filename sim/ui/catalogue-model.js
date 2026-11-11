import { DEVICES } from '../devices/catalog.js';
import { PROFILES } from '../devices/profiles.js';
import { PARTS } from '../parts.js';
import { simText } from './strings.js';

/** @typedef {{ part: string, name: string, summary: string, category: string, tags: string[], voltage: null, interfaces: string[], onBoard: boolean, simulated: boolean, firmwareSupported: boolean, required: boolean, recent: boolean, favourite: boolean }} CatalogueEntry */
/** @typedef {{ id: string, label: string, entries: CatalogueEntry[] }} CatalogueSection */
/** @param {string} value */
const normalize = (value) => value.normalize('NFKC').trim().toLocaleLowerCase();

/** @param {string} partId @param {string} [lang] @returns {CatalogueEntry | undefined} */
export function catalogueEntry(partId, lang = 'en') {
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
    tags: [...new Set([...device.tags, ...interfaces])], voltage: null, interfaces,
    onBoard: part.onBoard, simulated: true, firmwareSupported: PROFILES[0].supportedParts.includes(partId),
    required: false, recent: false, favourite: false };
}

/**
 * @param {{query?: string, categories?: string[], tags?: string[], required?: string[], recent?: string[], favourites?: string[], lang?: string}} [options]
 * @returns {CatalogueSection[]}
 */
export function catalogueView({ query = '', categories = [], tags = [], required = [], recent = [], favourites = [], lang = 'en' } = {}) {
  const entries = Object.keys(DEVICES).flatMap(id => {
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
