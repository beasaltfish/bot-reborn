// This board's wiring. Placeholders from the spec (§4), to be moved freely on
// the breadboard; nothing outside this file names a pin.

#pragma once

/* Motor driver inputs, as the FT232H's D4–D7 were (docs/hardware.md). */
#define PIN_DRIVE_A 4   /* U3 input A */
#define PIN_DRIVE_B 5   /* U3 input B */
#define PIN_STEER_A 6   /* U5 input A — the input pin, never the coil */
#define PIN_STEER_B 7   /* U5 input B */

/* One I2S bus, INMP441 and MAX98357A sharing BCLK and WS. */
#define PIN_I2S_BCLK 12
#define PIN_I2S_WS   13
#define PIN_I2S_DOUT 14   /* to MAX98357A DIN */
#define PIN_I2S_DIN  15   /* from INMP441 SD */

/* The status light: a plain LED + resistor on its own pin. The DevKitC's
   on-board LED is an addressable RGB one (GPIO48 or 38) and does not light
   from a plain GPIO write. */
#define LED_GPIO 21

/* INMP441's 24 bits sit at the top of a 32-bit slot; this many right shifts
   make 16-bit PCM. Smaller is louder (14 = ×4): tune it against the fake
   brain's uplink dBFS on the bench. */
#define MIC_SHIFT 14

/* Until `url` is typed on the serial console. */
#define DEFAULT_BODY_URL "ws://192.168.3.79:8787/body"
