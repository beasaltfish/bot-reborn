// The live context a firmware tick reads and writes. The board runtime supplies
// the evaluated inputs; this turns the sketch's outputs into the same state the
// workbench already renders: GPIO levels into the next evaluation, a latched
// sonar measurement into the stimulus, and device commands into the runtime map.
// docs/superpowers/specs/2026-11-16-firmware-layer-design.md §7.

import { partsView } from './parts-view.js';

/**
 * The evaluated level of a pin, or null when nothing defines it. Callers decide
 * what an undefined input means; the simulator reads it as LOW with a warning.
 * @param {Record<string, any>} evaluation
 * @param {number} pin
 * @returns {'HIGH'|'LOW'|null}
 */
export function gpioInputLevel(evaluation, pin) {
  const level = String(evaluation?.gpio?.[`esp:GPIO${pin}`] ?? '').toLowerCase();
  return level === 'high' ? 'HIGH' : level === 'low' ? 'LOW' : null;
}

/**
 * @param {{
 *   bench: import('../bench.js').Bench,
 *   evaluation: Record<string, any>,
 *   deviceStates?: Record<string, string>,
 *   runtime: Record<string, Record<string, any>>,
 *   onPin?(name: string, level: 'high'|'low'|'high-z'): void,
 *   onMeasure?(id: string, on: boolean): void,
 *   read?(pin: number): string,
 *   onLog?(line: string): void,
 * }} o
 */
export function createSketchContext({ bench, evaluation, deviceStates = {}, runtime, onPin, onMeasure, read, onLog }) {
  return {
    parts: partsView(bench, evaluation, deviceStates),
    /** The next evaluation sees this level; a `{pwm}` value is not modeled. */
    /** @param {string} name @param {any} level */
    pin(name, level) { onPin?.(name, level === 'high' || level === 'low' ? level : 'high-z'); },
    /** Remembered until the sketch turns it off, the board stops or reboot. */
    /** @param {string} id @param {boolean} [on] */
    measure(id, on = true) { onMeasure?.(id, on); },
    /** @param {number} pin */
    read(pin) { return String(read?.(pin) ?? 'LOW').toUpperCase() === 'HIGH' ? 'HIGH' : 'LOW'; },
    /** @param {string} line */
    log(line) { onLog?.(line); },
    /** @param {string} kind @param {string} id @param {Record<string, any>} [values] */
    device(kind, id, values = {}) {
      if (kind === 'display') runtime.display[id] = { lines: Array.isArray(values.lines) ? values.lines.map(String) : [] };
      else if (kind === 'servo') runtime.servo[id] = { angle: Number(values.angle) || 0 };
      else if (kind === 'motor') runtime.motor[id] = { direction: values.direction, speed: Number(values.speed) || 0, load: values.load };
      else if (kind === 'strip') runtime.strip[id] = { pixels: Array.isArray(values.pixels) ? values.pixels : [] };
    },
  };
}
