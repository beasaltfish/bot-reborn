#include <stdint.h>
#include "check.h"
#include "motion.h"

static drive_t drive_at(const motion_t *m, uint32_t now) {
  drive_t d; steer_t s;
  motion_now(m, now, &d, &s);
  return d;
}

static void a_move_runs_for_its_ms_then_stops(void) {
  motion_t m = {0};
  motion_move(&m, DRIVE_FORWARD, STEER_LEFT, 600, 1000);
  drive_t d; steer_t s;
  motion_now(&m, 1599, &d, &s);
  CHECK_EQ_INT(d, DRIVE_FORWARD);
  CHECK_EQ_INT(s, STEER_LEFT);
  motion_now(&m, 1600, &d, &s);
  CHECK_EQ_INT(d, DRIVE_STOP);
  CHECK_EQ_INT(s, STEER_STRAIGHT);
}

static void a_new_move_replaces_the_one_running(void) {
  motion_t m = {0};
  motion_move(&m, DRIVE_FORWARD, STEER_STRAIGHT, 600, 0);
  motion_move(&m, DRIVE_BACKWARD, STEER_RIGHT, 600, 400);
  drive_t d; steer_t s;
  motion_now(&m, 999, &d, &s);
  CHECK_EQ_INT(d, DRIVE_BACKWARD);
  CHECK_EQ_INT(s, STEER_RIGHT);
  CHECK_EQ_INT(drive_at(&m, 1000), DRIVE_STOP);   /* 400 + 600, not 600 + 600 */
}

static void ms_is_clamped_to_one_through_a_thousand(void) {
  motion_t m = {0};
  motion_move(&m, DRIVE_FORWARD, STEER_STRAIGHT, 0, 100);
  CHECK_EQ_INT(drive_at(&m, 100), DRIVE_FORWARD);
  CHECK_EQ_INT(drive_at(&m, 101), DRIVE_STOP);
  motion_move(&m, DRIVE_FORWARD, STEER_STRAIGHT, 5000, 100);
  CHECK_EQ_INT(drive_at(&m, 1099), DRIVE_FORWARD);
  CHECK_EQ_INT(drive_at(&m, 1100), DRIVE_STOP);
}

static void the_clock_wrapping_does_not_strand_the_car(void) {
  motion_t m = {0};
  motion_move(&m, DRIVE_FORWARD, STEER_STRAIGHT, 600, 0xFFFFFF00u);
  CHECK_EQ_INT(drive_at(&m, 0x00000100u), DRIVE_FORWARD);           /* 512 ms in */
  CHECK_EQ_INT(drive_at(&m, 0xFFFFFF00u + 600u), DRIVE_STOP);
  CHECK_EQ_INT(drive_at(&m, 0x00010000u), DRIVE_STOP);
}

static void stop_stops_at_once(void) {
  motion_t m = {0};
  motion_move(&m, DRIVE_FORWARD, STEER_LEFT, 1000, 0);
  motion_stop(&m);
  CHECK_EQ_INT(drive_at(&m, 1), DRIVE_STOP);
}

static void nothing_moves_before_the_first_move(void) {
  motion_t m = {0};
  CHECK_EQ_INT(drive_at(&m, 0), DRIVE_STOP);
  CHECK_EQ_INT(drive_at(&m, 0x80000000u), DRIVE_STOP);
}

static void levels(drive_t d, steer_t s, calib_t c, int a, int b, int x, int y) {
  uint8_t p[4] = {9, 9, 9, 9};
  motor_levels(d, s, c, p);
  CHECK_EQ_INT(p[0], a); CHECK_EQ_INT(p[1], b); CHECK_EQ_INT(p[2], x); CHECK_EQ_INT(p[3], y);
}

static void pins_follow_the_table_and_the_calibration(void) {
  for (int ds = 0; ds < 2; ds++) for (int ss = 0; ss < 2; ss++) {
    calib_t c = { .drive_swapped = ds, .steer_swapped = ss };
    /* forward/left = A high B low; backward/right = A low B high; swapped trades A and B. */
    int fa = ds ? 0 : 1, fb = ds ? 1 : 0;
    int la = ss ? 0 : 1, lb = ss ? 1 : 0;
    levels(DRIVE_FORWARD, STEER_LEFT, c, fa, fb, la, lb);
    levels(DRIVE_FORWARD, STEER_RIGHT, c, fa, fb, lb, la);
    levels(DRIVE_FORWARD, STEER_STRAIGHT, c, fa, fb, 0, 0);
    levels(DRIVE_BACKWARD, STEER_LEFT, c, fb, fa, la, lb);
    levels(DRIVE_BACKWARD, STEER_RIGHT, c, fb, fa, lb, la);
    levels(DRIVE_BACKWARD, STEER_STRAIGHT, c, fb, fa, 0, 0);
    levels(DRIVE_STOP, STEER_LEFT, c, 0, 0, la, lb);
    levels(DRIVE_STOP, STEER_RIGHT, c, 0, 0, lb, la);
    levels(DRIVE_STOP, STEER_STRAIGHT, c, 0, 0, 0, 0);
  }
}

static void no_pair_is_ever_both_high(void) {
  for (int d = DRIVE_STOP; d <= DRIVE_BACKWARD; d++)
    for (int s = STEER_STRAIGHT; s <= STEER_RIGHT; s++)
      for (int c = 0; c < 4; c++) {
        uint8_t p[4];
        motor_levels((drive_t)d, (steer_t)s, (calib_t){ c & 1, c >> 1 }, p);
        CHECK(!(p[0] && p[1]));
        CHECK(!(p[2] && p[3]));
      }
}

int main(void) {
  a_move_runs_for_its_ms_then_stops();
  a_new_move_replaces_the_one_running();
  ms_is_clamped_to_one_through_a_thousand();
  the_clock_wrapping_does_not_strand_the_car();
  stop_stops_at_once();
  nothing_moves_before_the_first_move();
  pins_follow_the_table_and_the_calibration();
  no_pair_is_ever_both_high();
  CHECK_DONE();
}
