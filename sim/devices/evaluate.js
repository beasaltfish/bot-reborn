import { evaluateElectrical } from '../electrical/evaluate.js';
import { powerOn } from '../power.js';
import { DEVICES } from './catalog.js';
import { PROFILES, checkResources } from './profiles.js';

/** @typedef {{ profile?: import('./profiles.js').Profile, mode?: import('../electrical/supply.js').OperatingMode, stimuli?: object, devices?: Record<string, any> }} Options */

/** Deduplicate global findings by code and affected instances. */
/** @param {{code:string, instances:string[], points:string[]}[]} faults */
function uniqueFaults(faults) {
  const sorted = faults.map(f => ({ ...f, instances: [...f.instances].sort(), points: [...f.points].sort() }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const merged = new Map();
  for (const f of sorted) {
    const key = JSON.stringify([f.code, f.instances]);
    const previous = merged.get(key);
    if (previous) previous.points = [...new Set([...previous.points, ...f.points])].sort();
    else merged.set(key, f);
  }
  return [...merged.values()];
}

/**
 * Evaluate physical and firmware constraints independently.
 * @param {import('../bench.js').Bench} bench
 * @param {Options} [options]
 */
export function evaluateDevices(bench, { profile = PROFILES[0], mode = 'idle', stimuli, devices = DEVICES } = {}) {
  const electrical = evaluateElectrical(bench, { profile, mode, stimuli, devices });
  const resources = checkResources(bench, profile, devices).filter(f => {
    if (f.code !== 'spi-chip-select-conflict' || f.instances.length !== 2) return true;
    const [a, b] = f.instances.map(id => bench.placed.find(p => p.id === id));
    // The built-in firmware deliberately broadcasts to identical supported panels.
    return !(a && b && a.part === b.part && devices[a.part] === DEVICES[a.part]
      && DEVICES[a.part]?.category === 'display' && profile.supportedParts.includes(a.part));
  });
  const faults = uniqueFaults([...electrical.faults, ...resources]);
  const parts = Object.fromEntries(Object.entries(electrical.devices).map(([id, state]) => [id, { electrical: state }]));
  return { electrical, resources, parts, faults, burns: [...new Set(electrical.burns)].sort() };
}

/**
 * Preserve the legacy result while supplying a merged view for presentation.
 * @param {import('../bench.js').Bench} bench
 * @param {Options} [options]
 */
export function evaluateBench(bench, options = {}) {
  const legacy = powerOn(bench);
  const engineering = evaluateDevices(bench, options);
  const parts = { ...engineering.parts };
  for (const [id, state] of Object.entries(legacy.parts)) parts[id] = { ...engineering.parts[id], ...state };
  return { legacy, engineering, parts, faults: [...legacy.faults, ...engineering.faults], burns: [...new Set([...legacy.burns, ...engineering.burns])].sort() };
}
