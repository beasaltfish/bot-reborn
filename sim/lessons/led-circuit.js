import { addWire, emptyBench, setPartProperty } from '../bench.js';
import { evaluateBench } from '../devices/evaluate.js';
import { LED_PROJECT } from '../projects.js';
import { applyStep, startBench } from '../recipes.js';
import { connectionProgress } from '../project-progress.js';
import { evaluateLedBench } from '../electrical/led-bench.js';

/** @returns {import('../bench.js').Bench} */
function labParts() {
  return LED_PROJECT.steps.filter(step => step.kind !== 'wire').reduce(applyStep, startBench(emptyBench()));
}

/** Build the experiment as a real isolated bench, using the shared evaluator.
 * Zero resistance represents omitting the series resistor, not a zero-ohm part.
 * @param {{voltage:number,resistance:number,reversed:boolean}} options
 */
export function evaluateLedLabExperiment({ voltage, resistance, reversed }) {
  if (!Number.isFinite(resistance) || resistance < 0 || (resistance > 0 && resistance < 1)) throw new RangeError('invalid resistance');
  let bench = setPartProperty(labParts(), 'src', 'voltage', voltage);
  const input = reversed ? 'led:K' : 'led:A';
  const output = reversed ? 'led:A' : 'led:K';
  if (resistance === 0) bench = addWire(bench, 'src:+', input, 'red');
  else {
    bench = setPartProperty(bench, 'r', 'ohms', resistance);
    bench = addWire(bench, 'src:+', 'r:1', 'red');
    bench = addWire(bench, 'r:2', input, 'red');
  }
  bench = addWire(bench, output, 'src:-', 'black');
  return { bench, outcome: evaluateLedBench(bench, 'led'), faults: evaluateBench(bench).faults };
}

/** A lab-local bench: the same parts, wire steps and evaluator as the project. */
export function createLedLabCircuit() {
  const wireSteps = LED_PROJECT.steps.filter(step => step.kind === 'wire');
  let bench = labParts();
  /** @type {Set<number>} */ const connected = new Set();
  return {
    bench: () => bench,
    /** @param {number} index */
    connect(index) {
      if (!Number.isInteger(index) || index < 0 || index >= wireSteps.length) throw new RangeError('unknown connection');
      if (!connected.has(index)) { bench = applyStep(bench, wireSteps[index]); connected.add(index); }
      return bench;
    },
    complete: () => connectionProgress(bench, LED_PROJECT).every(link => link.status === 'complete') && evaluateLedBench(bench, 'led').state === 'on',
    reset() { bench = labParts(); connected.clear(); },
  };
}
