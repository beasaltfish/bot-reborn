// Do not start a body when the selected board's power network is contended
// or its operating point cannot be established. Unrelated supplies do not gate it.
import { nets } from './netlist.js';
/** @param {import('./bench.js').Bench} bench @param {{faults:{code:string,points:string[],instances?:string[]}[]}} result */
export function blockingBoardPowerFault(bench, result) {
  const boards = new Set(bench.placed.filter(part => part.part === 'esp32').map(part => part.id));
  const rails = [...boards].flatMap(id => [`${id}:3V3`, `${id}:5V`]);
  const network = nets(bench);
  return result.faults.find(fault => (fault.code === 'source-contention' || fault.code === 'unsupported-electrical-network' || fault.code === 'gpio-overvoltage-risk' || fault.code === 'gpio-negative-voltage-risk' || fault.code === 'i2c-level-incompatible' || fault.code === 'logic-level-incompatible')
    && (('instances' in fault && Array.isArray(fault.instances) && fault.instances.some((/** @type {string} */ id) => boards.has(id)))
      || fault.points.some((/** @type {string} */ point) => rails.some(rail => network.same(point, rail))))) ?? null;
}

/** @param {import('./bench.js').Bench} bench @param {ReturnType<typeof import('./devices/evaluate.js').evaluateBench>} result */
export function initialDriveActions(bench, result) {
  if (result.legacy.esp !== 'ok' || blockingBoardPowerFault(bench, result)) return [];
  return Object.entries(result.legacy.toys).filter(([, toy]) => toy.action.wheels === 'forward' || toy.action.wheels === 'backward');
}
