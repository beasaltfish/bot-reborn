import test from 'node:test';
import assert from 'node:assert/strict';

import { FIRMWARES, firmwareById } from '../../sim/firmware/index.js';
import { PARTS } from '../../sim/parts.js';
import { SCREENS } from '../../core/screens.js';

test('every firmware is well formed and unique', () => {
  for (const [id, f] of Object.entries(FIRMWARES)) {
    assert.equal(f.id, id);
    assert.ok(['mirrored', 'illustrative'].includes(f.provenance.kind));
    for (const part of f.drivers) assert.ok(PARTS[part], `${id}: unknown driver ${part}`);
  }
});

test('the body firmware is mirrored from firmware/main', () => {
  const body = /** @type {any} */ (firmwareById('body'));
  assert.equal(body.provenance.kind, 'mirrored');
  assert.equal(body.provenance.source, 'firmware/main');
  for (const part of ['esp32', 'inmp441', 'max98357a', 'speaker', 'mpu6050', 'toy']) {
    assert.ok(body.drivers.includes(part), part);
  }
  assert.deepEqual(body.link, { body: '/body', screen: '/screen' });
  assert.equal(body.image.manifest, '/firmware/manifest.json');
});

test('the body firmware lists every screen model it can drive', () => {
  const body = /** @type {any} */ (firmwareById('body'));
  for (const screen of SCREENS) assert.ok(body.drivers.includes(`screen-${screen.id}`), screen.id);
});

test('unknown firmware ids resolve to undefined', () => {
  assert.equal(firmwareById('nope'), undefined);
  assert.equal(firmwareById(''), undefined);
});

import { firmwareFor } from '../../sim/firmware/index.js';
import { commitCustomFlash } from '../../sim/firmware/custom.js';
import { emptyBoard } from '../../sim/bench.js';

test('firmwareFor returns metadata only for custom', () => {
  const board = { ...emptyBoard(), firmware: 'custom', custom: { name: 'm', draft: '', flashed: '', updatedAt: 1 } };
  const f = firmwareFor(board);
  assert.ok(f);
  assert.equal(f.id, 'custom');
  assert.equal(f.link, null);
  assert.equal(typeof f.tick, 'undefined');
  assert.deepEqual(f.drivers, ['esp32', 'button-module', 'led-5mm']);
});

test('firmwareFor is a pure lookup', () => {
  const board = { ...emptyBoard(), firmware: 'custom', custom: { name: 'm', draft: '', flashed: '', updatedAt: 1 } };
  assert.equal(firmwareFor(board), firmwareFor(board));
  assert.equal(firmwareFor(emptyBoard())?.id, 'body');
  assert.equal(firmwareFor({ ...emptyBoard(), firmware: '' }), undefined);
});

test('commitCustomFlash writes flashed and keeps draft/settings', () => {
  const board = { ...emptyBoard(), custom: { name: 'm', draft: 'new', flashed: 'old', updatedAt: 1 } };
  const next = commitCustomFlash(board, 'new');
  assert.ok(next.custom);
  assert.equal(next.firmware, 'custom');
  assert.equal(next.custom.flashed, 'new');
  assert.equal(next.custom.draft, 'new');
  assert.equal(next.settings.token, board.settings.token);
});

import { EXAMPLES } from '../../sim/firmware/examples.js';
import { compile } from '../../sim/firmware/lang/index.js';

test('every built-in sketch has an example; only button-led is v1-copyable', () => {
  for (const id of Object.keys(FIRMWARES).filter((x) => x.startsWith('sketch-'))) assert.ok(EXAMPLES[id]?.source, id);
  assert.equal(EXAMPLES['sketch-button-led'].v1, true);
  assert.deepEqual(compile(EXAMPLES['sketch-button-led'].source).errors, []);
  assert.equal(Object.values(EXAMPLES).filter((e) => e.v1).length, 1);
});
