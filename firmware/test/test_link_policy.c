#include "check.h"
#include "link_policy.h"

static void retries_back_off_like_the_phone(void) {
  retry_t r = {0};
  const uint32_t want[] = {500, 1000, 2000, 5000, 5000, 5000};
  for (int i = 0; i < 6; i++) CHECK_EQ_INT(retry_next_ms(&r), want[i]);
  retry_welcomed(&r);
  CHECK_EQ_INT(retry_next_ms(&r), 500);
  CHECK(!r.finished);
}

static void a_reject_is_final(void) {
  retry_t r = {0};
  retry_rejected(&r);
  CHECK(r.finished);
}

static void the_watchdog_bites_after_a_silent_second(void) {
  dog_t d = {0};
  CHECK(!dog_expired(&d, 5000));             /* not started: never */
  dog_start(&d, 1000);
  CHECK(!dog_expired(&d, 2000));
  CHECK(dog_expired(&d, 2001));
  dog_heard(&d, 1900);
  CHECK(!dog_expired(&d, 2900));
  CHECK(dog_expired(&d, 2901));
  dog_stop(&d);
  CHECK(!dog_expired(&d, 99999));
}

static void the_watchdog_is_right_across_a_clock_wrap(void) {
  dog_t d = {0};
  dog_start(&d, 0xFFFFFE00u);
  CHECK(!dog_expired(&d, 0x00000100u));      /* 768 ms later */
  CHECK(dog_expired(&d, 0x00000300u));       /* 1280 ms later */
}

int main(void) {
  retries_back_off_like_the_phone();
  a_reject_is_final();
  the_watchdog_bites_after_a_silent_second();
  the_watchdog_is_right_across_a_clock_wrap();
  CHECK_DONE();
}
