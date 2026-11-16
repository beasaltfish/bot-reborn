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
  const body = firmwareById('body');
  assert.equal(body.provenance.kind, 'mirrored');
  assert.equal(body.provenance.source, 'firmware/main');
  for (const part of ['esp32', 'inmp441', 'max98357a', 'speaker', 'mpu6050', 'toy']) {
    assert.ok(body.drivers.includes(part), part);
  }
  assert.deepEqual(body.link, { body: '/body', screen: '/screen' });
  assert.equal(body.image.manifest, '/firmware/manifest.json');
});

test('the body firmware lists every screen model it can drive', () => {
  const body = firmwareById('body');
  for (const screen of SCREENS) assert.ok(body.drivers.includes(`screen-${screen.id}`), screen.id);
});

test('unknown firmware ids resolve to undefined', () => {
  assert.equal(firmwareById('nope'), undefined);
  assert.equal(firmwareById(''), undefined);
});
