# Body runtime: where it stopped

The body manifest is now the source for the simulator's device lessons. This
file records what a real board still needs, so the next person does not have to
rebuild the context from the diff.

## Working today

- `core/behaviors.js` validates bounded local rules: at most 16, level/edge or
  `everyMs >= 50`, commands only, no returned values.
- `sim/behavior-runtime.js` executes those rules; `sim/bench-io.js` answers
  `pin.write`, `pin.read`, `device.sample`, `device.measure` and
  `device.write`.
- Bench bodies in `sim/bodies/`: `button-led`, `bme280-readings`,
  `distance-reader`, `motor-driver-basics`, `status-light-strip`,
  `proximity-servo`, `environment-display`. Their projects are generated from
  `wiring` by `projectFromBody`; moving a pin is one resource and one link.
- Device drivers in the simulator: `bme280`, `hc-sr04`, `tb6612fng`, `ws2812`,
  and the two composed drivers `sonar-servo` and `bme280-display`.
- No project uses `simulation: 'sketch-*'`; the firmware drawer lists only
  `body` and `my firmware`; a circuit or a bench body has no firmware drawer.
- The C half of protocol 3 is host-tested: `proto.c` parses `cmd` and writes
  `result`; `bridge_io.c` holds the pin allowlist and restores `safe`;
  `firmware:test` covers parse, write/read and the full loop.

## Remaining

### 1. ESP-IDF bridge app (blocked: no `idf.py`, no board)

- [ ] A bridge build that sends `proto_hello_version(..., 3)` and uses
      `bridge_io` for `pin.write`/`pin.read`.
- [ ] `link_send_text` (or a dedicated result sender) from `firmware/main/link.c`;
      the app answers every `cmd` with a `result` carrying the same id.
- [ ] A compile-time or console-selected bridge mode that does **not** start
      the body's motors, audio, screen or IMU; its GPIO allowlist is the
      permission slip.
- [ ] `bridge_io_release` on `on_lost` / unplug.
- [ ] Device drivers for the four device ops: `bme280`, `hc-sr04`,
      `tb6612fng`, `ws2812`, plus the composed `sonar-servo` and
      `bme280-display`. None of these are in `bridge_io` yet; `device.sample`,
      `device.measure` and `device.write` are simulator-only.
- [ ] Firmware release/packaging for the bridge image, and the admin's board
      setup path to flash it (today it flashes `body.bin`).

### 2. Real-board acceptance (blocked: needs 1 and parts)

- [ ] LED module: install, adopt, say "turn on the light"; move the `led`
      resource and confirm the pin follows.
- [ ] BME280: `device.sample` returns temperature/humidity/pressure.
- [ ] Sonar: `device.measure` triggers and the distance updates.
- [ ] Servo: the composed `sonar-servo` moves on a distance change.
- [ ] Motor and strip: `device.write` drives the TB6612/WS2812.
- [ ] OLED: the composed `bme280-display` draws the readings.
- [ ] Protocol 2 body still falls back to the native templates; a plugin body
      over protocol 2 still gets `bridge`.

### 3. Known simulator gaps

- [ ] `device.write` payloads are not schema-checked per driver; a malformed
      motor/strip payload reaches the model and is defaulted there. Add a
      driver payload contract if these become character-facing.
- [ ] The BME280 body has a `sample` command but no `actions`; it is a bench
      body (`adoptable: false`) and the part panel reads the device model. If a
      character should ask for a reading, the body needs a character-facing
      action and a brain-side install path (or a module manifest).
- [ ] `proximity-servo` and `environment-display` use composed drivers in the
      simulator. Their real drivers are part of item 1, not separate bodies.
- [ ] `sketch-env-display` and `sketch-sonar-servo` remain in
      `sim/firmware/sketches.js` as reading examples. No project or UI list
      uses them; remove them only together with their registry tests or by
      replacing those tests with a synthetic firmware.

### 4. Cleanup carried from earlier work

- [ ] Rename the voice-only body id `none` to `voice`, keeping `none` as a
      read-only alias and normalising old files in `bodyOf`.
- [ ] Saved-body examples still do not travel from `body.json` to
      `/api/bodies`; a saved body's examples are not offered for adoption.
- [ ] Browser/visual acceptance of the Body tab, the read-only Simulation view
      and the board-less circuits. `playwright-cli` is not installed and no
      desktop browser is attached to this session; the behaviour is covered by
      unit/project tests, not by a visual pass.
- [ ] The admin Body tab's module copy ("Modules") still reads like a hardware
      shelf; consider "Example body packs" or a stronger "body = data" line.

## Design and plan

The working design and phase plan are local notes, ignored by git:

- `docs/superpowers/specs/2026-11-26-body-single-layer-design.md`
- `docs/superpowers/plans/2026-11-28-body-single-layer-phase1.md`

This file is the tracked summary; keep it current when the bridge lands.
