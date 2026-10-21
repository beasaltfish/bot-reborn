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
  const char *reasons[] = {"token", "protocol", "unconfigured", "origin", "anything new"};
  for (int i = 0; i < 5; i++) {
    retry_t r = {0};
    retry_rejected(&r, reasons[i], 1000);
    CHECK(r.finished);
  }
}

/* busy is usually the brain still holding the connection a Wi-Fi blip broke:
   it lets go within about a second, so a body waits it out instead of dying. */
static void busy_is_retried_for_fifteen_seconds(void) {
  retry_t r = {0};
  retry_rejected(&r, "busy", 1000);
  CHECK(!r.finished);
  retry_rejected(&r, "busy", 1000 + 14999);
  CHECK(!r.finished);
  retry_rejected(&r, "busy", 1000 + 15000);
  CHECK(r.finished);
}

static void a_welcome_starts_the_busy_clock_over(void) {
  retry_t r = {0};
  retry_rejected(&r, "busy", 0);
  retry_welcomed(&r);
  retry_rejected(&r, "busy", 20000);   /* a new run of busy, not 20 s of one */
  CHECK(!r.finished);
}

static void busy_then_a_final_reason_is_final(void) {
  retry_t r = {0};
  retry_rejected(&r, "busy", 0);
  retry_rejected(&r, "token", 500);
  CHECK(r.finished);
}

static void busy_is_right_across_a_clock_wrap(void) {
  retry_t r = {0};
  retry_rejected(&r, "busy", 0xFFFFF000u);
  retry_rejected(&r, "busy", 0x00001000u);   /* 8 s later */
  CHECK(!r.finished);
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
  busy_is_retried_for_fifteen_seconds();
  a_welcome_starts_the_busy_clock_over();
  busy_then_a_final_reason_is_final();
  busy_is_right_across_a_clock_wrap();
  the_watchdog_bites_after_a_silent_second();
  the_watchdog_is_right_across_a_clock_wrap();
  CHECK_DONE();
}
