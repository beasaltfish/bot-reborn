#include "check.h"
#include "screen_url.h"

int main(void) {
  char out[64];

  /* The one address a body is given is the body's; the screen is the same
     host and port with a different path. */
  CHECK(screen_url_from_body("ws://192.168.3.79:8787/body", out, sizeof out));
  CHECK_EQ_STR(out, "ws://192.168.3.79:8787/screen");

  CHECK(screen_url_from_body("wss://x/body", out, sizeof out));
  CHECK_EQ_STR(out, "wss://x/screen");

  /* Anything that is not exactly a /body URL is not ours to rewrite. */
  CHECK(!screen_url_from_body("ws://x/bodyx", out, sizeof out));
  CHECK(!screen_url_from_body("ws://x/screen", out, sizeof out));
  CHECK(!screen_url_from_body("ws://x/", out, sizeof out));
  CHECK(!screen_url_from_body("", out, sizeof out));

  /* "ws://x/screen" is 13 bytes plus the terminator; 13 is one short. */
  char tight[13];
  CHECK(!screen_url_from_body("ws://x/body", tight, sizeof tight));
  char exact[14];
  CHECK(screen_url_from_body("ws://x/body", exact, sizeof exact));
  CHECK_EQ_STR(exact, "ws://x/screen");

  CHECK_DONE();
}
