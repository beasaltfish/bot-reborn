import { addPart, addWire, emptyBench, removeWire, setPartProperty } from '../bench.js';
import { applyStep, startBench } from '../recipes.js';
import { BME280_PROJECT } from '../projects.js';
import { evaluateBench } from '../devices/evaluate.js';

/** An isolated reference circuit, never loaded from or written to the workbench. */
export function createBme280LabExample() {
  /** @type {'0x76'|'0x77'} */ let address = '0x77';
  /** @type {'normal'|'swapped'|'conflict'} */ let scenario = 'normal';
  function circuit() {
    let bench = { ...BME280_PROJECT.steps.reduce(applyStep, startBench(emptyBench())), usb: true };
    bench = setPartProperty(bench, 'env', 'address', address);
    if (scenario === 'swapped') {
      for (const wire of bench.wires.filter(item => item.a === 'env:SDI' || item.a === 'env:SCK')) bench = removeWire(bench, wire.id);
      bench = addWire(bench, 'env:SDI', 'esp:GPIO2', 'yellow');
      bench = addWire(bench, 'env:SCK', 'esp:GPIO1', 'yellow');
    }
    if (scenario === 'conflict') {
      bench = addPart(bench, 'bme280-i2c', { x: 40, z: 40 }).bench;
      bench = setPartProperty(bench, 'env2', 'address', address);
      for (const [a, b] of [['env2:VIN', 'esp:3V3'], ['env2:GND', 'esp:GND'], ['env2:SDI', 'esp:GPIO1'], ['env2:SCK', 'esp:GPIO2']]) bench = addWire(bench, a, b, 'yellow');
    }
    return bench;
  }
  return {
    /** @param {ReturnType<typeof import('../stimuli.js').defaultStimuli>} stimuli */
    evaluate: stimuli => evaluateBench(circuit(), { stimuli }).engineering.bme280.env,
    address: () => address,
    setAddress(/** @type {'0x76'|'0x77'} */ value) { address = value; },
    setScenario(/** @type {'normal'|'swapped'|'conflict'} */ value) { scenario = value; },
  };
}
