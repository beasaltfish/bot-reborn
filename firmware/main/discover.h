// Finding the brain on the local network (mDNS), for a body whose `url` is
// empty. The brain advertises _beasaltfish._tcp (server/discovery.js).

#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/* One lookup, at most timeout_ms. True with url_out = ws://<ipv4>:<port>/body
   for the first brain that answered; false when none did. Needs Wi-Fi up. */
bool discover_brain(char *url_out, size_t cap, uint32_t timeout_ms);
