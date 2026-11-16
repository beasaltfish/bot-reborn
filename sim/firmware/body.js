// The firmware a board can run. `body` mirrors firmware/main; sketches are
// illustrative (there is no C source for them yet) and each declares the
// drivers it carries, the board endpoints it initialises, and what flashing it
// writes. See docs/superpowers/specs/2026-11-16-firmware-layer-design.md §12.
import { SCREENS } from '../../core/screens.js';

/** @type {import('./index.js').Firmware} */
export const BODY = {
  id: 'body',
  name: 'bot-reborn body',
  provenance: {
    kind: 'mirrored',
    source: 'firmware/main',
    spec: 'docs/superpowers/specs/2026-10-20-esp32-body-firmware-design.md',
  },
  drivers: ['esp32', 'inmp441', 'max98357a', 'speaker', 'mpu6050', 'toy', ...SCREENS.map((screen) => `screen-${screen.id}`)].sort(),
  link: { body: '/body', screen: '/screen' },
  usesSettings: true,
  image: { label: 'body.bin', kind: 'release', manifest: '/firmware/manifest.json' },
};
