import { nets } from './netlist.js';
import { evaluateBench } from './devices/evaluate.js';

/** Derive checklist state from the actual nets, not from wire endpoints.
 * @param {import('./bench.js').Bench} bench
 * @param {import('./projects.js').Project} project
 */
export function connectionProgress(bench, project) {
  const network = nets(bench);
  const { faults } = evaluateBench(bench);
  const instances = new Set(bench.placed.map(part => part.id));
  return project.links.map(link => {
    const [aId, aPin] = link.a.split(':');
    const [bId, bPin] = link.b.split(':');
    const present = instances.has(aId) && instances.has(bId);
    // The amplifier is bridged: either speaker orientation works, but both
    // terminals must reach opposite outputs before accepting the crossed case.
    const speaker = aId.startsWith('spk') && bId.startsWith('amp') && ['+', '-'].includes(aPin) && ['+', '-'].includes(bPin);
    const other = (/** @type {string} */ pin) => pin === '+' ? '-' : '+';
    const crossed = speaker && network.same(link.a, `${bId}:${other(bPin)}`)
      && network.same(`${aId}:${other(aPin)}`, link.b);
    const complete = present && (network.same(link.a, link.b) || crossed);
    const points = crossed ? [link.a, `${bId}:${other(bPin)}`] : [link.a, link.b];
    const faultCodes = complete ? [...new Set(faults.filter(fault => !project.ignoredFaultCodes?.includes(fault.code) && fault.points.some((/** @type {string} */ point) => points.some(p => network.same(p, point)))).map(fault => fault.code))].sort() : [];
    return {
      id: `${project.id}:${link.a}:${link.b}`,
      present,
      a: link.a,
      b: link.b,
      whyKey: `project.${project.id}.link.${encodeURIComponent(link.a)}.${encodeURIComponent(link.b)}.why`,
      status: /** @type {'missing'|'complete'|'fault'} */ (!complete ? 'missing' : faultCodes.length ? 'fault' : 'complete'),
      faultCodes,
    };
  });
}
