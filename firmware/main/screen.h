// The pet's screen (pet screen spec §6, screens spec §6). Set up from a
// profile, on its own task below the audio tasks in priority: a slow panel
// must never starve the I2S rings.

#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "screen_profile.h"

/* Bring the panel up from this profile and run a short colour test. The
   panel is ready (screen_ready) once the test is over; a missing or broken
   panel costs a few lines in the log and nothing else. */
void screen_start(const screen_profile_t *p);

/* True once the panel is up and the colour test has ended. */
bool screen_ready(void);
uint16_t screen_width(void);    /* landscape, as shown */
uint16_t screen_height(void);

/* Draw `rows` full-width rows of RGB565 (as the panel wants the bytes) from
   row y down. False if the panel is not ready or the draw failed. */
bool screen_draw_band(int y, int rows, const uint16_t *rgb565);
