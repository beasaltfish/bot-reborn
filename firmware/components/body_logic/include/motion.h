// What the car should be doing, and which pins say so. A `move` REPLACES the
// one in progress and ends by itself (core/protocol.js); nothing here touches
// a pin, so a 10 ms loop on the chip asks motion_now and writes what
// motor_levels returns.

#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "proto.h"

/* Which wire is "left" and which is "forward" is this car's, not the brain's. */
typedef struct { bool drive_swapped, steer_swapped; } calib_t;

typedef struct { drive_t drive; steer_t steer; uint32_t until_ms; bool active; } motion_t;

/* Replaces whatever is running; ms clamped to [1, PROTO_MAX_MOVE_MS]. */
void motion_move(motion_t *m, drive_t d, steer_t s, int ms, uint32_t now_ms);
void motion_stop(motion_t *m);
/* Stopped and straight once the move has run out; right across a clock wrap. */
void motion_now(const motion_t *m, uint32_t now_ms, drive_t *d, steer_t *s);

/* pins: drive A, drive B, steer A, steer B. forward/left = A high B low,
   backward/right = A low B high, stop/straight = both low; a swapped pair
   trades A and B. One pair is never both high: that shorts its H-bridge. */
void motor_levels(drive_t d, steer_t s, calib_t c, uint8_t pins[4]);
