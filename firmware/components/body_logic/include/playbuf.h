// What the speaker has yet to play. The brain sends only 300 ms ahead
// (server/body/mouth.js), so a second of room is plenty and needs no PSRAM.
// Frames are bytes and may split a sample in two; the odd byte waits here
// for its other half. Not thread-safe: the caller guards it.

#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define PLAYBUF_SAMPLES 16000

typedef struct { int16_t s[PLAYBUF_SAMPLES]; size_t head, count; uint8_t odd; bool has_odd; } playbuf_t;

void playbuf_clear(playbuf_t *p);   /* hush: everything, the half sample too */
/* Little-endian bytes in; when full, what comes next is dropped. Samples written. */
size_t playbuf_write_bytes(playbuf_t *p, const uint8_t *bytes, size_t n);
/* n samples out, silence where there are none; how many were real. */
size_t playbuf_read(playbuf_t *p, int16_t *out, size_t n);
