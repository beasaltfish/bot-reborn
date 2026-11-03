// The body's second socket, to the brain's /screen (pet screen spec §5): it
// says hello with the panel's size, then receives JPEG frames and nothing
// else. Frames land in a three-buffer slot in PSRAM where the newest wins;
// the draw task takes from it. A dropped socket never blanks the screen: the
// last frame stays, and the socket knocks again with backoff.

#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "settings.h"

/* Needs the screen started with a profile. Returns at once. */
void screen_link_start(const settings_t *s);

/* The newest frame nobody has drawn: its bytes and length, and it is held
   (never overwritten) until screen_link_release_frame. False when there is no
   new frame. */
bool screen_link_take_frame(const uint8_t **jpeg, size_t *len);
void screen_link_release_frame(void);
