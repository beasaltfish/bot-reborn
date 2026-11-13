import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogueEntry, catalogueView } from '../../sim/ui/catalogue-model.js';
import { simText } from '../../sim/ui/strings.js';

test('catalogue groups devices in a stable category order', () => {
  const sections = catalogueView({});
  assert.deepEqual(sections.map(s => s.id), ['controller', 'audio', 'sensor', 'actuator', 'display', 'fundamental', 'input', 'output', 'power']);
  const displays = sections.find(s => s.id === 'display');
  assert.ok(displays);
  assert.ok(displays.entries.every(e => e.part.startsWith('screen-') || e.part === 'ssd1306'));
});

test('catalogue filters by category and derived interface tags', () => {
  const sections = catalogueView({ categories: ['sensor'], tags: ['I2C'] });
  assert.deepEqual(sections.flatMap(s => s.entries.map(e => e.part)), ['bme280-i2c', 'mpu6050']);
  const sensor = catalogueEntry('mpu6050', 'en');
  assert.ok(sensor);
  assert.ok(sensor.interfaces.includes('I2C'));
});

test('catalogue offers bilingual descriptions and preserves model labels', () => {
  const en = catalogueEntry('mpu6050', 'en');
  const zh = catalogueEntry('mpu6050', 'zh');
  assert.ok(en && zh);
  assert.notEqual(en.name, zh.name);
  assert.notEqual(en.summary, zh.summary);
  assert.match(zh.name, /MPU-6050/);
  assert.equal(catalogueEntry('mpu6050', 'invalid')?.name, en.name);
  assert.equal(catalogueEntry('missing', 'en'), undefined);
});

test('voltage labels distinguish sourced ratings, simulator assumptions and unknown limits', () => {
  assert.match(catalogueEntry('bme280-i2c', 'en')?.voltage ?? '', /VIN.*3–5 V/);
  assert.match(catalogueEntry('dc-source', 'en')?.voltage ?? '', /0–12 V.*model/i);
  assert.match(catalogueEntry('led-5mm', 'zh')?.voltage ?? '', /2 V.*模型/);
  assert.match(catalogueEntry('screen-st7789-320', 'en')?.voltage ?? '', /3\.3 V.*model/i);
  assert.match(catalogueEntry('screen-ili9341-ips', 'en')?.voltage ?? '', /5 V.*model/i);
  assert.equal(catalogueEntry('speaker', 'en')?.voltage, null);
});

test('translations fall back to the key and interpolate variables', () => {
  assert.equal(simText('zh', 'missing.key'), 'missing.key');
  assert.equal(simText('en', 'results', { count: 3 }), '3 results');
});

test('catalogue filtering is normalized and required parts stay surfaced', () => {
  const sections = catalogueView({ query: '  ＭＰＵ-6050  ', required: ['speaker'], recent: ['mpu6050'], favourites: ['speaker'] });
  assert.equal(sections[0].id, 'required');
  assert.equal(sections[0].entries[0].part, 'speaker');
  assert.equal(sections[0].entries[0].required, true);
  assert.equal(sections[0].entries[0].favourite, true);
  assert.equal(sections[1].entries[0].part, 'mpu6050');
  assert.equal(sections[1].entries[0].recent, true);
});
