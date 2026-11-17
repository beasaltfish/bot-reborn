// The user's own firmware: metadata for the registry plus the pure commit used
// when a compiled draft is flashed. The interpreter machine is owned by the
// board runtime, not by this descriptor.
/** @type {import('./index.js').Firmware} */
export const CUSTOM = {
  id: 'custom',
  name: 'my firmware',
  provenance: {
    kind: 'illustrative',
    note: 'Runs in the simulator interpreter; not a compiled ESP32 binary.',
  },
  drivers: ['esp32', 'button-module', 'led-5mm'],
  link: null,
  usesSettings: false,
  image: { label: 'my firmware', kind: 'illustrative', files: [{ offset: 0x10000, name: 'firmware.ino' }] },
};

/**
 * Commit a compiled custom source. NVS settings and every other board field
 * stay as they are; only the custom slot and the firmware selection change.
 * @param {import('../bench.js').BoardState} board
 * @param {string} source
 * @returns {import('../bench.js').BoardState}
 */
export function commitCustomFlash(board, source) {
  return {
    ...board,
    firmware: 'custom',
    custom: {
      ...(board.custom ?? { name: 'my-firmware', draft: '', flashed: '', updatedAt: 0 }),
      draft: source,
      flashed: source,
      updatedAt: Date.now(),
    },
  };
}
