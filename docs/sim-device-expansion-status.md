# Simulator device expansion: progress and remaining work

Snapshot: 2026-11-13. This record describes what is implemented in the
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
  device viewer, selectable pin markers and bilingual descriptions. The LED
  lab has a five-stage lesson and local progress, with checklist-based rather
  than 3D assembly; the full cross-device lesson system remains incomplete.
- LED, resistor and adjustable DC source with a limited single-loop LED model,
  polarity and overcurrent outcomes, visible brightness/damage, bilingual LED
  wiring guidance and experiment controls. A two-terminal momentary button
  can switch that LED circuit and releases when the user stops pressing it. A
  separate lab example illustrates an explicitly hypothetical GPIO input with
  pull-up, pull-down or floating behavior; it does not use real firmware state.
- HC-SR04 5 V module physical definition, procedural visual, bilingual pin
  information and source note at `docs/hardware/sim-digital-inputs.md`. Its
  workbench measurement simulation and firmware support remain in development.
  The lab offers an isolated hypothetical trigger/distance example, explicitly
  assuming verified power, trigger and ECHO level shifting; it does not evaluate
  the active bench. Potential 5 V ECHO-to-GPIO paths are diagnosed; resistor-
  mediated paths are unsupported. A standalone worst-case divider calculator
  accepts explicit bounds but does not change bench evaluation or interlocks.
- BME280 Adafruit 2652 physical definition, procedural mesh, real header pin
  names, address property, bilingual pin descriptions and a source note at
  `docs/hardware/bme280.md`. It is explicitly labelled simulation in
  development. Its current firmware support is not implemented.
- BME280 shared evaluation for a bounded topology: USB-powered ESP32, direct
  3.3 V/common-ground supply, configured I²C pins and modeled address wiring.
  It exposes bounded session stimuli as simulated readings, separately from the
  unsupported firmware status. Unknown bus loads, supplies and control wiring
  are not treated as ready. The selected-device panel exposes session-only
  environment controls and simulated readings; the lab has an isolated example.
  Direct 5 V BME280 pull-up connections to ESP32 GPIO are diagnosed and gate the
  powered session. Supply or GPIO paths through resistors are conservatively
  marked unsupported rather than solved; arbitrary other analogue paths, timing
  and pull-up sizing remain unmodeled.

## Remaining work, in order

1. **Finish the shared electrical and workbench foundations.** Connect real
   source/load declarations and generic evaluation to practical workbench
   interactions, handling unsupported networks explicitly. Finish selection,
   pin and wire inspectors, ranked diagnoses with highlighted points, live
   project checklist and camera focus, catalogue metadata and accessibility.
   Preserve legacy recipes and saved projects. The evaluator is an operating-
   point approximation, not a SPICE solver.
2. **Finish the device lab and LED vertical slice.** The LED lesson, local
   progress, bounded exercises and project handoff exist. Complete hands-on 3D
   assembly, asset provenance/fallback, hash routing, close-up visual quality,
   and full touch/accessibility acceptance.
3. **Complete the BME280 vertical slice.** Bounded 3.3 V/I²C evaluation,
   simulated readings, bilingual lesson and guided project exist. Expand
   supported supply/control topologies only with sourced module-level data;
   complete 3D assembly and touch/accessibility acceptance. Do not claim full
   electrical realism or use chip-only current figures as whole-module consumption.
4. **Build the remaining first device pack.** Add documented independent
   supplies/battery/regulator; button module and HC-SR04; SSD1306 OLED; SG90
   servo; TB6612FNG plus motor; and WS2812 strip. Each needs realistic declared
   limits and relevant generic protocol/load evaluation, diagnostics, 3D
   representation, bilingual lessons and guided project use. The existing
   two-terminal button and bounded GPIO helper with explicit external drivers
   are not the planned three-pin button module; HC-SR04 has a physical definition
   and safety diagnostics but not measurement behavior. The GPIO helper is not
   yet connected to live firmware/device evaluation.
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

## In-progress contextual wire tools

The shared `WIRE_PALETTE` and `recommendedWireColor` compatibility export are
in `sim/wire-color.js`, with round-trip and automatic-colour tests. The existing
wire menu uses the shared manual colours. A reusable property editor is wired
into the part menu for numeric, enum and boolean properties; the push button
retains its momentary press/release control. DOM tests cover the BME280 address,
resistor constraints, boolean values and the existing menu callbacks.

`sim/ui/context-panel.js` renders selection details, pin and wire actions and
bilingual accessible colour controls. It is connected to workbench pin and wire
selection, and its start-wire action uses the existing click-to-wire flow. DOM
and interaction tests cover the controls, and a regression test verifies
recolouring a faulty wire preserves its diagnosis. On power-on, independent
rings highlight the first diagnosis's available points, and independent
outlines mark wires on the affected electrical nets without recolouring their
materials. Highlights clear when unplugging. Momentary buttons release if
their menu is replaced or closed. Headless Chrome checks exercised real
workbench pin and wire picking, start-wire, recolouring, deletion and a powered
wire's independent outline; separate WebGL pixel checks verified visible box and
tube silhouettes, preserved wire colour and cleared highlights. Full
browser/accessibility acceptance remains. The static-server check had no brain
backend, so its connection error took precedence over the diagnosis text;
powered edits now recompute the first diagnosis and its highlighted points and
wires; higher-priority connection errors can still hide the diagnosis text. The
running body remains based on its power-on snapshot, not a live re-evaluation.
The powered-edit regression test exercises diagnosis calculation. Pin context panels now
anchor to pointer coordinates, open part-property controls follow external bench
updates and close if their part disappears, and the Space view shortcut no longer
intercepts interactive controls. The context panel now clamps its measured size
within the viewport. A headless Chrome session confirmed pin selection and
click-to-wire, wire selection and recolouring, and Space activation of the Parts
button without changing view. A separate headless Chrome check confirmed a
powered short retains its diagnosis when recoloured and updates it when the
faulty wire is removed. A directly instantiated context panel stayed within the
viewport at the lower-right edge. External property updates have not been
verified in the real workbench. Workbench UX plan Task 3 is not complete. The
current changes are uncommitted.
Verification: `npm test` passed (1,343 Node tests, 8 skipped; 120 admin tests);
`npm run typecheck` and `npm run build` passed. The existing large-chunk build
warning remains.

## In-progress project adapter

`sim/projects.js` adapts the three existing recipes, including selected screen
and wand variants, into ordered steps and desired links without changing
autowire. `sim/project-progress.js` derives missing, complete or fault states
from nets and merged evaluator faults, including crossed speaker terminals.
`world.focusPoints()` frames pin/hole anchors, accounts for the project sidebar
and resolves when its camera animation finishes or is superseded. A separate
blue guidance marker does not replace diagnostic highlights.

The Projects panel is now connected to the workbench in guided and free modes;
automatic runs select their actual project variant. Free-mode faults are ranked
with destructive and immediate electrical hazards before warnings and firmware
support notices; legacy faults without severity use conservative defaults.
Headless Chrome confirmed that Show me leaves both endpoints visible beside the
sidebar and that adding a wire updates the checklist. Project selection is session-only. Chinese connection
explanations now cover every current recipe, screen model and wand variant;
reason identifiers remain stable when optional links change order. The workbench
reads the laboratory's saved language setting on load. Known electrical,
firmware and legacy device fault codes now have Chinese explanations, used for
power-on and powered-edit diagnoses; unknown codes retain their English fallback.
Headless Chrome verified a Chinese short-circuit diagnosis. Non-fault wiring
hints and the next-step hint also have Chinese text. A workbench language selector
asks for confirmation, saves the bench, and reloads; this disconnects a live
session and does not preserve project selection. A rejected confirmation or
storage failure does not reload. Headless Chrome verified cancellation and a
successful change with a saved part. The main toolbar and automatic-wiring
choices are localized; some older controls remain English. Project checklist
refresh retains keyboard focus, and Show me closes the sidebar on narrow screens
so both highlighted endpoints remain visible. A 390 px headless Chrome touch
emulation verified adding a resistor and focusing a connection. Complete bilingual,
touch and accessibility acceptance remains outstanding.
`sim/ui/catalogue-panel.js` now replaces the old Parts panel,
with search, filters, breadboards, favourites saved locally, Add/Learn controls
and thresholded pointer drag. The LED, resistor, DC source and button entries
explicitly state that their simulation is limited to LED circuits; the resistor
and source are identified as not requiring firmware. Catalogue cards show the
referenced BME280 VIN range and clearly labelled simulator voltage assumptions for
LEDs, DC sources and screens; unspecified ratings remain omitted. Learn opens the existing
device lab page. DOM
integration tests cover callbacks, focus and panel exclusivity; headless Chrome
verified search, adding, favouriting and dragging a resistor. Touch, both-language
and full accessibility browser acceptance remain outstanding.

## Lesson progress foundation

A versioned, local-only lesson progress store is implemented separately from the
bench save. It ignores corrupt records individually, handles unavailable storage,
filters removed stages, and preserves newer schema or lesson versions on write.
A pure five-stage lesson validator and navigation/completion state machine can
restore and export this progress. Structured bilingual LED lesson content and a
matching `led-basics` source–resistor–LED project are registered; the existing v3
bench format still requires an unconnected ESP32. The lab can add a part to the
current bench or hand off the LED project; replacing a non-empty bench requires
confirmation, and failed storage leaves the current bench intact. Headless Chrome
verified cancellation, project launch, and adding a second LED. The LED lab now
presents all five stages, persists local completion, and uses an isolated bench
and shared evaluation for wiring and experiments. Wiring is currently a labelled
connection checklist rather than a 3D assembly interaction; lab wiring resets on
exit while stage completion persists. Headless Chrome verified the five stages,
bench isolation, and Chinese-language refresh/resume. The planned hash route,
close-up scene improvements and full touch/accessibility acceptance remain open.

## LED unsupported-network reporting

Closed LED loops with multiple series resistors or LEDs are now reported as
unsupported instead of silently shown as off; disconnected loops remain off.
The evaluator does not estimate current or damage for these networks. Their
unsupported status is included in shared diagnostics, including for an
independent DC source while USB is disconnected. The shared result now also
reports reversed polarity, current limiting, overcurrent and previously burnt
LEDs, and carries modeled overcurrent damage into its burn list. Headless Chrome
verified unsupported and reversed cases in the free-workbench panel. Closed LED loops containing multiple series
sources are also reported as unsupported, while unrelated sources leave a valid
loop unchanged. Independent DC sources now have direct short and parallel/opposed
source-contention checks, available even without USB; headless Chrome verified
parallel-source diagnosis. These checks are connectivity-only: current sharing,
reverse current and arbitrary analogue networks remain outside the model.
Board 5 V wired directly to GPIO now warns and trips the power gate; a path
through resistors is conservatively unsupported. Burnt resistors remain possible
paths for safety checks because their failure mode is unknown. Direct
external-source connections to ESP32 GPIO now warn when the configured source
voltage exceeds nominal logic voltage, when negative voltage is possible, or when
there is no common ground. Even within nominal voltage, GPIO direction and drive
contention are explicitly labelled unmodeled. Voltage warnings are conservative,
not measured pin voltage or a claim of damage. A grounded source reaching an
ESP32 GPIO or power rail through one or more resistors is conservatively marked
unsupported, with the resistor endpoints included in the diagnosis; unrelated
pull-downs are not treated as source paths. A floating source reaching GPIO via
resistors reports a missing common reference; a resistive reference to the board
is marked unsupported instead. Headless Chrome verified the grounded-path warning
with USB disconnected. Other intervening components and arbitrary analogue
networks remain unmodeled. Passive resistors and standalone DC sources no longer
produce a firmware-unsupported diagnostic. The workbench pin inspector reuses
bilingual lab descriptions, including the isolated DC source's positive and return
terminals.

Independent supplies directly connected across an ESP32 rail and ground now
produce source-contention diagnostics while USB is connected; with USB out,
external board powering is explicitly unsupported rather than presented as
simulated. A board-related contention or unsupported power network blocks body
startup and initial autonomous toy motion; headless Chrome verified that no brain
request is made for a contested board. A power conflict or board rail short added
while USB is connected, or a direct external GPIO overvoltage/negative-voltage
risk, now stops the body session and toy motion, invalidates
pending starts and latches the safety stop until USB is cycled. In headless Chrome,
a mocked active session closed its socket and unsubscribed after a conflict; a
late character-list response was also ignored. Pending body startup is aborted;
if microphone permission is granted after cancellation, its unused audio pipeline
is stopped rather than retained. An already successful shared microphone remains
held according to the existing audio design. Browser permission prompts themselves
cannot be forcibly dismissed. This protects only hazards the current bounded
evaluator detects; it is not a general electrical safety guarantee.

## First device pack update (2026-11-13)

Tasks 1-6 of `docs/superpowers/plans/2026-11-11-sim-first-device-pack.md` are
implemented and committed: independent USB/battery/bench/MB102 power, the
KY-004 button module and HC-SR04 measurement state, the SSD1306 OLED, the SG90
servo, the TB6612FNG with a DC motor, and the WS2812 strip with aggregate
startup-current brownout. Each family has a checked-in hardware note, a
five-stage bilingual lesson, at least one guided project and focused tests. A
`test/sim/first-pack.test.js` registry asserts parts, catalogue rows, firmware
contracts, round-trip persistence, lesson shape and project use.

The browser acceptance checklist is `docs/sim-first-pack-acceptance.md`. Remaining acceptance work is explicit: the real-browser Chrome/Edge matrix
(both languages, touch and accessibility, roughly 20 devices, 60/30 fps and
LOD fallback) has not been run; the power/button/sonar/OLED/servo/motor/strip
lessons are registered content but do not yet have dedicated lab stage panels;
OLED frames and servo/motor motion are not drawn in the 3D scene; the raw
two-terminal button and resistor are taught inside existing lessons rather than
standalone; and the real firmware still implements only the original
audio/screen/toy build. Do not describe the pack as fully accepted or
firmware-supported.

## Guidance realignment (2026-11-13)

The simulator now has one target model for guidance. `sim/plan.js` adapts an
authored project or recipe into a plan; checklists, the next-step hint, the
wiring overview, camera focus and project autowire read that plan. Free building
is the absence of a plan and is no longer a pseudo-project in the selector.

The project panel has Project and Diagnostics tabs. Diagnostics are available
while a project is selected and show an empty state when the bench cannot be
evaluated. Selecting a project switches to Project; leaving it switches back to
Diagnostics. The wiring overview uses the familiar schematic when every endpoint has a
legacy position; otherwise it draws an automatic left-to-right graph of the
plan's parts and links. A plan with no links falls back to an empty list, so a
wrong schematic is never drawn. "Build it for me" applies any selected plan onto a fresh bench without
starting a body demo or plugging in USB; the toolbar's "Demo build" keeps the
animated recipe demos.

The two entry points have separate jobs: Demo build is the three legacy recipes
with watch/step and body demos; Build it for me is every project, applied at
once and left unplugged so the user can inspect and power it deliberately.

`targetFor` remains as the legacy link generator used by the plan adapter,
recipes and power tests; the duplicated presentation copies of the target and
layout are gone. The real-browser acceptance checklist still governs sign-off.

## Last verification

At implementation commit `485cb85`, `npm test` passed: 1,154 Node tests passed,
8 skipped, and 120 admin tests passed. `npm run typecheck` and `npm run build`
passed. The build warned that a minified chunk exceeds 500 kB. Browser checks
confirmed BME280 placement, lab pin selection and the isolated environment
example. A later browser check verified bounded 3.3 V workbench readings and
session-only stimulus updates. Headless Chrome also completed the five BME280
lesson stages, simulated swapped-line and address-conflict faults, restored
Chinese progress and launched the project with the selected address. Network-listening tests
required execution outside the restricted sandbox.
