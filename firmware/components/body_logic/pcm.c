#include "pcm.h"

void pcm_from_i2s32(const int32_t *in, int16_t *out, size_t n, int shift) {
  for (size_t i = 0; i < n; i++) {
    int32_t v = in[i] >> shift;
    out[i] = (int16_t)(v > INT16_MAX ? INT16_MAX : v < INT16_MIN ? INT16_MIN : v);
  }
}

void pcm_to_i2s32(const int16_t *in, int32_t *out, size_t n) {
  for (size_t i = 0; i < n; i++) out[i] = (int32_t)((uint32_t)(uint16_t)in[i] << 16);
}
