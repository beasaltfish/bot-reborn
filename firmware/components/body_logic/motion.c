#include "motion.h"

void motion_move(motion_t *m, drive_t d, steer_t s, int ms, uint32_t now_ms) {
  if (ms < 1) ms = 1;
  if (ms > PROTO_MAX_MOVE_MS) ms = PROTO_MAX_MOVE_MS;
  m->drive = d;
  m->steer = s;
  m->until_ms = now_ms + (uint32_t)ms;
  m->active = true;
}

void motion_stop(motion_t *m) {
  m->active = false;
}

void motion_now(const motion_t *m, uint32_t now_ms, drive_t *d, steer_t *s) {
  /* The signed difference is right across a wrap, as long as no move is
     longer than 2^31 ms, and none is longer than a second. */
  if (m->active && (int32_t)(m->until_ms - now_ms) > 0) {
    *d = m->drive;
    *s = m->steer;
  } else {
    *d = DRIVE_STOP;
    *s = STEER_STRAIGHT;
  }
}

/* One pair: which of its two pins is high, if either. */
static void pair(bool first, bool second, bool swapped, uint8_t *a, uint8_t *b) {
  *a = swapped ? second : first;
  *b = swapped ? first : second;
}

void motor_levels(drive_t d, steer_t s, calib_t c, uint8_t pins[4]) {
  pair(d == DRIVE_FORWARD, d == DRIVE_BACKWARD, c.drive_swapped, &pins[0], &pins[1]);
  pair(s == STEER_LEFT, s == STEER_RIGHT, c.steer_swapped, &pins[2], &pins[3]);
}
