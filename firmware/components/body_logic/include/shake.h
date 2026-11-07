// When has the wand been shaken? The same rule as core/shake-detector.js, held
// to the same cases (firmware/test/shake-cases.json): change them together.

#pragma once
#include <stdbool.h>
#include <stdint.h>

#define SHAKE_MOVING   0.15f  /* a level at or above this is movement */
#define SHAKE_ARM_MS   500    /* movement this long makes a shake */
#define SHAKE_GAP_MS   150    /* before that, a pause this long starts over */
#define SHAKE_STILL_MS 800    /* still this long after an armed shake ends it */
#define SHAKE_CAP_MS   6000   /* a hand that never stops ends it anyway */

typedef struct { int state; uint32_t start, last; } shake_t;

void shake_init(shake_t *s);

/* level is 0 to 1. True once, on the sample where a shake has finished. */
bool shake_feed(shake_t *s, float level, uint32_t now_ms);
