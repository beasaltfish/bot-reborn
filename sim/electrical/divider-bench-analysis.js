import { findDividerTopology } from './divider-topology.js';
import { evaluateVoltageDivider } from './voltage-divider.js';
import { nets } from '../netlist.js';
import { PARTS } from '../parts.js';

/** @typedef {{sourceVoltage:import('./voltage-divider.js').Range,sourceResistanceOhm:import('./voltage-divider.js').Range,resistorTolerance:number,inputLeakageUa:import('./voltage-divider.js').Range,inputLimits:import('./voltage-divider.js').DividerParameters['inputLimits']}} DividerAssumptions */

/** Hypothetical analysis of a recognized bench divider using caller-provided
 * bounds. It does not verify component ratings, electrical power, ECHO source
 * characteristics, actual input thresholds or safety, and never changes the
 * bench or power interlock.
 * @param {import('../bench.js').Bench} bench
 * @param {{source:string,output:string,ground:string,sourceGround:string}} points
 * @param {unknown} raw
 */
export function analyzeDividerBench(bench, points, raw) {
  const unsupported = /** @type {const} */ ({ kind: 'unsupported' });
  const topology = findDividerTopology(bench, points);
  if (topology.kind !== 'match' || !raw || typeof raw !== 'object' || Array.isArray(raw)) return unsupported;
  const sourceId = points.source.slice(0, points.source.indexOf(':'));
  const groundColon = points.sourceGround?.indexOf(':') ?? -1;
  const groundId = groundColon < 0 ? '' : points.sourceGround.slice(0, groundColon);
  const groundPin = groundColon < 0 ? '' : points.sourceGround.slice(groundColon + 1);
  const source = bench.placed.find(part => part.id === sourceId);
  const knownGround = groundPin.replace(/\.\d+$/, '') === 'GND' || (source?.part === 'dc-source' && groundPin === '-');
  if (!source || source.burnt || groundId !== sourceId || !knownGround
    || !PARTS[source.part].pins.some(pin => pin.name === groundPin) || !nets(bench).same(points.sourceGround, points.ground)) return unsupported;
  const assumptions = /** @type {DividerAssumptions} */ (raw);
  const tolerance = assumptions.resistorTolerance;
  if (typeof tolerance !== 'number' || !Number.isFinite(tolerance) || tolerance < 0 || tolerance >= 1) return unsupported;
  const upper = bench.placed.find(part => part.id === topology.upper)?.properties.ohms;
  const lower = bench.placed.find(part => part.id === topology.lower)?.properties.ohms;
  if (typeof upper !== 'number' || !Number.isFinite(upper) || upper < 1 || upper > 1e7
    || typeof lower !== 'number' || !Number.isFinite(lower) || lower < 1 || lower > 1e7) return unsupported;
  const voltage = evaluateVoltageDivider({
    sourceVoltage: assumptions.sourceVoltage, sourceResistanceOhm: assumptions.sourceResistanceOhm,
    upperOhm: { min: upper * (1 - tolerance), max: upper * (1 + tolerance) },
    lowerOhm: { min: lower * (1 - tolerance), max: lower * (1 + tolerance) },
    inputLeakageUa: assumptions.inputLeakageUa, inputLimits: assumptions.inputLimits,
  });
  if (voltage.status === 'unsupported') return unsupported;
  return { kind: /** @type {const} */ ('evaluated'), topology, voltage };
}
