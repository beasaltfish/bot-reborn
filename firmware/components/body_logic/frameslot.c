#include "frameslot.h"

void frameslot_init(frameslot_t *s) {
  s->writing = s->ready = s->reading = -1;
  s->ready_len = 0;
  s->dropped = 0;
}

int frameslot_begin_write(frameslot_t *s) {
  if (s->writing >= 0) return s->writing;
  for (int i = 0; i < FRAMESLOT_BUFFERS; i++) {
    if (i != s->ready && i != s->reading) { s->writing = i; return i; }
  }
  return -1;   /* unreachable: three buffers, at most two of them held */
}

void frameslot_commit(frameslot_t *s, size_t len) {
  if (s->writing < 0) return;
  if (s->ready >= 0) s->dropped++;
  s->ready = s->writing;
  s->ready_len = len;
  s->writing = -1;
}

int frameslot_take(frameslot_t *s, size_t *len) {
  if (s->ready < 0) return -1;
  s->reading = s->ready;
  s->ready = -1;
  *len = s->ready_len;
  return s->reading;
}

void frameslot_release(frameslot_t *s) { s->reading = -1; }
