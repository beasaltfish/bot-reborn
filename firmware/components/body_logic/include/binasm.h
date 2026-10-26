// A binary frame arriving in parts, as esp_websocket_client delivers it
// (payload_offset / payload_len) — the binary twin of textasm_feed. The buffer
// is the caller's: on the chip it is a JPEG-sized buffer in PSRAM, and this
// file has no business guessing how big that is.

#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct {
  uint8_t *buf;
  size_t cap, len;
  bool overflow;
} binasm_t;

/* Feed one part; true once the whole frame is in buf. A part at offset 0
   starts a new frame; a frame that does not fit in cap, or whose parts arrive
   out of order, is dropped (false, and `overflow` until the next offset 0). */
bool binasm_feed(binasm_t *a, const uint8_t *data, size_t len, size_t offset, size_t total);
