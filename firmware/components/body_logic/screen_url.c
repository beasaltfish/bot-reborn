#include "screen_url.h"

#include <stdio.h>
#include <string.h>

#define BODY_SUFFIX "/body"
#define SCREEN_SUFFIX "/screen"

bool screen_url_from_body(const char *body_url, char *out, size_t cap) {
  if (body_url == NULL || out == NULL || cap == 0) return false;
  size_t n = strlen(body_url);
  size_t suffix = sizeof BODY_SUFFIX - 1;
  if (n < suffix || strcmp(body_url + n - suffix, BODY_SUFFIX) != 0) return false;
  int written = snprintf(out, cap, "%.*s%s", (int)(n - suffix), body_url, SCREEN_SUFFIX);
  return written > 0 && (size_t)written < cap;
}
