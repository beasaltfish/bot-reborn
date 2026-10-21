// Wi-Fi as a station: connects, and keeps reconnecting by itself.

#pragma once
#include <stdbool.h>
#include "freertos/FreeRTOS.h"
#include "settings.h"

void net_start(const settings_t *s);
/* True once the station has an address; waits up to `ticks` for one. */
bool net_wait_up(TickType_t ticks);
