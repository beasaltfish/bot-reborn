#include <stdint.h>
#include "check.h"
#include "pcm.h"

static void the_top_sixteen_bits_are_the_sample(void) {
  const int32_t in[] = {0x12345600, -0x12345600};
  int16_t out[2];
  pcm_from_i2s32(in, out, 2, 16);
  CHECK_EQ_INT(out[0], 0x1234);
  CHECK_EQ_INT(out[1], -0x1235);   /* arithmetic shift rounds toward −∞ */
}

static void a_smaller_shift_is_gain_and_saturates(void) {
  const int32_t in[] = {0x00100000, 0x7FFFFF00, (int32_t)0x80000000};
  int16_t out[3];
  pcm_from_i2s32(in, out, 3, 14);
  CHECK_EQ_INT(out[0], 0x40);
  CHECK_EQ_INT(out[1], 32767);
  CHECK_EQ_INT(out[2], -32768);
}

static void a_sample_goes_to_the_top_of_the_slot(void) {
  const int16_t in[] = {-1, 0x1234};
  int32_t out[2];
  pcm_to_i2s32(in, out, 2);
  CHECK_EQ_INT((uint32_t)out[0], 0xFFFF0000u);
  CHECK_EQ_INT((uint32_t)out[1], 0x12340000u);
}

int main(void) {
  the_top_sixteen_bits_are_the_sample();
  a_smaller_shift_is_gain_and_saturates();
  a_sample_goes_to_the_top_of_the_slot();
  CHECK_DONE();
}
