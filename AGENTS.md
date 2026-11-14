# Agent notes

## Layout

- `server/` — brain HTTP/WS, API and page serving.
- `core/` — shared runtime: brain, config, screens, tarot, reflex.
- `phone/` — body page: USB, microphone, audio.
- `admin/` — React configuration app.
- `firmware/` — ESP32 firmware.
- `sim/` — wiring simulator: workbench `/sim/`, lab `/sim/lab.html`.
- `test/` — `node:test` and jsdom; admin tests use vitest.

## Sim data flow

1. `bench.js` — placed parts, wires, USB state (v3; `load()` also reads v2).
2. `netlist.js` — nets from parts, seating and wires.
3. `parts.js` — physical pins; `devices/catalog.js` — capabilities, properties,
   firmware contracts; `devices/profiles.js` — board resources.
4. `electrical/*` + `devices/evaluate.js` — bounded electrical, protocol and
   firmware results.
5. `plan.js` — adapts recipes/projects; `guidance.js`,
   `project-progress.js` and the project panel read plans.
6. `scene/world.js` + `meshes.js` — draw; `panels.js`, `ui/*` and `main.js` —
   workbench UI; `lab.js` — lab page.

## Sim wiring rules

- A seated pin's wire ends in a **free hole on the same strip** via `wireEnd()`;
  never on the pin id.
- Links keep pin ids; only wire endpoints use holes (`bb1:a12`).
- Project on-board parts use fixed seats declared in `sim/plan.js`; never
  auto-arrange at runtime. Screens are table parts (`onBoard: false`).

## Testing

- Before done: `npm test`, `npm run typecheck`, `npm run build`.
- Firmware: `npm run firmware:test`.
- Playwright CLI is installed globally as `playwright-cli`; use it for browser
  checks and screenshots. Do not add it to `package.json`; use
  `@playwright/test` for repeatable suites.
- Acceptance list: `docs/sim-first-pack-acceptance.md`.

## Conventions

- Plain ESM JavaScript; avoid new frameworks or dependencies.
- User-visible text is bilingual in `sim/ui/strings.js`.
- Models are bounded: no SPICE, no unmodeled safety or firmware claims.
  Record selected hardware in `docs/hardware/`.
- Keep tests with behavior changes; use `feat(sim):`, `fix(sim):`,
  `docs(sim):` style commits.
