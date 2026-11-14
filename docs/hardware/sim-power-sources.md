# Power source hardware references

This note covers the four power parts the simulator models: a USB 5 V source,
a 4×AA battery holder, an adjustable bench supply and an MB102 breadboard
regulator. Values are the selected real variants; the state-of-charge
interpolation and several resistances are explicitly model assumptions, not
measurements.

## USB 5 V source

A standard USB 2.0 host port supplies 5 V ±5% and up to 500 mA. The simulator
uses 5.0 V, a 500 mA current limit and a 0.1 Ω source resistance (a model
assumption, not a USB specification). Higher-current chargers and USB Battery
Charging ports are not modeled.

Source: [USB 2.0 specification](https://www.usb.org/document-library/usb-20-specification).

## 4×AA battery holder

The holder takes four AA cells in series. Two chemistries are selectable.

- **Alkaline:** Energizer E91. 1.5 V nominal, 150–300 mΩ internal resistance
  when fresh, 2850 mAh to 0.8 V at 25 mA. The pack is therefore 6.0 V nominal
  and 0.6–1.2 Ω; capacity stays 2850 mAh in series.
- **NiMH:** Panasonic eneloop BK-3MCC. 1.2 V nominal, about 25 mΩ internal
  impedance, 2000 mAh minimum. The pack is 4.8 V nominal and about 0.1 Ω.

The simulator interpolates linearly between a full pack and an empty pack:
alkaline 6.0 V → 4.0 V and 0.6 Ω → 1.2 Ω; NiMH 5.6 V → 4.0 V and 0.1 Ω → 0.4 Ω.
The empty voltage, the resistance rise and the 2000 mA / 3000 mA current bounds
are model assumptions for a usable electronics cutoff, not datasheet values.
Charging, self-discharge, temperature and cell mismatch are not modeled. The
4×AA pack is treated as one source, not four independently loaded cells.

Sources: [Energizer E91 datasheet](https://data.energizer.com/pdfs/E91NA0426.pdf),
[Energizer battery internal resistance](https://data.energizer.com/pdfs/batteryir.pdf),
[Panasonic eneloop BK-3MCC datasheet](https://files.batteryjunction.com/frontend/files/panasonic/datasheet/Panasonic-Eneloop-BK-3MC-Datasheet.pdf).

## Bench power supply

The selected unit is the Korad KA3005P: one channel, 0–30 V and 0–5 A, with
constant-voltage/constant-current operation, over-voltage and over-current
protection. The simulator bounds its training range to 0–12 V and 0–3 A so a
beginner cannot set an unbounded output, and uses a 0.05 Ω output resistance as
a model assumption. Ripple, response time, remote programming and thermal
derating are not modeled.

Source: [Korad KA3005P specifications](https://www.koradtechnology.com/product/83.html),
[Korad KA3005P manual](https://storage.tameson.com/asset/Products/Manuals/EN/korad_ka3005p_manual.pdf).

## MB102 breadboard regulator

The MB102 module accepts 6.5–12 V through a barrel jack (or 5 V through its USB
socket), and provides jumper-selected 3.3 V or 5 V outputs from AMS1117 linear
regulators. Sellers specify a maximum output below 700 mA. The AMS1117 dropout
is about 1.1–1.3 V. The simulator models one channel at 700 mA with a 1.1 V
dropout and a linear current path: input current equals output current, so the
regulator dissipates the voltage difference as heat.

The MB102 has an input reverse-polarity diode but no reverse-current protection.
Back-feeding the output, or powering the DC jack and USB input at the same time,
can damage the regulator or the upstream port; the simulator therefore declares
the reverse-current path unprotected and reports source contention when another
source drives the same rail. It does not model thermal shutdown, the second
channel or jumper contact resistance.

Sources: [MB102 datasheet](https://www.handsontec.com/dataspecs/mb102-ps.pdf),
[MB102 module notes](https://www.cytron.io/p-breadboard-power-module-md-102).

## Simulator limitations

The operating point is a coarse, bounded DC approximation. It does not model
charging, battery ageing, thermal behaviour, cable resistance, ripple, transient
loads, fuse behaviour or arbitrary analogue networks. A source with internal
resistance feeding a regulator is now modeled; paths through explicit resistors
remain unsupported unless a capability declares them.
