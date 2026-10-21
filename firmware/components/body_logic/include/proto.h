// The body's end of core/protocol.js. Only what a body reads from the brain
// and the few lines it writes back; the rules are protocol.js's, pinned by
// the shared vectors in firmware/test/brain-messages.json.

#pragma once
#include <stdbool.h>
#include <stddef.h>

#define PROTO_VERSION 2
#define PROTO_MAX_MOVE_MS 1000

typedef enum { DRIVE_STOP, DRIVE_FORWARD, DRIVE_BACKWARD } drive_t;
typedef enum { STEER_STRAIGHT, STEER_LEFT, STEER_RIGHT } steer_t;
typedef enum { MSG_NONE, MSG_WELCOME, MSG_REJECT, MSG_MOVE, MSG_STOP,
               MSG_HUSH, MSG_STATE, MSG_PING, MSG_PONG } msg_type_t;

typedef struct {
  msg_type_t type;
  drive_t drive; steer_t steer; int ms;   /* MSG_MOVE */
  char text[24];                          /* welcome's name, reject's reason, state's state; cut short */
} brain_msg_t;

/* MSG_NONE for anything that is not a well-formed message from the brain. */
brain_msg_t proto_parse(const char *json, size_t len);

/* {"type":"hello","protocol":2,"token":"…"}; its length, or -1 if it does not fit. */
int proto_hello(char *buf, size_t cap, const char *token);

extern const char PROTO_PING[];
extern const char PROTO_PONG[];

/* A text frame can arrive in parts (esp_websocket_client's payload_offset /
   payload_len). Feed each part; true once the whole frame is in buf. A part at
   offset 0 starts over; a frame over 511 bytes is dropped (false). */
typedef struct { char buf[512]; size_t len; bool overflow; } textasm_t;
bool textasm_feed(textasm_t *t, const char *data, size_t len, size_t offset, size_t total);
