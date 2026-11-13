// Adapt existing recipes without changing their build or autowire behavior.
import { emptyBench } from './bench.js';
import { RECIPES, recipeSteps, startBench, applyStep } from './recipes.js';
import { targetFor } from './target.js';

/** @typedef {Omit<import('./recipes.js').Recipe, 'id'> & {id:string, steps: import('./recipes.js').Step[], links: import('./target.js').Link[], ignoredFaultCodes?:string[]}} Project */

/** @param {import('./recipes.js').Recipe} recipe @param {string} [screenId] @param {boolean} [wand] @returns {Project} */
function adapt(recipe, screenId, wand) {
  const steps = recipeSteps(recipe.id, screenId, wand);
  const bench = steps.reduce(applyStep, startBench(emptyBench()));
  return { ...recipe, steps, links: targetFor(bench) };
}

/** @type {import('./target.js').Link[]} */
const LED_LINKS = [
  { a: 'src:+', b: 'r:1', why: 'Connect the positive supply to the current-limiting resistor.' },
  { a: 'r:2', b: 'led:A', why: 'Connect the resistor to the LED anode.' },
  { a: 'led:K', b: 'src:-', why: 'Connect the LED cathode to the source return to complete the loop.' },
];
/** @type {Project} */
export const LED_PROJECT = {
  id: 'led-basics', name: 'LED basics', needs: 'any', ending: 'Observe the LED',
  ignoredFaultCodes: ['firmware-unsupported'],
  links: LED_LINKS,
  steps: [
    { kind: 'part', id: 'src', part: 'dc-source', at: { x: -30, z: 32 }, rot: 0, seated: false, say: 'Place the DC source.' },
    { kind: 'part', id: 'r', part: 'resistor', at: { x: 0, z: 32 }, rot: 0, seated: false, say: 'Place the 220 Ω resistor.' },
    { kind: 'part', id: 'led', part: 'led-5mm', at: { x: 15, z: 32 }, rot: 0, seated: false, say: 'Place the LED.' },
    ...LED_LINKS.map(link => /** @type {import('./recipes.js').Step} */ ({ kind: 'wire', a: link.a, b: link.b, named: [link.a, link.b], say: link.why })),
  ],
};

/** @type {import('./target.js').Link[]} */
const BME_LINKS = [
  { a: 'env:VIN', b: 'esp:3V3', why: 'Power the breakout at 3.3 V so its I2C pull-ups match the ESP32 logic.' },
  { a: 'env:GND', b: 'esp:GND', why: 'Share ground between the sensor and controller.' },
  { a: 'env:SDI', b: 'esp:GPIO1', why: 'Connect SDI to the configured I2C data line.' },
  { a: 'env:SCK', b: 'esp:GPIO2', why: 'Connect SCK to the configured I2C clock line.' },
];
/** @type {Project} */
export const BME280_PROJECT = {
  id: 'bme280-readings', name: 'BME280 readings', needs: 'any', ending: 'Inspect simulated readings',
  links: BME_LINKS,
  steps: [
    { kind: 'part', id: 'env', part: 'bme280-i2c', at: { x: 25, z: 40 }, rot: 0, seated: false, say: 'Place the BME280 breakout.' },
    ...BME_LINKS.map(link => /** @type {import('./recipes.js').Step} */ ({ kind: 'wire', a: link.a, b: link.b, named: [link.a, link.b], say: link.why })),
  ],
};

/** @type {import('./target.js').Link[]} */
const POWER_LINKS = [
  { a: 'bat:+', b: 'reg:VIN', why: 'The battery pack feeds the regulator input.' },
  { a: 'bat:-', b: 'reg:GND', why: 'Connect the pack return to the regulator ground.' },
  { a: 'reg:VOUT', b: 'r:1', why: 'The regulated rail feeds the current-limiting resistor.' },
  { a: 'r:2', b: 'led:A', why: 'The resistor feeds the LED anode.' },
  { a: 'led:K', b: 'reg:GND', why: 'The LED cathode returns to the regulator ground.' },
];
/** @type {Project} */
export const POWER_PROJECT = {
  id: 'power-a-rail', name: 'Power a rail', needs: 'any', ending: 'Measure the regulated rail',
  ignoredFaultCodes: ['firmware-unsupported'],
  links: POWER_LINKS,
  steps: [
    { kind: 'part', id: 'bat', part: 'battery-4xaa', at: { x: -25, z: 32 }, rot: 0, seated: false, say: 'Place the 4×AA battery holder.' },
    { kind: 'part', id: 'reg', part: 'breadboard-regulator', at: { x: 0, z: 32 }, rot: 0, seated: false, say: 'Place the MB102 regulator.' },
    { kind: 'part', id: 'r', part: 'resistor', at: { x: 15, z: 32 }, rot: 0, seated: false, say: 'Place the current-limiting resistor.' },
    { kind: 'part', id: 'led', part: 'led-5mm', at: { x: 25, z: 32 }, rot: 0, seated: false, say: 'Place the LED.' },
    ...POWER_LINKS.map(link => /** @type {import('./recipes.js').Step} */ ({ kind: 'wire', a: link.a, b: link.b, named: [link.a, link.b], say: link.why })),
  ],
};

/** @type {import('./target.js').Link[]} */
const BUTTON_LINKS = [
  { a: 'btn:VCC', b: 'esp:3V3', why: 'Power the KY-004 from 3.3 V so its signal matches the ESP32 logic.' },
  { a: 'btn:GND', b: 'esp:GND', why: 'Share ground between the button module and controller.' },
  { a: 'btn:S', b: 'esp:GPIO4', why: 'Connect the button signal to a GPIO input.' },
  { a: 'esp:GPIO5', b: 'r:1', why: 'Drive the LED through a current-limiting resistor.' },
  { a: 'r:2', b: 'led:A', why: 'The resistor feeds the LED anode.' },
  { a: 'led:K', b: 'esp:GND', why: 'Return the LED cathode to ground.' },
];
/** @type {Project} */
export const BUTTON_PROJECT = {
  id: 'button-led', name: 'Button and LED', needs: 'any', ending: 'Press the button',
  ignoredFaultCodes: ['firmware-unsupported', 'device-unpowered', 'unsupported-electrical-network', 'led-reversed', 'led-overcurrent', 'led-burnt', 'led-current-limited'],
  links: BUTTON_LINKS,
  steps: [
    { kind: 'part', id: 'btn', part: 'button-module', at: { x: -25, z: 32 }, rot: 0, seated: false, say: 'Place the KY-004 button module.' },
    { kind: 'part', id: 'r', part: 'resistor', at: { x: 0, z: 32 }, rot: 0, seated: false, say: 'Place the 220 Ω resistor.' },
    { kind: 'part', id: 'led', part: 'led-5mm', at: { x: 15, z: 32 }, rot: 0, seated: false, say: 'Place the LED.' },
    ...BUTTON_LINKS.map(link => /** @type {import('./recipes.js').Step} */ ({ kind: 'wire', a: link.a, b: link.b, named: [link.a, link.b], say: link.why })),
    { kind: 'usb', say: 'Plug in USB and press the button.' },
  ],
};

/** @type {import('./target.js').Link[]} */
const SONAR_LINKS = [
  { a: 'sonar:VCC', b: 'esp:5V', why: 'The HC-SR04 needs a 5 V supply.' },
  { a: 'sonar:GND', b: 'esp:GND', why: 'Share ground with the controller.' },
  { a: 'sonar:TRIG', b: 'esp:GPIO4', why: 'TRIG is a controller output that starts a measurement.' },
  { a: 'sonar:ECHO', b: 'esp:GPIO5', why: 'ECHO returns a 5 V pulse; a 3.3 V GPIO needs level shifting.' },
];
/** @type {Project} */
export const SONAR_PROJECT = {
  id: 'distance-reader', name: 'Distance reader', needs: 'any', ending: 'Trigger a measurement',
  ignoredFaultCodes: ['firmware-unsupported', 'device-unpowered'],
  links: SONAR_LINKS,
  steps: [
    { kind: 'part', id: 'sonar', part: 'hc-sr04', at: { x: -15, z: 40 }, rot: 0, seated: false, say: 'Place the HC-SR04.' },
    ...SONAR_LINKS.map(link => /** @type {import('./recipes.js').Step} */ ({ kind: 'wire', a: link.a, b: link.b, named: [link.a, link.b], say: link.why })),
    { kind: 'usb', say: 'Plug in USB, then trigger a measurement.' },
  ],
};

/** @type {Project[]} */
export const PROJECTS = [...RECIPES.map(recipe => adapt(recipe)), LED_PROJECT, BME280_PROJECT, POWER_PROJECT, BUTTON_PROJECT, SONAR_PROJECT];

/** @param {string} id @param {{screenId?:string, wand?:boolean}} [options] */
export function projectById(id, options) {
  if (id === LED_PROJECT.id) return LED_PROJECT;
  if (id === BME280_PROJECT.id) return BME280_PROJECT;
  if (id === POWER_PROJECT.id) return POWER_PROJECT;
  if (id === BUTTON_PROJECT.id) return BUTTON_PROJECT;
  if (id === SONAR_PROJECT.id) return SONAR_PROJECT;
  const recipe = RECIPES.find(candidate => candidate.id === id);
  if (!recipe) return null;
  if (options?.screenId || options?.wand) return adapt(recipe, options.screenId, options.wand);
  return PROJECTS.find(project => project.id === id) ?? null;
}
