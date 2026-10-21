// The four motor driver inputs. A 10 ms loop asks body_logic's motion what
// the car should be doing and writes it; every way of losing the brain ends
// in motor_stop.

#pragma once
#include "motion.h"

/* First thing at boot: four outputs, driven low, pulled down. Until this
   runs the pins float — the external pull-downs cover that (spec §4). */
void motor_init(void);
/* Calibration is read every cycle, so `cal drive` takes effect at once. */
void motor_start(const calib_t *c);
void motor_move(drive_t d, steer_t s, int ms);
void motor_stop(void);
