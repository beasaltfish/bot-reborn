// Flashing a virtual board: a power gate, an async manifest, and a commit
// that only happens when the image is whole and the boot generation is still
// current. docs/.../2026-11-16-firmware-layer-design.md §11.
import { nets } from '../netlist.js';
import { evaluateBench } from '../devices/evaluate.js';
import { firmwareById } from './index.js';

const POSITIVE_RAILS = ['esp:3V3', 'esp:5V'];

/**
 * Only supply faults that reach a board positive rail stop a flash. A contention
 * between two external sources that share ground does not; neither does a
 * signal path whose explanation happens to mention a rail.
 * @param {import('../bench.js').Bench} bench
 * @param {{ faults?: any[], legacy?: { faults?: any[] } }} result
 */
export function flashPowerFault(bench, result) {
  const network = nets(bench);
  const onPositive = (/** @type {string} */ point) => POSITIVE_RAILS.some((rail) => {
    try { return network.same(point, rail); } catch { return false; }
  });
  const faults = [...(result.legacy?.faults ?? []), ...(result.faults ?? [])];
  for (const fault of faults) {
    if (fault.code === 'short-rails') return fault;
    if (fault.origin !== 'supply') continue;
    if ((fault.points ?? []).some(onPositive)) return fault;
  }
  return null;
}

/**
 * @param {import('../bench.js').Bench} bench
 * @param {import('../bench.js').BoardState} board
 * @returns {{ ok: true } | { ok: false, reason: 'unplugged'|'burnt'|'short' }}
 */
export function canFlash(bench, board) {
  if (!bench.usb) return { ok: false, reason: 'unplugged' };
  const esp = bench.placed.find((part) => part.part === 'esp32');
  if (esp?.burnt) return { ok: false, reason: 'burnt' };
  if (flashPowerFault(bench, evaluateBench(bench))) return { ok: false, reason: 'short' };
  return { ok: true };
}

/**
 * @param {string} url
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ files: { offset: number, path: string }[] }>}
 */
export async function loadManifest(url, fetchImpl = fetch) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error('image-not-found');
  const manifest = await res.json();
  if (!manifest || !Array.isArray(manifest.files) || manifest.files.length === 0
    || manifest.files.some((/** @type {any} */ f) => !Number.isInteger(f.offset) || typeof f.path !== 'string')) {
    throw new Error('image-not-found');
  }
  return manifest;
}

/** Commit the new firmware; settings are NVS and survive a flash. */
/** @param {import('../bench.js').BoardState} board @param {string} firmwareId */
export function flashFirmware(board, firmwareId) {
  return { ...board, firmware: firmwareId };
}

/**
 * Load and validate first; commit only when the generation is still current.
 * A failure returns the unchanged board.
 * @param {import('../bench.js').BoardState} board
 * @param {string} firmwareId
 * @param {{ fetchImpl?: typeof fetch, isCurrent?: () => boolean }} [o]
 */
export async function runFlash(board, firmwareId, o = {}) {
  const firmware = firmwareById(firmwareId);
  if (!firmware) return { ok: false, reason: 'unknown-firmware', board };
  if (firmware.image.kind === 'release') {
    try {
      await loadManifest(/** @type {string} */ (firmware.image.manifest), o.fetchImpl);
    } catch {
      return { ok: false, reason: 'image-not-found', board };
    }
  }
  if (o.isCurrent && !o.isCurrent()) return { ok: false, reason: 'stale', board };
  return { ok: true, board: flashFirmware(board, firmwareId) };
}

/** @param {import('./index.js').Firmware} firmware */
export function flashEvent(firmware) {
  if (firmware.image.kind === 'illustrative') {
    return { label: firmware.image.label, lines: [`${firmware.image.label} (simulated image)`] };
  }
  return {
    label: firmware.image.label,
    lines: ['esptool: writing bootloader.bin', 'esptool: writing body.bin', 'esptool: done; rebooting'],
  };
}
