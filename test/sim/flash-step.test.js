import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyBench, addPart, addWire } from '../../sim/bench.js';
import { evaluateBench, uniqueFaults } from '../../sim/devices/evaluate.js';
import {
  canFlash, flashPowerFault, runFlash,
} from '../../sim/firmware/flash.js';

const BOARD = () => ({
  firmware: 'sketch-bme280',
  settings: { ssid: 'bench', pass: '', token: 'a'.repeat(32), url: '', screen: 'ili9341-ips', calib: { driveSwapped: false, steerSwapped: true } },
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
  const supply = { faults: [{ code: 'source-contention', origin: 'supply', instances: ['esp'], points: ['esp:3V3'] }], legacy: { faults: [] } };
  const signal = { faults: [{ code: 'unsupported-electrical-network', origin: 'signal', instances: ['sonar', 'esp'], points: ['sonar:ECHO', 'esp:GPIO5', 'src:-'] }], legacy: { faults: [] } };
  assert.notEqual(flashPowerFault(bench, supply), null);
  assert.equal(flashPowerFault(bench, signal), null);
});

test('uniqueFaults keeps supply and signal faults with the same code and instances', () => {
  const merged = uniqueFaults([
    { code: 'unsupported-electrical-network', origin: 'supply', instances: ['esp'], points: ['esp:3V3'] },
    { code: 'unsupported-electrical-network', origin: 'signal', instances: ['esp'], points: ['esp:GPIO5'] },
  ]);
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
  const r = await runFlash(BOARD(), 'body', { fetchImpl: async () => ({ ok: false, status: 404 }), isCurrent: () => true });
  assert.equal(r.ok, false);
  assert.equal(r.board.firmware, 'sketch-bme280');
});

test('an aborted or stale flash does not commit', async () => {
  const r = await runFlash(BOARD(), 'body', { fetchImpl: okFetch, isCurrent: () => false });
  assert.equal(r.ok, false);
  assert.equal(r.board.firmware, 'sketch-bme280');
});

test('flashing keeps NVS settings and changes firmware', async () => {
  const r = await runFlash(BOARD(), 'body', { fetchImpl: okFetch, isCurrent: () => true });
  assert.equal(r.ok, true);
  assert.equal(r.board.firmware, 'body');
  assert.equal(r.board.settings.token, 'a'.repeat(32));
  assert.equal(r.board.settings.screen, 'ili9341-ips');
  assert.equal(r.board.settings.calib.steerSwapped, true);
});
