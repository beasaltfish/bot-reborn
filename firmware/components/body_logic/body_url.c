#include <stdio.h>
#include "body_url.h"

int body_url_build(char *out, size_t cap, const char *host, uint16_t port) {
  if (cap == 0) return -1;
  int n = snprintf(out, cap, "ws://%s:%u/body", host, (unsigned)port);
  if (n < 0 || (size_t)n >= cap) { out[0] = '\0'; return -1; }
  return n;
}
