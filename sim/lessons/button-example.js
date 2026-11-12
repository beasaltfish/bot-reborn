import { addPart, addWire, emptyBench, setPartProperty } from '../bench.js';
import { startBench } from '../recipes.js';
import { PROFILES } from '../devices/profiles.js';
import { evaluateGpio } from '../electrical/gpio.js';

/** Isolated teaching example; the pull is hypothetical, not firmware state. */
export function createButtonLabExample() {
  let bench = addPart(startBench(emptyBench()), 'push-button', { x: 0, z: 30 }).bench;
  bench = addWire(addWire(bench, 'esp:GPIO4', 'button:1', 'yellow'), 'button:2', 'esp:GND', 'black');
  /** @type {'up'|'down'|'none'} */ let pull = 'up';
  return {
    /** @param {boolean} pressed */
    press(pressed) { bench = setPartProperty(bench, 'button', 'pressed', pressed); },
    /** @param {'up'|'down'|'none'} value */
    setPull(value) { pull = value; },
    evaluate: () => evaluateGpio(bench, PROFILES[0], [{ point: 'esp:GPIO4', direction: 'input', pull }], { controllerPowered: true }),
  };
}
