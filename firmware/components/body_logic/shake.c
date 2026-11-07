#include "shake.h"

enum { IDLE, MOVING, SPENT };

void shake_init(shake_t *s) { s->state = IDLE; s->start = s->last = 0; }

bool shake_feed(shake_t *s, float level, uint32_t now) {
  bool moving = level >= SHAKE_MOVING;
  if (s->state == SPENT) {
    if (!moving) s->state = IDLE;   /* one still reading ends the shake that fired */
    return false;
  }
  if (s->state == IDLE) {
    if (moving) { s->state = MOVING; s->start = now; s->last = now; }
    return false;
  }
  if (moving) {
    s->last = now;
    if (now - s->start >= SHAKE_CAP_MS) { s->state = SPENT; return true; }
    return false;
  }
  bool armed = s->last - s->start >= SHAKE_ARM_MS;
  uint32_t gap = now - s->last;
  if (!armed && gap >= SHAKE_GAP_MS) { s->state = IDLE; return false; }
  if (armed && gap >= SHAKE_STILL_MS) { s->state = IDLE; return true; }
  return false;
}
