// Illustrative firmware for the device projects. There is no C source for
// these yet; each declares the drivers it carries and what it does per tick.
// See docs/.../2026-11-16-firmware-layer-design.md §12 (and §12.1 for sonar).
//
// A tick reads only the gated `ctx.parts` adapter and writes only through
// `pin()` (GPIO, evaluated electrically) or `device()` (a device with its own
// protocol). It never claims a device works by drawing it.

/** The `[id, record]` of the first part of a kind, or null. */
/** @param {any} ctx @param {string} kind @param {(record: any) => boolean} [where] */
function first(ctx, kind, where) {
  return Object.entries(ctx.parts ?? {}).find(([, record]) => record?.kind === kind && (!where || where(record))) ?? null;
}

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
  // Reading only: the part panel shows the gated telemetry it sampled.
  sketch('sketch-bme280', ['bme280-i2c']),
  sketch('sketch-button-led', ['button-module', 'led-5mm'], (ctx) => {
    const button = first(ctx, 'button');
    ctx.pin('GPIO5', button?.[1].level === 'low' ? 'high' : 'low');
  }),
  sketch('sketch-sonar', ['hc-sr04'], (ctx) => { ctx.measure('sonar'); }),
  sketch('sketch-env-display', ['bme280-i2c', 'ssd1306'], (ctx) => {
    const env = first(ctx, 'bme280');
    const display = first(ctx, 'display');
    const telemetry = env?.[1].telemetry;
    if (!display || !telemetry) return;
    ctx.device('display', display[0], {
      lines: [
        `T ${Number(telemetry.temperatureC).toFixed(1)} C`,
        `H ${Math.round(Number(telemetry.humidityPct))} %`,
        `P ${Math.round(Number(telemetry.pressureHpa))} HPA`,
      ],
    });
  }),
  // §12.1: the real project's 5 V ECHO keeps this from booting, so the servo
  // only moves in a bench that legitimately passed the electrical checks.
  sketch('sketch-sonar-servo', ['hc-sr04', 'sg90'], (ctx) => {
    ctx.measure('sonar');
    const sonar = first(ctx, 'sonar');
    const servo = first(ctx, 'servo');
    const distance = sonar?.[1].distanceCm;
    if (!servo || typeof distance !== 'number') return;
    ctx.device('servo', servo[0], { angle: distance < 20 ? 90 : 0 });
  }),
  sketch('sketch-motor', ['tb6612fng', 'dc-motor-small'], (ctx) => {
    // The driver owns the command; the motor follows it electrically.
    const driver = first(ctx, 'motor', (record) => record.pwmPin !== undefined);
    if (!driver) return;
    ctx.device('motor', driver[0], { direction: 'forward', speed: 0.6, load: 'idle' });
  }),
  sketch('sketch-strip', ['ws2812-strip'], (ctx) => {
    const strip = first(ctx, 'strip');
    if (!strip) return;
    ctx.device('strip', strip[0], { pixels: Array.from({ length: 8 }, () => [0, 160, 40]) });
  }),
];
