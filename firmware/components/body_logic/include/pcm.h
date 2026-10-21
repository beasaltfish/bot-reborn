// Between the wire's 16-bit PCM and I2S's 32-bit slots. The INMP441 needs 64
// clocks a frame, so the bus runs 32-bit slots both ways.

#pragma once
#include <stddef.h>
#include <stdint.h>

/* INMP441: 24 bits at the top of the slot. Shift right by `shift` (16 = as
   is, 14 = ×4) and saturate to 16 bits. */
void pcm_from_i2s32(const int32_t *in, int16_t *out, size_t n, int shift);
/* MAX98357A: the sample in the slot's top 16 bits. */
void pcm_to_i2s32(const int16_t *in, int32_t *out, size_t n);
