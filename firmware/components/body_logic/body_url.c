#include <stdio.h>
#include "body_url.h"

int body_url_build(char *out, size_t cap, const char *host, uint16_t port) {
  if (cap == 0) return -1;
  int n = snprintf(out, cap, "ws://%s:%u/body", host, (unsigned)port);
  if (n < 0 || (size_t)n >= cap) { out[0] = '\0'; return -1; }
  return n;
}

int ipv4_pick(const uint32_t *addrs, size_t n, uint32_t own, uint32_t mask) {
  for (size_t i = 0; i < n; i++) if ((addrs[i] & mask) == (own & mask)) return (int)i;
  return n ? 0 : -1;
}
