#include <string.h>
#include "screen_profile.h"

/* The same rows as core/screens.json, in the same order; test_screen_profile.c
   reads that file and fails if any field differs. A new panel is a row there
   and a row here. */
static const screen_profile_t PROFILES[] = {
  { "ili9341-tn", "ILI9341 2.4\" TFT", CTRL_ILI9341, 320, 240, false, true, true, true, false, 0, 0, 0, 20000000, false },
  { "ili9341-ips", "ILI9341V 2.8\" IPS", CTRL_ILI9341, 320, 240, true, true, true, true, false, 0, 0, 0, 20000000, false },
  { "st7789-320", "ST7789 2.0\" IPS", CTRL_ST7789, 320, 240, true, false, true, true, false, 0, 0, 0, 20000000, false },
  { "st7789-240", "ST7789 1.3\" IPS", CTRL_ST7789, 240, 240, true, false, false, false, false, 0, 0, 3, 20000000, false },
  { "st7735-160", "ST7735 1.8\" TFT", CTRL_ST7735, 160, 128, false, true, true, true, false, 0, 0, 0, 15000000, false },
  { "gc9a01-round", "GC9A01 1.28\" round", CTRL_GC9A01, 240, 240, true, true, false, false, false, 0, 0, 0, 20000000, false },
};

size_t screen_profile_count(void) { return sizeof PROFILES / sizeof PROFILES[0]; }

const screen_profile_t *screen_profile_at(size_t i) {
  return i < screen_profile_count() ? &PROFILES[i] : NULL;
}

const screen_profile_t *screen_profile_find(const char *id) {
  if (id == NULL) return NULL;
  for (size_t i = 0; i < screen_profile_count(); i++) {
    if (strcmp(PROFILES[i].id, id) == 0) return &PROFILES[i];
  }
  return NULL;
}
