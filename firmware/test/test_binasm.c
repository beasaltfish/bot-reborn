#include <stdint.h>
#include "check.h"
#include "binasm.h"

int main(void) {
  uint8_t buf[16];
  const uint8_t one[] = { 1, 2 }, two[] = { 3 }, three[] = { 4, 5, 6 };

  /* esp_websocket_client hands a frame over in parts. */
  binasm_t a = { buf, sizeof buf, 0, false };
  CHECK(!binasm_feed(&a, one, 2, 0, 6));
  CHECK_EQ_INT(a.len, 2);
  CHECK(!binasm_feed(&a, two, 1, 2, 6));
  CHECK(binasm_feed(&a, three, 3, 3, 6));
  CHECK_EQ_INT(a.len, 6);
  CHECK_EQ_INT(a.buf[5], 6);
  CHECK(!a.overflow);

  /* A new frame starts on an offset of 0, even mid-frame. */
  CHECK(!binasm_feed(&a, one, 2, 0, 6));
  CHECK_EQ_INT(a.len, 2);

  /* A part arriving out of order drops the frame rather than splicing it. */
  CHECK(!binasm_feed(&a, three, 3, 7, 10));
  CHECK(a.overflow);

  /* Over the caller's buffer: dropped, and it stays dropped for this frame. */
  uint8_t tiny[4];
  binasm_t b = { tiny, sizeof tiny, 0, false };
  CHECK(!binasm_feed(&b, one, 2, 0, 5));
  CHECK(b.overflow);
  CHECK(!binasm_feed(&b, one, 2, 2, 5));
  CHECK_EQ_INT(b.len, 0);

  /* An empty frame is a complete one. */
  binasm_t c = { buf, sizeof buf, 0, false };
  CHECK(binasm_feed(&c, one, 0, 0, 0));
  CHECK_EQ_INT(c.len, 0);

  CHECK_DONE();
}
