import test from 'node:test';
import assert from 'node:assert/strict';
import { SCREENS, screenById, sizeKey, frameSizes, DEFAULT_SIZE } from '../core/screens.js';

test('ids are unique and every screen names its pins by role', () => {
  assert.equal(new Set(SCREENS.map((s) => s.id)).size, SCREENS.length);
  for (const s of SCREENS) {
    const roles = /** @type {string[]} */ (s.pins.map((p) => p.role));
    for (const need of ['VCC', 'GND', 'SCK', 'MOSI', 'DC', 'RST']) assert.ok(roles.includes(need), `${s.id} ${need}`);
    // A module with no CS pin is selected all the time, which only works in SPI mode 3.
    if (!roles.includes('CS')) assert.equal(s.spiMode, 3, s.id);
    assert.ok(Number.isInteger(s.w) && Number.isInteger(s.h) && s.w > 0 && s.h > 0, s.id);
    assert.ok(['5v', '3v3'].includes(s.vcc), s.id);
  }
});

test('frameSizes: one entry per resolution, round if any screen of it is round', () => {
  assert.deepEqual(frameSizes(), [
    { w: 320, h: 240, round: false }, { w: 240, h: 240, round: true }, { w: 160, h: 128, round: false },
  ]);
});

test('sizeKey and the default', () => {
  assert.equal(sizeKey({ w: 320, h: 240 }), '320x240');
  assert.equal(DEFAULT_SIZE, '320x240');
  assert.equal(screenById('ili9341-ips')?.invert, true);
  assert.equal(screenById('nope'), undefined);
});

test('every screen has the shape the simulator draws and judges', () => {
  for (const s of SCREENS) {
    assert.ok(s.pcb.w > 0 && s.pcb.d > 0, s.id);
    assert.ok(s.glass.w > 0 && s.glass.d > 0, s.id);
    assert.ok(['on', 'off'].includes(s.blDefault), s.id);
    // A round panel's glass is a disc: as wide as it is tall.
    if (s.round) assert.equal(s.glass.w, s.glass.d, s.id);
  }
});
