// What this body remembers across a reboot: where the brain is, who it is,
// how to reach the Wi-Fi, and which wire is left. NVS namespace "body".

#pragma once
#include "esp_err.h"
#include "motion.h"

typedef struct {
  char ssid[33], pass[65], token[33], url[128];
  calib_t calib;
} settings_t;

/* Never fails: what was never stored stays empty (the url: DEFAULT_BODY_URL). */
void settings_load(settings_t *s);
esp_err_t settings_save(const settings_t *s);
