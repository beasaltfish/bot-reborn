#include "check.h"
#include "frameslot.h"

/* Two frames land before the screen looks: it gets the newer, and the older
   is counted as dropped, never shown late. */
static void the_newest_frame_wins(void) {
  frameslot_t s;
  frameslot_init(&s);
  int a = frameslot_begin_write(&s);
  frameslot_commit(&s, 100);
  int b = frameslot_begin_write(&s);
  frameslot_commit(&s, 200);
  size_t len = 0;
  int got = frameslot_take(&s, &len);
  CHECK_EQ_INT(got, b);
  CHECK_EQ_INT(len, 200);
  CHECK_EQ_INT(s.dropped, 1);
  (void)a;
}

static void nothing_ready_takes_nothing_and_a_frame_is_taken_once(void) {
  frameslot_t s;
  frameslot_init(&s);
  size_t len = 0;
  CHECK_EQ_INT(frameslot_take(&s, &len), -1);
  frameslot_begin_write(&s);
  frameslot_commit(&s, 50);
  CHECK(frameslot_take(&s, &len) >= 0);
  frameslot_release(&s);
  CHECK_EQ_INT(frameslot_take(&s, &len), -1);
  CHECK_EQ_INT(s.dropped, 0);
}

/* The decoder holds one buffer for a long time while frames keep arriving:
   the writer never gets that buffer, and the held frame is not torn. */
static void a_frame_being_read_is_never_written_over(void) {
  frameslot_t s;
  frameslot_init(&s);
  frameslot_begin_write(&s);
  frameslot_commit(&s, 10);
  size_t len = 0;
  int reading = frameslot_take(&s, &len);
  for (int i = 0; i < 20; i++) {
    int w = frameslot_begin_write(&s);
    CHECK(w != reading);
    frameslot_commit(&s, 20 + (size_t)i);
  }
  /* The held frame is still the one being read, and the newest is waiting. */
  CHECK_EQ_INT(s.reading, reading);
  int next = frameslot_take(&s, &len);
  CHECK(next >= 0 && next != reading);
  CHECK_EQ_INT(len, 39);
  CHECK_EQ_INT(s.dropped, 19);
}

/* A frame that never finished (the socket dropped halfway) is written over by
   the next one: it never became ready. */
static void a_half_written_frame_is_forgotten(void) {
  frameslot_t s;
  frameslot_init(&s);
  int first = frameslot_begin_write(&s);
  int again = frameslot_begin_write(&s);
  CHECK_EQ_INT(first, again);
  size_t len = 0;
  CHECK_EQ_INT(frameslot_take(&s, &len), -1);
}

int main(void) {
  the_newest_frame_wins();
  nothing_ready_takes_nothing_and_a_frame_is_taken_once();
  a_frame_being_read_is_never_written_over();
  a_half_written_frame_is_forgotten();
  CHECK_DONE();
}
