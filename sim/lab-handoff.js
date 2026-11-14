import { addPart, serialize, setPartProperty } from './bench.js';
import { deviceByPart } from './devices/catalog.js';
import { PARTS } from './parts.js';
import { spotForNew } from './snap.js';
import { BME280_PROJECT, LED_PROJECT, projectById } from './projects.js';
import { applyStep, startBench } from './recipes.js';

export const LAB_HANDOFF_KEY = 'botreborn.sim.lab-handoff';
const BENCH_KEY = 'botreborn.sim.bench';
/** @typedef {{kind:'add',part:string}|{kind:'project',projectId:string,address?:'0x76'|'0x77'}} Request */
/** @typedef {{getItem(key:string):string|null,setItem(key:string,value:string):void,removeItem(key:string):void}} Store */
/** @typedef {{kind:'none'|'cancelled'|'invalid'|'error'}|{kind:'applied',bench:import('./bench.js').Bench,projectId:string|null}} Result */

/** @param {unknown} request @returns {request is Request} */
function valid(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return false;
  const value = /** @type {Record<string, unknown>} */ (request);
  if (value.kind === 'add') return typeof value.part === 'string' && value.part !== 'esp32' && Object.hasOwn(PARTS, value.part) && !!deviceByPart(value.part);
  if (value.kind !== 'project' || ![LED_PROJECT.id, BME280_PROJECT.id].includes(/** @type {string} */ (value.projectId))) return false;
  return value.address === undefined || (value.projectId === BME280_PROJECT.id && (value.address === '0x76' || value.address === '0x77'));
}

/** Queue a request without changing the current bench. @param {Store|null} store @param {Request} request */
export function queueLabHandoff(store, request) {
  if (!store || !valid(request)) return false;
  try {
    const raw = store.getItem(LAB_HANDOFF_KEY);
    if (raw) {
      try { const prior = JSON.parse(raw); if (typeof prior?.version === 'number' && prior.version > 1) return false; } catch { /* Replace a corrupt pending request. */ }
    }
    store.setItem(LAB_HANDOFF_KEY, JSON.stringify({ ...request, version: 1 }));
    return true;
  } catch { return false; }
}

/** Consume before persisting a replacement, so a failed removal cannot repeat an action.
 * @param {Store|null} store @param {import('./bench.js').Bench} bench @param {() => boolean} confirmReplace @returns {Result}
 */
export function consumeLabHandoff(store, bench, confirmReplace) {
  if (!store) return { kind: 'error' };
  try {
    const raw = store.getItem(LAB_HANDOFF_KEY);
    if (!raw) return { kind: 'none' };
    /** @type {any} */ let request;
    try { request = JSON.parse(raw); } catch { request = null; }
    if (typeof request?.version === 'number' && request.version > 1) return { kind: 'invalid' };
    if (request?.version !== 1 || !valid(request)) {
      store.removeItem(LAB_HANDOFF_KEY);
      return { kind: 'invalid' };
    }
    if (request.kind === 'project' && (bench.boards.length > 0 || bench.wires.length > 0 || bench.placed.length > 1) && !confirmReplace()) {
      store.removeItem(LAB_HANDOFF_KEY);
      return { kind: 'cancelled' };
    }
    let next = request.kind === 'add'
      ? (() => { const part = /** @type {import('./parts.js').PartDef['id']} */ (request.part); return addPart(bench, part, spotForNew(bench, part)).bench; })()
      : /** @type {import('./projects.js').Project} */ (projectById(request.projectId)).steps.reduce(applyStep, startBench(bench));
    if (request.kind === 'project' && request.projectId === BME280_PROJECT.id && request.address) next = setPartProperty(next, 'env', 'address', request.address);
    store.removeItem(LAB_HANDOFF_KEY);
    store.setItem(BENCH_KEY, serialize(next));
    return { kind: 'applied', bench: next, projectId: request.kind === 'project' ? request.projectId : null };
  } catch { return { kind: 'error' }; }
}
