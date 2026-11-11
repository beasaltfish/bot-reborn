# Simulator device expansion: progress and remaining work

Snapshot: 2026-11-11. This record describes what is implemented in the
`codex/sim-device-expansion` branch; it is not a claim that the overall device
expansion is complete.

## Checkout and branch

- Worktree: `/Users/WHO/.codex/worktrees/sim-device-expansion/bot-reborn`
- Branch: `codex/sim-device-expansion`; implementation snapshot: `485cb85`.
- Main checkout as reported by Git: `/Users/hanlynn/Projects/my/bot-reborn`,
  on `main`. At the snapshot, the branch and `main` have 21 and 2 unique
  commits respectively; integration must account for both sides.
- The original detailed plans and design are in `docs/superpowers/` in the
  main checkout. They are not present in this worktree and are not a substitute
  for this tracked status record.

## Implemented

- Device catalogue and validation, per-instance properties, version 3 bench
  storage/migration, wire colour persistence, ESP32 firmware/resource profile,
  a bounded DC operating-point evaluator, and project snapshot data for future
  firmware tooling. The engineering evaluator runs alongside legacy rules;
  existing legacy behaviour has not been fully migrated to it.
- Searchable parts catalogue, wire recolouring, a separate `sim/lab.html` 3D
  device viewer, selectable pin markers and bilingual descriptions. The lab
  is currently a viewer plus an LED-specific experiment, not the full lesson
  system described in the design.
- LED, resistor and adjustable DC source with a limited single-loop LED model,
  polarity and overcurrent outcomes, visible brightness/damage, bilingual LED
  wiring guidance and experiment controls. A two-terminal momentary button
  can switch that LED circuit and releases when the user stops pressing it.
- BME280 Adafruit 2652 physical definition, procedural mesh, real header pin
  names, address property, bilingual pin descriptions and a source note at
  `docs/hardware/bme280.md`. It is explicitly labelled simulation in
  development. Its current firmware support is not implemented.
- Standalone I²C topology checks and bounded, session-only environment stimuli
  and BME280 reading-state helpers. These helpers are **not yet connected** to
  the BME280 workbench or laboratory; they do not constitute working sensor
  simulation. Timing and pull-up sizing are not modeled by the I²C helper.

## Remaining work, in order

1. **Finish the shared electrical and workbench foundations.** Connect real
   source/load declarations and generic evaluation to practical workbench
   interactions, handling unsupported networks explicitly. Finish selection,
   pin and wire inspectors, ranked diagnoses with highlighted points, live
   project checklist and camera focus, catalogue metadata and accessibility.
   Preserve legacy recipes and saved projects. The evaluator is an operating-
   point approximation, not a SPICE solver.
2. **Finish the device lab and LED vertical slice.** Add structured five-stage
   bilingual lessons, optional local versioned learning progress, shared lab
   and workbench evaluation, complete fault exercises and project handoff.
   Add asset provenance/fallback support and the required close-up visual
   quality. The existing LED guide and numeric experiment are partial.
3. **Complete the BME280 vertical slice.** Model the selected breakout's
   supply and logic limits using sourced module-level information; connect
   power and I²C evaluation, address jumper and SDO/CS wiring, shared-bus
   conflicts, deterministic controls and live telemetry to both experiences.
   Add the bilingual lesson and guided project; distinguish simulated support
   from real firmware support. Do not claim full electrical realism or use
   chip-only current figures as verified whole-module consumption.
4. **Build the remaining first device pack.** Add documented independent
   supplies/battery/regulator; button module and HC-SR04; SSD1306 OLED; SG90
   servo; TB6612FNG plus motor; and WS2812 strip. Each needs realistic declared
   limits and relevant generic protocol/load evaluation, diagnostics, 3D
   representation, bilingual lessons and guided project use. The existing
   two-terminal button is not the planned three-pin button module.
5. **Complete integration and acceptance.** Verify shared source contention,
   common ground, voltage-level conflicts, startup/stall load and aggregate
   brownout; test migration and legacy projects; complete both-language
   browser acceptance and 20-device performance/LOD checks; update user and
   developer documentation; review the complete branch before integration.
6. **Future phase, not implemented:** online firmware editing/generation and
   flashing, including real hardware verification. The current snapshot
   contract is preparatory and does not provide these features.

## Workbench selection foundation

A selection model and tests exist in `sim/selection.js` and
`test/sim/selection.test.js`. Click selection is connected to
`scene/interact.js`; bench updates clear removed targets and reset explicitly
clears selection, even when IDs are reused. Pin clicks preserve click-to-wire.
The selection description provides bilingual device names, declared pin roles,
wire endpoints and colour, and stable action IDs; the full inspector UI remains
for a later task. jsdom pointer-event tests exercise pin, part, wire and empty
canvas selection and the existing click-to-wire mode. Real-browser interaction
has not been checked.

Verification: 45 focused tests passed, `npm run typecheck` and `npm test`
(1,161 Node tests, 8 skipped; 120 admin tests) passed. A previous build passed
with the existing warning about a chunk over 500 kB.

## Last verification

At implementation commit `485cb85`, `npm test` passed: 1,154 Node tests passed,
8 skipped, and 120 admin tests passed. `npm run typecheck` and `npm run build`
passed. The build warned that a minified chunk exceeds 500 kB. Browser checks
confirmed BME280 placement and its lab pin selection; they did not verify
working BME280 power, I²C, telemetry or full lessons. Network-listening tests
required execution outside the restricted sandbox.
