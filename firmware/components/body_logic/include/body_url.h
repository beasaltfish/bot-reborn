// The brain's address as the body dials it, from what mDNS found.

#pragma once
#include <stddef.h>
#include <stdint.h>

/* ws://<host>:<port>/body into out. Returns its length, or -1 when it does
   not fit in cap (the terminator included), in which case out[0] is '\0'. */
int body_url_build(char *out, size_t cap, const char *host, uint16_t port);

/* Which of the addresses a computer answered with to dial: the first on the
   board's own subnet (own and mask in the same byte order as addrs), else the
   first, else -1 for none. A computer also answers with its virtual-machine
   and VPN addresses, which a board on the Wi-Fi cannot reach. */
int ipv4_pick(const uint32_t *addrs, size_t n, uint32_t own, uint32_t mask);
