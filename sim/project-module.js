// Turn a module manifest into a simulator project. A module is not a second
// bench: its project keeps the Audio only steps as the foundation and appends
// only the parts and links the module itself adds, so the bench the person
// wires is the bench the body already lives on.

import { PARTS } from './parts.js';
import { benchSetupSteps } from './recipes.js';

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
  // (A body manifest is the same shape: id, label, parts, wiring. The bench
  // body below reuses this generator rather than keeping a second layout.)
  const wiring = module.wiring ?? { parts: [], links: [] };
  // The bench the person already has is the foundation: a part it seated is not
  // seated again, and a link it already draws is not drawn twice. A manifest
  // that names the microphone it taps adds only what is missing.
  const seated = new Set(
    (base.steps ?? []).filter((step) => step.kind === 'part').map((step) => /** @type {any} */ (step).part),
  );
  const drawn = new Set(
    (base.links ?? []).flatMap((link) => [`${link.a}|${link.b}`, `${link.b}|${link.a}`]),
  );
  let x = MODULE_ROW.x;
  /** @type {import('./recipes.js').Step[]} */
  const moduleParts = (wiring.parts ?? []).filter((part) => !seated.has(part.part)).map((part) => {
    const def = PARTS[part.part];
    const say = `Place the ${def?.label ?? part.part}.`;
    /** @type {import('./recipes.js').Step} */
    const step = {
      kind: 'part',
      id: part.id,
      part: /** @type {any} */ (part.part),
      // A manifest may pin a part where its lesson puts it. A module names no
      // position and keeps the layout this generator chose.
      at: part.at ?? { x, z: MODULE_ROW.z },
      rot: /** @type {any} */ (part.rot ?? 0),
      // A fixed seat is left alone by the plan's seating pass; a part the
      // lesson places itself is seated on the board by that pass.
      seated: part.seated ?? true,
      say,
    };
    if (!part.at) x += Math.max(0, ...(def?.pins ?? [{ x: 0 }]).map(pin => pin.x)) + 1;
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
    // The body this bench is building. The pair panel reads it: selecting a
    // demo is selecting a body, and the person should not have to go to the
    // admin to find out which one.
    body: module.id,
    ending: 'Turn the light on',
    // A manifest's `why` is optional; every project link carries a sentence.
    links: [
      ...base.links,
      ...wiring.links
        .filter(link => !drawn.has(`${link.a}|${link.b}`) && !drawn.has(`${link.b}|${link.a}`))
        .map(link => ({ a: link.a, b: link.b, why: link.why ?? 'Connect the module.' })),
    ],
    steps: [...base.steps, ...moduleParts],
  };
}

/**
 * A project for a body the workbench runs itself: the body manifest carries the
 * wiring and the behavior, so this project has no firmware and no sketch. The
 * base is the two breadboards and the ESP32, not the Audio bench — a device
 * lesson is not a robot body.
 * @param {import('../core/bodies.js').Body} body
 * @returns {import('./projects.js').Project}
 */
export function projectFromBody(body) {
  /** @type {import('./projects.js').Project} */
  const base = {
    id: 'bench',
    name: 'Bench',
    firmware: null,
    connection: null,
    needs: [],
    ending: 'Try it',
    steps: benchSetupSteps(true),
    links: [],
  };
  const project = projectFromModule(/** @type {any} */ (body), base);
  return {
    ...project,
    id: body.id,
    name: body.label.en,
    firmware: null,
    connection: 'bench',
    body: body.id,
    adoptable: body.adoptable !== false,
    ending: body.ending ?? 'Try it',
    // A stand-alone project carries its wires as steps, the way the handwritten
    // lessons did; `planSteps` still derives the same links for the runner. USB
    // is not a step here: the runner inserts it for a bench/simulation build,
    // and a lab handoff must not silently power the bench.
    steps: [
      ...project.steps,
      ...(body.wiring?.links ?? []).map((link) => /** @type {import('./recipes.js').Step} */ ({
        kind: 'wire',
        a: link.a,
        b: link.b,
        named: [link.a, link.b],
        say: link.why ?? 'Connect it.',
      })),
    ],
  };
}
