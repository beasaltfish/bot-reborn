// Bodies that live on the bench: a manifest with wiring, resources, commands
// and local behaviors, loaded by the workbench rather than installed into the
// brain's `~/.bot-reborn/bodies`. The shape is the plugin/module shape; the
// difference is who loads it and whether a character may wear it.
//
// A refused manifest is one line in the list, never a reason for the workbench
// not to start; the other bodies still load.

import buttonLed from './bodies/button-led/body.json' with { type: 'json' };
import bme280 from './bodies/bme280-readings/body.json' with { type: 'json' };
import sonar from './bodies/distance-reader/body.json' with { type: 'json' };
import motor from './bodies/motor-driver-basics/body.json' with { type: 'json' };
import strip from './bodies/status-light-strip/body.json' with { type: 'json' };
import servo from './bodies/proximity-servo/body.json' with { type: 'json' };
import display from './bodies/environment-display/body.json' with { type: 'json' };
import { bodyFrom, manifestProblem } from '../core/plugin-manifest.js';

/** @type {any[]} */
const MANIFESTS = [buttonLed, bme280, sonar, motor, strip, servo, display];

/**
 * @param {any[]} [manifests]
 * @returns {{ bodies: Record<string, import('../core/bodies.js').Body>, problems: string[] }}
 */
export function loadBenchBodies(manifests = MANIFESTS) {
  /** @type {Record<string, import('../core/bodies.js').Body>} */
  const bodies = {};
  /** @type {string[]} */
  const problems = [];
  for (const manifest of Array.isArray(manifests) ? manifests : []) {
    const id = typeof manifest?.id === 'string' ? manifest.id : '?';
    const problem = manifestProblem(manifest);
    if (problem) {
      problems.push(`bench body ${id}: ${problem}`);
      continue;
    }
    const body = bodyFrom(manifest);
    bodies[body.id] = body;
  }
  return { bodies, problems };
}

/** @type {{ bodies: Record<string, import('../core/bodies.js').Body>, problems: string[] }} */
const loaded = loadBenchBodies();

/** The bench bodies this build ships. */
export const BENCH_BODIES = loaded.bodies;

/** @param {string} id @returns {import('../core/bodies.js').Body | undefined} */
export function benchBodyById(id) {
  return Object.hasOwn(BENCH_BODIES, id) ? BENCH_BODIES[id] : undefined;
}

/** The load problems, for the page to say once at boot. */
export const BENCH_BODY_PROBLEMS = loaded.problems;
