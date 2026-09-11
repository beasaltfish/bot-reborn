# Hardware notes

Source of truth for the pin model: spec §3.1–§3.2
(`docs/superpowers/specs/2026-09-07-voice-robot-design.md`). If this file and
the spec ever disagree, the spec wins and this file is the bug.

## Device

| | |
|---|---|
| Chip | FT232H |
| USB vendor ID | `0x0403` |
| USB product ID | `0x6014` |
| Mode | async bitbang (`SIO_SET_BITMODE`, mode `0x01`) |
| Output pins | `D4`–`D7` (pin mask `0xF0`) |
| Bulk OUT endpoint | discovered at open time (first bulk OUT on the interface) |

Two driver chips, not one: **U3** drives the wheels, **U5** swings the steering
coil. That is why there are four output pins and not two.

| bit | pin | goes to | meaning |
|---|---|---|---|
| bit4 | `D4` | U3 input A | drive |
| bit5 | `D5` | U3 input B | drive |
| bit6 | `D6` | U5 input A | steer |
| bit7 | `D7` | U5 input B | steer |

## ⚠️ Before you solder D6/D7

> **D6/D7 必须焊到 U5 的输入脚，不能直接接线圈——会烧 FT232H 引脚。**
> 找输入脚：SOT-23-6 六个脚里排除 VCC、GND、L1+、L1-，剩下两个。

(In English: D6/D7 must go to U5's *input* pins, never straight to the coil —
driving the coil directly will destroy the FT232H pins. To find the inputs on
the SOT-23-6 package, rule out VCC, GND, L1+ and L1−; the remaining two are
the inputs.)

## Wiring

```
FT232H D4 ──► U3 input A     (drive)
FT232H D5 ──► U3 input B     (drive)
FT232H D6 ──► U5 input A     (steer)   ← input pin, never the coil
FT232H D7 ──► U5 input B     (steer)   ← input pin, never the coil
FT232H GND ─► board GND
```

## Action bytes (spec §3.2)

```
drive   forward  = 0x10      backward = 0x20      stop   = 0x00
steer   side A   = 0x40      side B   = 0x80      centre = 0x00
```

A combined action is the bitwise OR: `forward + side A = 0x50`. Everything off
is `0x00`, which is the stop byte the executor appends to every buffer
(spec §4.2).

Steering is a polarised electromagnet that swings the axle; a spring recentres
it when the coil is de-energised. There is no "turn in place" — `drive` has no
`none` value (spec §3.3).

Never raise both bits of the *same* driver at once (`D4`+`D5`, or `D6`+`D7`):
on an H-bridge that is a shoot-through. `pinsFor()` cannot produce it — one
drive bit and one steer bit, never two of either.

## Calibration results (spec §12)

These are measurements, not decisions. Fill them in from the bench page
(`web/bench.html`) and update the constants they feed. **Blank = not measured
yet**; do not treat a blank row as "fine".

| # | What | Measured | Feeds |
|---|---|---|---|
| ① | Which steer byte is left: `0x40` or `0x80` | | `STEER_BITS` in `web/executor.js` |
| ② | Bitbang byte rate at 1200 baud (target 2–5 ms/byte), and the car's speed in m/s | | `DEFAULT_BYTES_PER_MS` in `web/ftdi.js`; cross-checks `MAX_COAST_MS ≈ 1.5 m` |
| ③ | Pull-down resistors on U3/U5 inputs? (power off, measure input-to-GND: tens of kΩ = yes, open = no) | | Spec §4.7's gap. No pull-downs → solder 2 × 10 kΩ to GND, or layer 0 does not hold when USB is unplugged |
| ④ | Board VCC and U3 logic threshold (5 V logic needs ≥ 0.7 × VCC = 3.5 V; the FT232H drives 3.3 V) | | Whether a level shifter is needed at all |
| ⑧ | Shortest pulse that reliably starts the motor (from 100 ms, +50 ms, 10 tries each) | | `MIN_DURATION_MS` in `web/executor.js` |

## USB driver

WebUSB can only claim an interface that is not already claimed by a kernel
driver.

- **Windows** — the FTDI VCP/D2XX driver binds the device by default, so
  `claimInterface()` fails with a security error. Replace the driver with
  **WinUSB** using [Zadig](https://zadig.akeo.ie/).
- **Linux** — unbind `ftdi_sio`, or add a udev rule granting your user access
  to `0403:6014`.
- **macOS** — usually works without changes; if not, unload the Apple FTDI
  driver.
