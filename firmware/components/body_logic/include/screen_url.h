// The screen's address, from the body's. A body is configured with one URL
// (the brain's /body) and a body with a screen opens a second socket to the
// same host and port — so nothing new has to be typed on the serial console.

#pragma once
#include <stdbool.h>
#include <stddef.h>

/* ws://h:8787/body → ws://h:8787/screen, into out. False if body_url does not
   end in /body or the result does not fit in cap (the terminator included). */
bool screen_url_from_body(const char *body_url, char *out, size_t cap);
