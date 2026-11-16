// Illustrative firmware for the device projects. There is no C source for
// these yet; each declares the drivers it carries and what it does per tick.
// See docs/.../2026-11-16-firmware-layer-design.md §12.1 for the sonar limits.
const sketch = (/** @type {string} */ id, /** @type {string[]} */ drivers, /** @type {((ctx:any)=>void)|null} */ tick = null) => ({
  id,
  name: id,
  provenance: { kind: 'illustrative', note: 'No C source in the repository yet; the workbench shows what this sketch would do.' },
  drivers,
  link: null,
  usesSettings: false,
  image: { label: 'simulated sketch', kind: 'illustrative', files: [{ offset: 0x10000, name: 'sketch.bin' }] },
  tick: tick ?? (() => {}),
});

export const SKETCHES = [
  sketch('sketch-bme280', ['bme280-i2c']),
  sketch('sketch-button-led', ['button-module', 'led-5mm'], (ctx) => {
    ctx.pin('GPIO5', ctx.parts?.btn?.level === 'low' ? 'high' : 'low');
  }),
  sketch('sketch-sonar', ['hc-sr04'], (ctx) => { ctx.measure('sonar'); }),
  sketch('sketch-env-display', ['bme280-i2c', 'ssd1306']),
  sketch('sketch-sonar-servo', ['hc-sr04', 'sg90']),
  sketch('sketch-motor', ['tb6612fng', 'dc-motor-small']),
  sketch('sketch-strip', ['ws2812-strip']),
];
