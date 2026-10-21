// The USB serial console: one line at a time through body_logic's cmd_parse,
// acted on here. Wi-Fi, token and url take effect after `reboot`; calibration
// at once.

#pragma once
#include "settings.h"

void console_start(settings_t *s);
