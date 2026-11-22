// Turn a module manifest into a simulator project. A module is not a second
// bench: its project keeps the Audio only steps as the foundation and appends
// only the parts and links the module itself adds, so the bench the person
// wires is the bench the body already lives on.

/** The module's own parts lie one row below the audio bench, 15 units apart. */
const ROW_Z = 46;
const ROW_X = -20;
const ROW_GAP = 15;

/**
 * @param {import('../core/module-manifest.js').ModuleManifest} module
 * @param {import('./projects.js').Project} base
 * @returns {import('./projects.js').Project} a new project; `base` is untouched
 */
export function projectFromModule(module, base) {
  const wiring = module.wiring ?? { parts: [], links: [] };
  /** @type {import('./recipes.js').Step[]} */
  const moduleParts = (wiring.parts ?? []).map((part, index) => ({
    kind: 'part',
    id: part.id,
    part: /** @type {any} */ (part.part),
    at: { x: ROW_X + index * ROW_GAP, z: ROW_Z },
    rot: 0,
    seated: false,
    say: `Place the ${part.part}.`,
  }));
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
