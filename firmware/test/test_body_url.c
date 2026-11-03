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

  /* A computer answers with every address it has: virtual-machine and VPN
     networks included. The one on the board's own subnet is the one that works. */
  uint32_t mask = 0x00FFFFFFu;   /* 255.255.255.0 in the same byte order as the addresses */
  uint32_t own = 0x5403A8C0u;    /* 192.168.3.84 as lwIP stores it: first octet in the low byte */
  uint32_t mac[] = { 0x0303A8C0u /* 192.168.3.3 */, 0x018BA8C0u /* 192.168.139.1 */ };
  uint32_t vm_first[] = { 0x038BA8C0u /* 192.168.139.3 */, 0x0303A8C0u /* 192.168.3.3 */ };
  CHECK_EQ_INT(ipv4_pick(mac, 2, own, mask), 0);
  CHECK_EQ_INT(ipv4_pick(vm_first, 2, own, mask), 1);
  uint32_t none[] = { 0x038BA8C0u, 0x0161A8C0u };
  CHECK_EQ_INT(ipv4_pick(none, 2, own, mask), 0);   /* nothing on the subnet: the first, it may still route */
  CHECK_EQ_INT(ipv4_pick(none, 0, own, mask), -1);

  CHECK_DONE();
}
