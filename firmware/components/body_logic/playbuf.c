#include <string.h>
#include "playbuf.h"

void playbuf_clear(playbuf_t *p) {
  p->head = 0;
  p->count = 0;
  p->has_odd = false;
}

static bool push(playbuf_t *p, int16_t s) {
  if (p->count == PLAYBUF_SAMPLES) return false;
  p->s[(p->head + p->count) % PLAYBUF_SAMPLES] = s;
  p->count++;
  return true;
}

size_t playbuf_write_bytes(playbuf_t *p, const uint8_t *bytes, size_t n) {
  size_t written = 0;
  size_t i = 0;
  if (p->has_odd && n > 0) {
    p->has_odd = false;
    written += push(p, (int16_t)(p->odd | (bytes[0] << 8)));
    i = 1;
  }
  for (; i + 1 < n; i += 2) written += push(p, (int16_t)(bytes[i] | (bytes[i + 1] << 8)));
  if (i < n) { p->odd = bytes[i]; p->has_odd = true; }
  return written;
}

size_t playbuf_read(playbuf_t *p, int16_t *out, size_t n) {
  size_t real = n < p->count ? n : p->count;
  for (size_t i = 0; i < real; i++) out[i] = p->s[(p->head + i) % PLAYBUF_SAMPLES];
  p->head = (p->head + real) % PLAYBUF_SAMPLES;
  p->count -= real;
  memset(out + real, 0, (n - real) * sizeof *out);
  return real;
}
