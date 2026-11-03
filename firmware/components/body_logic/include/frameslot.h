// Where the screen's frames land: three buffers, the newest complete frame
// wins (pet screen spec §5: frames are dropped, never queued). The socket
// task writes into one buffer, the draw task reads another, and the third is
// the newest finished frame waiting its turn — so neither side ever waits for
// the other, and a frame being drawn is never overwritten.
//
// No allocation and no locking in here: the buffers are the caller's, and the
// caller serialises the calls (a mutex or a critical section around each).

#pragma once
#include <stddef.h>

#define FRAMESLOT_BUFFERS 3

typedef struct {
  int writing;       /* the buffer being filled, or -1 */
  int ready;         /* the newest finished frame nobody has taken, or -1 */
  int reading;       /* the buffer the reader holds, or -1 */
  size_t ready_len;
  unsigned dropped;  /* finished frames replaced before anyone took them */
} frameslot_t;

void frameslot_init(frameslot_t *s);

/* The index (0..2) of a buffer to fill: never the one being read, never the
   one waiting. Called again before a commit, it hands back the same index
   (the half-written frame is forgotten). */
int frameslot_begin_write(frameslot_t *s);

/* The frame in the buffer begin_write gave is finished and `len` bytes long.
   It becomes the newest; an older one nobody took is counted as dropped. */
void frameslot_commit(frameslot_t *s, size_t len);

/* The newest finished frame: its buffer index, with its length in *len, and it
   is now being read. -1 when nothing new has finished. */
int frameslot_take(frameslot_t *s, size_t *len);

/* The reader is done with the buffer it took. */
void frameslot_release(frameslot_t *s);
