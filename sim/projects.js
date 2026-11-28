// Adapt existing recipes without changing their build or autowire behavior.
import { emptyBench } from './bench.js';
import { RECIPES, recipeSteps, startBench, applyStep } from './recipes.js';
import { targetFor } from './target.js';
import { PARTS } from './parts.js';
import { DEFAULT_SCREEN } from './recipes.js';
import { projectFromBody, projectFromModule } from './project-module.js';
import { bodyFrom } from '../core/plugin-manifest.js';
import buttonLed from './bodies/button-led/body.json' with { type: 'json' };
import bme280 from './bodies/bme280-readings/body.json' with { type: 'json' };
import sonar from './bodies/distance-reader/body.json' with { type: 'json' };
import motor from './bodies/motor-driver-basics/body.json' with { type: 'json' };
import strip from './bodies/status-light-strip/body.json' with { type: 'json' };
import servo from './bodies/proximity-servo/body.json' with { type: 'json' };
import display from './bodies/environment-display/body.json' with { type: 'json' };

/** @typedef {Omit<import('./recipes.js').Recipe, 'id' | 'connection'> & {id:string, connection: 'body' | 'bench' | null, steps: import('./recipes.js').Step[], links: import('./target.js').Link[], ignoredFaultCodes?:string[], body?:string, adoptable?:boolean, simulation?:string}} Project */

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
  id: 'led-basics', firmware: null, name: 'LED basics', needs: [], connection: null, ending: 'Observe the LED',
  ignoredFaultCodes: [],
  links: LED_LINKS,
  steps: [
    { kind: 'part', id: 'src', part: 'dc-source', at: { x: -30, z: 32 }, rot: 0, seated: false, say: 'Place the DC source.' },
    { kind: 'part', id: 'r', part: 'resistor', at: { x: 0, z: 32 }, rot: 0, seated: false, say: 'Place the 220 Ω resistor.' },
    { kind: 'part', id: 'led', part: 'led-5mm', at: { x: 15, z: 32 }, rot: 0, seated: false, say: 'Place the LED.' },
    ...LED_LINKS.map(link => /** @type {import('./recipes.js').Step} */ ({ kind: 'wire', a: link.a, b: link.b, named: [link.a, link.b], say: link.why })),
  ],
};

/**
 * The sensor lesson is a bench body too: its device resource, command and
 * wiring are the manifest. No sketch and no firmware.
 * @type {Project}
 */
export const BME280_PROJECT = projectFromBody(bodyFrom(bme280));

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
  id: 'power-a-rail', firmware: null, name: 'Power a rail', needs: [], connection: null, ending: 'Measure the regulated rail',
  ignoredFaultCodes: [],
  links: POWER_LINKS,
  steps: [
    { kind: 'part', id: 'bat', part: 'battery-4xaa', at: { x: -25, z: 32 }, rot: 0, seated: false, say: 'Place the 4×AA battery holder.' },
    { kind: 'part', id: 'reg', part: 'breadboard-regulator', at: { x: 0, z: 32 }, rot: 0, seated: false, say: 'Place the MB102 regulator.' },
    { kind: 'part', id: 'r', part: 'resistor', at: { x: 15, z: 32 }, rot: 0, seated: false, say: 'Place the current-limiting resistor.' },
    { kind: 'part', id: 'led', part: 'led-5mm', at: { x: 25, z: 32 }, rot: 0, seated: false, say: 'Place the LED.' },
    ...POWER_LINKS.map(link => /** @type {import('./recipes.js').Step} */ ({ kind: 'wire', a: link.a, b: link.b, named: [link.a, link.b], say: link.why })),
  ],
};

/**
 * The button demo is the first body whose wiring is its manifest: the parts,
 * the links and the behavior all come from `sim/bodies/button-led/body.json`.
 * There is no sketch and no firmware field; the workbench runs the behavior.
 * @type {Project}
 */
export const BUTTON_PROJECT = projectFromBody(bodyFrom(buttonLed));

/**
 * The HC-SR04 lesson: the device resource triggers a measurement on a timer;
 * the part panel reads the resulting distance. No sketch.
 * @type {Project}
 */
export const SONAR_PROJECT = projectFromBody(bodyFrom(sonar));

/**
 * The display lesson: the composed driver samples the BME280 and writes the
 * SSD1306. No sketch.
 * @type {Project}
 */
export const DISPLAY_PROJECT = projectFromBody(bodyFrom(display));

/**
 * The proximity servo: the composed driver reads the sonar and sets the
 * servo angle. No sketch.
 * @type {Project}
 */
export const SERVO_PROJECT = projectFromBody(bodyFrom(servo));

/**
 * The motor lesson: the driver resource writes a direction and speed; the
 * behavior repeats it so the motor keeps turning. No sketch.
 * @type {Project}
 */
export const MOTOR_PROJECT = projectFromBody(bodyFrom(motor));

/**
 * The strip lesson: the driver writes one frame on a timer. No sketch.
 * @type {Project}
 */
export const STRIP_PROJECT = projectFromBody(bodyFrom(strip));

const tarotSource = adapt(/** @type {import('./recipes.js').Recipe} */ (RECIPES.find(recipe => recipe.id === 'screen')), DEFAULT_SCREEN, true);
/** @type {Project} */
export const TAROT_PROJECT = {
  ...tarotSource,
  id: 'tarot', name: 'Tarot wand', needs: ['draw'], connection: 'body', firmware: 'body', body: 'tarot',
  // Keep the wand beside the screen, not a further row down, so its jumpers
  // do not cross the whole bench.
  steps: tarotSource.steps.map(step => step.kind === 'part' && step.id === 'imu'
    ? { ...step, at: { x: 10, z: 36 } }
    : step),
};

const GUIDED = [LED_PROJECT, BME280_PROJECT, POWER_PROJECT, BUTTON_PROJECT, SONAR_PROJECT, DISPLAY_PROJECT, SERVO_PROJECT, MOTOR_PROJECT, STRIP_PROJECT, TAROT_PROJECT];

/** Dropdown groups; a project not listed falls through to the end. */
export const PROJECT_GROUPS = [
  { id: 'demo', key: 'project.group.demo', ids: ['audio', 'screen', 'toy', 'tarot'] },
  { id: 'basics', key: 'project.group.basics', ids: ['led-basics', 'power-a-rail', 'button-led'] },
  { id: 'sensing', key: 'project.group.sensing', ids: ['bme280-readings', 'distance-reader', 'environment-display'] },
  { id: 'actuator', key: 'project.group.actuator', ids: ['proximity-servo', 'motor-driver-basics', 'status-light-strip'] },
];

/** @type {Project[]} */
const ADAPTED = [...RECIPES.map(recipe => adapt(recipe)), ...GUIDED];

const AUDIO_BENCH = /** @type {Project} */ (ADAPTED.find(project => project.id === 'audio'));

/** The module projects, as the brain's catalogue last said. Empty until boot. */
/** @type {Project[]} */
let MODULE_PROJECTS = [];

/**
 * The project list the dropdown draws. Written once at boot, before any panel
 * exists, from the catalogue the brain served: `projectById` and `planById` are
 * synchronous and stay that way.
 * @type {Project[]}
 */
export let PROJECTS = [...ADAPTED];

/**
 * Replace the module projects with the ones this catalogue describes. A module
 * is a body with a wiring, and its project is the audio bench plus that wiring.
 * @param {any[]} manifests
 * @returns {void}
 */
export function setModuleProjects(manifests) {
  MODULE_PROJECTS = (Array.isArray(manifests) ? manifests : [])
    .filter(manifest => manifest && Array.isArray(manifest.parts) && manifest.wiring)
    .map(manifest => projectFromModule(manifest, AUDIO_BENCH));
  PROJECTS = [...ADAPTED, ...MODULE_PROJECTS];
}

/**
 * The dropdown's groups, with the demo group extended by whatever modules the
 * catalogue brought: a module is a demo, and it belongs where the demos are.
 * @returns {typeof PROJECT_GROUPS} a new list; the constant is never edited
 */
export function projectGroups() {
  return PROJECT_GROUPS.map(group => (group.id === 'demo'
    ? { ...group, ids: [...group.ids, ...MODULE_PROJECTS.map(project => project.id)] }
    : group));
}

/** @param {string} id @param {{screenId?:string, wand?:boolean}} [options] */
export function projectById(id, options) {
  if (id === LED_PROJECT.id) return LED_PROJECT;
  if (id === BME280_PROJECT.id) return BME280_PROJECT;
  if (id === POWER_PROJECT.id) return POWER_PROJECT;
  if (id === BUTTON_PROJECT.id) return BUTTON_PROJECT;
  if (id === SONAR_PROJECT.id) return SONAR_PROJECT;
  if (id === DISPLAY_PROJECT.id) return DISPLAY_PROJECT;
  if (id === SERVO_PROJECT.id) return SERVO_PROJECT;
  if (id === MOTOR_PROJECT.id) return MOTOR_PROJECT;
  if (id === STRIP_PROJECT.id) return STRIP_PROJECT;
  if (id === TAROT_PROJECT.id) return TAROT_PROJECT;
  const recipe = RECIPES.find(candidate => candidate.id === id);
  if (!recipe) return PROJECTS.find(project => project.id === id) ?? null;
  if (options?.screenId || options?.wand) return adapt(recipe, options.screenId, options.wand);
  return PROJECTS.find(project => project.id === id) ?? null;
}
