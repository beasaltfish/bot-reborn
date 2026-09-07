# Hardware notes

## Device

| | |
|---|---|
| Chip | FT232H |
| USB vendor ID | `0x0403` |
| USB product ID | `0x6014` |
| Mode | async bitbang (`SIO_SET_BITMODE`, mode `0x01`) |
| Output pins | `D4`, `D5` (pin mask `0x30`) |
| Bulk OUT endpoint | `2` |

## Wiring

```
FT232H D4 ──► motor driver IN1
FT232H D5 ──► motor driver IN2
FT232H GND ─► motor driver GND
```

| D4 | D5 | Result  |
|----|----|---------|
| 1  | 0  | forward |
| 0  | 1  | reverse |
| 0  | 0  | stop    |

Never drive `D4` and `D5` high at the same time — on an H-bridge that is a
shoot-through condition.

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
