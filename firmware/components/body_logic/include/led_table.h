// How the one status light shows what the body is doing. A table to edit,
// not a design: the server/body split spec leaves showing a state to the body.

#pragma once
#include <stdbool.h>
#include <stdint.h>

typedef enum { LED_NO_WIFI, LED_CONNECTING, LED_REJECTED, LED_SLEEPING,
               LED_LISTENING, LED_CAPTURING, LED_THINKING, LED_SPEAKING } led_mode_t;

typedef struct { uint16_t on_ms, off_ms; } led_pattern_t;   /* off_ms == 0: steady */

led_pattern_t led_pattern(led_mode_t m);
/* The brain's state name; false for one this table does not know. */
bool led_mode_for_state(const char *state, led_mode_t *out);
