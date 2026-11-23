// Turn a module manifest into a simulator project. A module is not a second
// bench: its project keeps the Audio only steps as the foundation and appends
// only the parts and links the module itself adds, so the bench the person
// wires is the bench the body already lives on.

import { PARTS } from './parts.js';

// The module's parts go in the free top row right of the mic: the mic sits at
// columns 31-33, the amp at 41-47 (row c), so columns 34+ on row a are clear of
// both. A part starts where its first pin lands and the next starts after its
// last pin plus one pitch, so two parts never share a strip.
const MODULE_ROW = { x: 2, z: -6 };

/**
 * @param {import('../core/module-manifest.js').ModuleManifest} module
 * @param {import('./projects.js').Project} base
 * @returns {import('./projects.js').Project} a new project; `base` is untouched
 */
export function projectFromModule(module, base) {
  const wiring = module.wiring ?? { parts: [], links: [] };
  let x = MODULE_ROW.x;
  /** @type {import('./recipes.js').Step[]} */
  const moduleParts = (wiring.parts ?? []).map((part) => {
    const def = PARTS[part.part];
    const say = `Place the ${def?.label ?? part.part}.`;
    /** @type {import('./recipes.js').Step} */
    const step = {
      kind: 'part',
      id: part.id,
      part: /** @type {any} */ (part.part),
      at: { x, z: MODULE_ROW.z },
      rot: 0,
      // The seat is fixed, so the plan's seating pass leaves it alone.
      seated: true,
      say,
    };
    x += Math.max(0, ...(def?.pins ?? [{ x: 0 }]).map(pin => pin.x)) + 1;
    return step;
  });
  return {
    ...base,
    id: `module-${module.id}`,
    name: module.label.en,
    needs: [],
    ignoredFaultCodes: [],
    firmware: 'body',
    connection: 'body',
    ending: 'Turn the light on',
    // A manifest's `why` is optional; every project link carries a sentence.
    links: [
      ...base.links,
      ...wiring.links.map(link => ({ a: link.a, b: link.b, why: link.why ?? 'Connect the module.' })),
    ],
    steps: [...base.steps, ...moduleParts],
  };
}
