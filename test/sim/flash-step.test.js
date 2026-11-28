import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyBench, emptyBoard, addPart, addWire } from '../../sim/bench.js';
import { evaluateBench, uniqueFaults } from '../../sim/devices/evaluate.js';
import {
  canFlash, flashPowerFault, runFlash, runCustomFlash,
} from '../../sim/firmware/flash.js';

const BOARD = () => ({
  firmware: 'sketch-env-display',
  settings: { ssid: 'bench', pass: '', token: 'a'.repeat(32), url: '', screen: 'ili9341-ips', calib: { driveSwapped: false, steerSwapped: true } },
  custom: null,
});
const MANIFEST = {
  chip: 'esp32s3', flashMode: 'dio', flashFreq: '80m', flashSize: '8MB',
  files: [{ offset: 0, path: 'bootloader.bin' }, { offset: 0x10000, path: 'body.bin' }],
};
const okFetch = async () => ({ ok: true, json: async () => MANIFEST });

test('a burnt board cannot be flashed', () => {
  let b = emptyBench();
  b = { ...b, usb: true, placed: b.placed.map((p) => (p.part === 'esp32' ? { ...p, burnt: true } : p)) };
  assert.deepEqual(canFlash(b, b.board), { ok: false, reason: 'burnt' });
});

test('a supply-origin fault blocks flashing, a signal-origin fault does not', () => {
  const bench = emptyBench();
  const supply = /** @type {any} */ ({ faults: [{ code: 'source-contention', origin: 'supply', instances: ['esp'], points: ['esp:3V3'] }], legacy: { faults: [] } });
  const signal = /** @type {any} */ ({ faults: [{ code: 'unsupported-electrical-network', origin: 'signal', instances: ['sonar', 'esp'], points: ['sonar:ECHO', 'esp:GPIO5', 'src:-'] }], legacy: { faults: [] } });
  assert.notEqual(flashPowerFault(bench, supply), null);
  assert.equal(flashPowerFault(bench, signal), null);
});

test('uniqueFaults keeps supply and signal faults with the same code and instances', () => {
  const merged = uniqueFaults(/** @type {any} */ ([
    { code: 'unsupported-electrical-network', origin: 'supply', instances: ['esp'], points: ['esp:3V3'] },
    { code: 'unsupported-electrical-network', origin: 'signal', instances: ['esp'], points: ['esp:GPIO5'] },
  ]));
  assert.deepEqual(merged.map((f) => f.origin).sort(), ['signal', 'supply']);
});

test('an independent source on esp:3V3 blocks flashing even without a rail entry', () => {
  let b = emptyBench();
  b = addPart(b, 'dc-source', { x: -30, z: 20 }).bench;
  b = addWire(b, 'src:+', 'esp:3V3', 'red');
  b = addWire(b, 'src:-', 'esp:GND', 'black');
  const powered = { ...b, usb: true };
  assert.equal(canFlash(powered, b.board).ok, false);
  assert.ok(evaluateBench(powered).faults.some((f) => f.code === 'source-contention' && f.origin === 'supply'));
});

test('two independent sources sharing only board ground do not block flashing', () => {
  let b = emptyBench();
  b = addPart(b, 'dc-source', { x: -30, z: 20 }).bench;
  b = addPart(b, 'dc-source', { x: -20, z: 20 }).bench;
  b = addWire(b, 'src:+', 'src2:+', 'red');
  b = addWire(b, 'src:-', 'esp:GND', 'black');
  b = addWire(b, 'src2:-', 'esp:GND', 'black');
  const powered = { ...b, usb: true };
  assert.ok(evaluateBench(powered).faults.some((f) => f.code === 'source-contention' && f.origin === 'supply'));
  assert.equal(canFlash(powered, b.board).ok, true);
});

test('an external-source sonar signal path does not block flashing', () => {
  let b = emptyBench();
  b = addPart(b, 'hc-sr04', { x: 20, z: 40 }).bench;
  b = addPart(b, 'dc-source', { x: -30, z: 20 }).bench;
  b = addPart(b, 'resistor', { x: -10, z: 40 }).bench;
  b = addWire(b, 'src:+', 'sonar:VCC', 'red');
  b = addWire(b, 'src:-', 'sonar:GND', 'black');
  b = addWire(b, 'sonar:GND', 'esp:GND', 'black');
  b = addWire(b, 'sonar:ECHO', 'r:1', 'yellow');
  b = addWire(b, 'r:2', 'esp:GPIO5', 'yellow');
  const powered = { ...b, usb: true };
  assert.ok(evaluateBench(powered).faults.some((f) => f.code === 'unsupported-electrical-network' && f.origin === 'signal'));
  assert.equal(canFlash(powered, b.board).ok, true);
});

test('a missing manifest leaves firmware unchanged', async () => {
  const r = await runFlash(BOARD(), 'body', { fetchImpl: /** @type {any} */ (async () => ({ ok: false, status: 404 })), isCurrent: () => true });
  assert.equal(r.ok, false);
  assert.equal(r.board.firmware, 'sketch-env-display');
});

test('an aborted or stale flash does not commit', async () => {
  const r = await runFlash(BOARD(), 'body', { fetchImpl: /** @type {any} */ (okFetch), isCurrent: () => false });
  assert.equal(r.ok, false);
  assert.equal(r.board.firmware, 'sketch-env-display');
});

test('flashing keeps NVS settings and changes firmware', async () => {
  const r = await runFlash(BOARD(), 'body', { fetchImpl: /** @type {any} */ (okFetch), isCurrent: () => true });
  assert.equal(r.ok, true);
  assert.equal(r.board.firmware, 'body');
  assert.equal(r.board.settings.token, 'a'.repeat(32));
  assert.equal(r.board.settings.screen, 'ili9341-ips');
  assert.equal(r.board.settings.calib.steerSwapped, true);
});

import { flashEvent } from '../../sim/firmware/flash.js';
import { FIRMWARES } from '../../sim/firmware/index.js';

test('a release flash event writes the image own filename, not a hardcoded one', () => {
  const event = flashEvent(FIRMWARES.body);
  assert.ok(event.lines.includes(`esptool: writing ${FIRMWARES.body.image.label}`));
  const sketch = flashEvent(FIRMWARES['sketch-env-display']);
  assert.match(sketch.lines[0], /simulated image/);
});

test('custom flash refuses unplugged, burnt and shorted boards', async () => {
  const board = { ...emptyBoard(), custom: { name: 'm', draft: 'void loop(){}', flashed: 'old', updatedAt: 1 } };
  const unplugged = { ...emptyBench(), usb: false };
  assert.equal((await runCustomFlash({ bench: unplugged, board, source: 'new' })).ok, false);
  const burnt = { ...emptyBench(), usb: true, placed: emptyBench().placed.map((p) => p.part === 'esp32' ? { ...p, burnt: true } : p) };
  assert.equal((await runCustomFlash({ bench: burnt, board, source: 'new' })).ok, false);
  const shorted = addWire({ ...emptyBench(), usb: true }, 'esp:3V3', 'esp:GND', 'red');
  assert.equal((await runCustomFlash({ bench: shorted, board, source: 'new' })).ok, false);
});

test('custom flash leaves the board untouched when the request is stale', async () => {
  const board = { ...emptyBoard(), custom: { name: 'm', draft: 'x', flashed: 'old', updatedAt: 1 } };
  const r = await runCustomFlash({ bench: { ...emptyBench(), usb: true }, board, source: 'new', isCurrent: () => false });
  assert.equal(r.ok, false);
  assert.equal(r.board, board);
});

test('custom flash commits only when current', async () => {
  const board = { ...emptyBoard(), custom: { name: 'm', draft: 'x', flashed: 'old', updatedAt: 1 } };
  const r = await runCustomFlash({ bench: { ...emptyBench(), usb: true }, board, source: 'new', isCurrent: () => true });
  assert.equal(r.ok, true);
  assert.equal(r.board.firmware, 'custom');
  assert.ok(r.board.custom);
  assert.equal(r.board.custom.flashed, 'new');
});
