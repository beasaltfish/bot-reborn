// The panels the body can drive, as data (screens spec §6). One table, equal
// to core/screens.json; the screen code reads a profile and sets the panel up
// from it, so a new model is a row and no new code path.

#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef enum { CTRL_ILI9341, CTRL_ST7789, CTRL_ST7735, CTRL_GC9A01 } controller_t;

typedef struct {
  const char *id, *label;
  controller_t controller;
  uint16_t w, h;                       /* landscape, as shown */
  bool invert, bgr, swap_xy, mirror_x, mirror_y;
  uint8_t gap_x, gap_y;                /* panel RAM offset */
  uint8_t spi_mode;
  uint32_t pclk_hz;
  bool verified;                       /* someone saw it on real glass */
} screen_profile_t;

size_t screen_profile_count(void);
const screen_profile_t *screen_profile_at(size_t i);      /* NULL past the end */
const screen_profile_t *screen_profile_find(const char *id);   /* NULL if unknown */
