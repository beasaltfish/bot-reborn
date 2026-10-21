#include <string.h>
#include "led_table.h"

static const led_pattern_t PATTERNS[] = {
  [LED_NO_WIFI]    = {100, 100},
  [LED_CONNECTING] = {100, 900},
  [LED_REJECTED]   = {1000, 1000},
  [LED_SLEEPING]   = {50, 2950},
  [LED_LISTENING]  = {1, 0},
  [LED_CAPTURING]  = {50, 50},
  [LED_THINKING]   = {250, 250},
  [LED_SPEAKING]   = {1, 0},
};

static const struct { const char *name; led_mode_t mode; } STATES[] = {
  {"SLEEPING", LED_SLEEPING}, {"LISTENING", LED_LISTENING}, {"CAPTURING", LED_CAPTURING},
  {"THINKING", LED_THINKING}, {"SPEAKING", LED_SPEAKING},
};

led_pattern_t led_pattern(led_mode_t m) { return PATTERNS[m]; }

bool led_mode_for_state(const char *state, led_mode_t *out) {
  for (size_t i = 0; i < sizeof STATES / sizeof STATES[0]; i++) {
    if (strcmp(state, STATES[i].name) == 0) { *out = STATES[i].mode; return true; }
  }
  return false;
}
