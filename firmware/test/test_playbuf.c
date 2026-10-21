#include <stdint.h>
#include "check.h"
#include "playbuf.h"

static playbuf_t pb;   /* 32 kB: not on the stack */

static void bytes_are_little_endian_samples(void) {
  playbuf_clear(&pb);
  const uint8_t b[] = {0x34, 0x12, 0xFF, 0xFF};
  CHECK_EQ_INT(playbuf_write_bytes(&pb, b, 4), 2);
  int16_t out[2];
  CHECK_EQ_INT(playbuf_read(&pb, out, 2), 2);
  CHECK_EQ_INT(out[0], 0x1234);
  CHECK_EQ_INT(out[1], -1);
}

static void a_sample_split_across_frames_is_joined(void) {
  playbuf_clear(&pb);
  const uint8_t lo = 0x34, hi = 0x12;
  CHECK_EQ_INT(playbuf_write_bytes(&pb, &lo, 1), 0);
  CHECK_EQ_INT(playbuf_write_bytes(&pb, &hi, 1), 1);
  int16_t s;
  CHECK_EQ_INT(playbuf_read(&pb, &s, 1), 1);
  CHECK_EQ_INT(s, 0x1234);
}

static void a_short_read_is_padded_with_silence(void) {
  playbuf_clear(&pb);
  const uint8_t b[] = {0x01, 0x00};
  playbuf_write_bytes(&pb, b, 2);
  int16_t out[3] = {7, 7, 7};
  CHECK_EQ_INT(playbuf_read(&pb, out, 3), 1);
  CHECK_EQ_INT(out[0], 1);
  CHECK_EQ_INT(out[1], 0);
  CHECK_EQ_INT(out[2], 0);
}

static void a_full_buffer_drops_what_comes_next(void) {
  playbuf_clear(&pb);
  static uint8_t second[PLAYBUF_SAMPLES * 2];
  CHECK_EQ_INT(playbuf_write_bytes(&pb, second, sizeof second), PLAYBUF_SAMPLES);
  const uint8_t more[] = {1, 0};
  CHECK_EQ_INT(playbuf_write_bytes(&pb, more, 2), 0);
}

static void order_holds_across_the_wrap(void) {
  playbuf_clear(&pb);
  static uint8_t chunk[(PLAYBUF_SAMPLES - 100) * 2];
  static int16_t sink[PLAYBUF_SAMPLES];
  playbuf_write_bytes(&pb, chunk, sizeof chunk);
  playbuf_read(&pb, sink, PLAYBUF_SAMPLES - 100);     /* head now 100 short of the end */
  uint8_t ramp[400];
  for (int i = 0; i < 200; i++) { ramp[2 * i] = (uint8_t)i; ramp[2 * i + 1] = 0; }
  CHECK_EQ_INT(playbuf_write_bytes(&pb, ramp, sizeof ramp), 200);
  int16_t out[200];
  CHECK_EQ_INT(playbuf_read(&pb, out, 200), 200);
  for (int i = 0; i < 200; i++) CHECK_EQ_INT(out[i], i);
}

static void hush_drops_the_half_sample_too(void) {
  playbuf_clear(&pb);
  const uint8_t lo = 0x34;
  playbuf_write_bytes(&pb, &lo, 1);
  playbuf_clear(&pb);
  const uint8_t b[] = {0x02, 0x00};
  playbuf_write_bytes(&pb, b, 2);
  int16_t s;
  playbuf_read(&pb, &s, 1);
  CHECK_EQ_INT(s, 2);
}

int main(void) {
  bytes_are_little_endian_samples();
  a_sample_split_across_frames_is_joined();
  a_short_read_is_padded_with_silence();
  a_full_buffer_drops_what_comes_next();
  order_holds_across_the_wrap();
  hush_drops_the_half_sample_too();
  CHECK_DONE();
}
