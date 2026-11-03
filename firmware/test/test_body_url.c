#include "check.h"
#include "body_url.h"

int main(void) {
  char out[64];

  /* The address mDNS found, as the body dials it. */
  CHECK_EQ_INT(body_url_build(out, sizeof out, "192.168.3.84", 8787), 27);
  CHECK_EQ_STR(out, "ws://192.168.3.84:8787/body");

  /* 27 bytes plus the terminator is 28; 27 is one short: nothing is written. */
  char tight[27];
  tight[0] = 'x';
  CHECK_EQ_INT(body_url_build(tight, sizeof tight, "192.168.3.84", 8787), -1);
  CHECK_EQ_INT(tight[0], 0);
  char exact[28];
  CHECK_EQ_INT(body_url_build(exact, sizeof exact, "192.168.3.84", 8787), 27);

  CHECK_DONE();
}
