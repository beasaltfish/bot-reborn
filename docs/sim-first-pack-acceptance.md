# First device pack browser acceptance

Run this checklist before calling the first device pack accepted. Automated
tests do not cover layout, touch, accessibility, frame rate or whether a real
project is understandable. Record the browser and date in the sign-off table.

## Preconditions

```bash
npm test && npm run typecheck && npm run build
npm start                 # http://localhost:8787/sim/
```

- Chrome and Edge, desktop 1920 × 1080 at 100% zoom.
- Chrome DevTools device emulation at 390 × 844 with touch.
- Language set to English in one pass and Chinese in another.
- A 20-device bench (below). Keep DevTools closed except for the performance
  pass, because it changes frame pacing.

## 1. Automated gates

| Check | Expected | Result |
| --- | --- | --- |
| `npm test` | 1447 Node tests and 120 admin tests pass | |
| `npm run typecheck` | no errors | |
| `npm run build` | built; only the existing >500 kB warning | |

## 2. Desktop, English and Chinese

For each page: workbench (`/sim/`) and lab (`/sim/lab.html?part=<id>`).

- [ ] Toolbar, catalogue, project panel, context panel, runtime panel and status
      line are readable in both languages; no clipped or overlapping copy.
- [ ] The project selector has no “Free workbench” entry; not choosing a project
      is the free build, and Diagnostics is the default tab there.
- [ ] Selecting a project switches to Project; Diagnostics stays one click away;
      Leave project clears the selection without changing the bench.
- [ ] Chinese text does not overflow buttons or panels at 100% zoom.
- [ ] Language change confirms, saves the bench and reloads; a cancelled change
      leaves the bench and language untouched.
- [ ] Catalogue search finds every first-pack device by English and Chinese name;
      Add and Learn both work.
- [ ] Selecting a part opens the runtime panel in the lower-right corner and does
      not cover the selection or the status line.

## 3. Device families

### LED, resistor, button

- [ ] LED polarity, missing resistor and overcurrent produce distinct diagnoses;
      the LED visibly dims/brightens and a burnt LED stays burnt.
- [ ] Two-terminal button releases when the pointer leaves the part.
- [ ] KY-004: powering VCC from 3.3 V gives a high idle signal and low while
      held; powering from 5 V reports a logic-level hazard; the cap is visibly
      depressed while held.
- [ ] With the runtime panel, the button state changes the evaluated GPIO level.

### Power

- [ ] USB source, 4×AA battery, bench supply and MB102 regulator appear with
      their documented voltage copy.
- [ ] Battery chemistry/charge changes the loaded rail voltage; a low charge
      plus a regulator reports dropout.
- [ ] Two sources on one rail report contention; reversed battery reports
      reverse polarity; a weak supply browns out a heavy load.
- [ ] Persistence: recharge settings, save, reload; chemistry and charge return.

### HC-SR04

- [ ] Direct 5 V ECHO into 3.3 V GPIO reports `logic-level-incompatible`.
- [ ] Swapping TRIG and ECHO reports the swap.
- [ ] With a tolerant profile fixture, the distance slider measures 2–400 cm and
      clamps outside the range; idle shows “no measurement”.
- [ ] A resistor path on ECHO remains explicitly unsupported.

### SSD1306

- [ ] Direct wiring is ready and the glass is blank until a frame is drawn.
- [ ] Changing the runtime readings redraws three lines; the text is legible at
      the default camera distance.
- [ ] Two displays at 0x3c report address conflict; swapping SDA/SCL reports a
      bus fault.
- [ ] Shared bus with BME280: both addresses work and the BME readings appear on
      the display when no runtime lines are set.

### SG90

- [ ] Idle, moving and stalled states show different current; a stalled load is
      visible in diagnostics.
- [ ] The horn turns with the runtime angle and holds the commanded angle.
- [ ] VCC on a GPIO is refused; a missing common ground is reported.
- [ ] Independent 5 V supply with a shared ground works.

### TB6612 and DC motor

- [ ] Forward/reverse/coast/brake states and currents are distinct; the rotor
      spins in the commanded direction.
- [ ] STBY low keeps the driver off; VM on a GPIO is refused; missing ground is
      reported; crossed motor terminals reverse direction.
- [ ] Stall current is reported; a burnt motor stays burnt after reload.
- [ ] Selecting the motor drives the first TB6612 on the bench.

### WS2812

- [ ] 3.3 V data on a 5 V strip reports level incompatibility.
- [ ] Colour and pixel-count controls light the strip and change current; white
      is the peak case.
- [ ] DOUT-as-input reports the wrong direction; missing ground keeps it off.
- [ ] A weak supply with two white pixels browns out.

## 4. Guided projects

Complete each project in both languages; every checklist item should reach
“complete” except the documented level-incompatible links.

- [ ] `power-a-rail`
- [ ] `button-led`
- [ ] `distance-reader` (ECHO risk may remain visible)
- [ ] `environment-display`
- [ ] `proximity-servo` (ECHO risk may remain visible)
- [ ] `motor-driver-basics`
- [ ] `status-light-strip` (data-level risk may remain visible)
- [ ] `led-basics`, `bme280-readings` and the original audio/screen/toy recipes
      still start and finish unchanged.
- [ ] Build it for me applies the selected plan, keeps the previous bench for
      Back to my bench, and does not merge into the old circuit.
- [ ] The wiring overview draws the legacy schematic for audio/toy and a link
      list for new devices; it never invents a wrong drawing.
- [ ] Next hint names the selected plan's first missing part or link, not the
      original recipe target.

## 5. Touch and small screens

At 390 × 844 with touch emulation:

- [ ] Catalogue search, Add, favourite and drag use pointer/touch, not only
      mouse events.
- [ ] Pin selection, start-wire, recolour and remove work with a finger.
- [ ] The runtime panel fits, scrolls if needed and does not block the status
      line; range inputs can be dragged.
- [ ] The project panel and “Show me” keep both endpoints visible beside the
      sidebar (the sidebar closes when needed).
- [ ] The lab lesson panel and its controls work without hover.

## 6. Keyboard and accessibility

- [ ] Tab reaches toolbar, catalogue, project panel, runtime panel and lab
      lesson controls; focus is always visible.
- [ ] Space activates Parts and does not scroll or change the view.
- [ ] Selection changes, diagnoses and lesson progress are announced through
      their `role="status"` regions.
- [ ] Colour is never the only signal for a diagnosis or checklist state.
- [ ] Pin and wire actions have accessible names; range inputs announce values.

## 7. Large bench and performance

Add roughly 20 devices: ESP32, mic, amp, speaker, LED, resistor, two buttons,
HC-SR04, BME280, SSD1306, SG90, TB6612, DC motor, WS2812, USB source, 4×AA,
bench supply, MB102, extra LED/resistor.

- [ ] Orbit at 1080p: target 60 fps on the baseline profile.
- [ ] Forced low profile: at least 30 fps; pin anchors, selection and
      diagnostics still line up.
- [ ] Lower LOD and selective shadows do not move pin anchors or break picking.
- [ ] Stop interacting: continuous rendering stops; no fan spin or rising CPU.
- [ ] Reload with the saved 20-device bench: every part, wire, property and
      runtime reset behaves as documented (runtime values are session-only).
- [ ] One destructive fault per family still produces the expected diagnosis.

## Sign-off

| Browser | Version | Language | Desktop | Touch | Notes |
| --- | --- | --- | --- | --- | --- |
| Chrome | | EN | | | |
| Chrome | | ZH | | | |
| Edge | | EN | | | |
| Edge | | ZH | | | |

## Known accepted limitations

- Workbench and lab wiring in lessons is a checklist, not 3D assembly.
- OLED frames, motor spin and strip colours are visual models, not physical
  timing.
- The simulator does not model SPICE networks, thermal behaviour, battery
  charging, servo torque or motor inductance.
- The current real firmware implements only the original audio/screen/toy
  build; the new devices are electrically simulated and reported separately.
- The raw resistor and two-terminal button are taught inside the LED and
  button-module lessons.
- `distance-reader`, `proximity-servo` and `status-light-strip` intentionally
  leave the direct 5 V/3.3 V data hazard visible until level shifting is
  modeled.
