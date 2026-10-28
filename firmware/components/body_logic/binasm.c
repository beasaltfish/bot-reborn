#include "binasm.h"

#include <string.h>

bool binasm_feed(binasm_t *a, const uint8_t *data, size_t len, size_t offset, size_t total) {
  if (offset == 0) { a->len = 0; a->overflow = false; }
  // `total` is known from the FIRST part, so a frame that cannot fit is
  // refused before its bytes are copied — the ESP32 gets the news while there
  // is still a socket to read, not after 300 chunks of PSRAM traffic.
  if (total > a->cap) a->overflow = true;
  if (a->overflow || offset != a->len || len > a->cap || a->len + len > a->cap) {
    a->overflow = true;
  } else {
    if (len > 0) memcpy(a->buf + a->len, data, len);
    a->len += len;
  }
  if (offset + len < total) return false;
  if (a->overflow) { a->len = 0; return false; }
  return true;
}
