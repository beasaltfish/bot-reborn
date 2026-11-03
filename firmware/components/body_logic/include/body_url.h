// The brain's address as the body dials it, from what mDNS found.

#pragma once
#include <stddef.h>
#include <stdint.h>

/* ws://<host>:<port>/body into out. Returns its length, or -1 when it does
   not fit in cap (the terminator included), in which case out[0] is '\0'. */
int body_url_build(char *out, size_t cap, const char *host, uint16_t port);
