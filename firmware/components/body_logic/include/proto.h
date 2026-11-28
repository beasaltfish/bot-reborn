// The body's end of core/protocol.js. Only what a body reads from the brain
// and the few lines it writes back; the rules are protocol.js's, pinned by
// the shared vectors in firmware/test/brain-messages.json.

#pragma once
#include <stdbool.h>
#include <stddef.h>

#define PROTO_VERSION 2
/* The bridge build speaks 3: it answers `cmd` with one `result`. */
#define PROTO_BRIDGE_VERSION 3
#define PROTO_MAX_MOVE_MS 1000
#define PROTO_MAX_GPIO 48

typedef enum { DRIVE_STOP, DRIVE_FORWARD, DRIVE_BACKWARD } drive_t;
typedef enum { STEER_STRAIGHT, STEER_LEFT, STEER_RIGHT } steer_t;
typedef enum { MSG_NONE, MSG_WELCOME, MSG_REJECT, MSG_MOVE, MSG_STOP,
               MSG_HUSH, MSG_STATE, MSG_PING, MSG_PONG, MSG_CMD } msg_type_t;

typedef struct {
  msg_type_t type;
  drive_t drive; steer_t steer; int ms;   /* MSG_MOVE */
  int cmd_id;                             /* MSG_CMD: 1..255 */
  int cmd_pin;                            /* MSG_CMD: the resource's gpio number */
  int cmd_level;                          /* MSG_CMD pin.write: 0 or 1 */
  int cmd_safe;                           /* MSG_CMD pin.write: the output's safe */
  bool cmd_write;                         /* MSG_CMD: pin.write vs pin.read */
  char text[24];                          /* welcome's name, reject's reason, state's state; cut short */
} brain_msg_t;

/* MSG_NONE for anything that is not a well-formed message from the brain. */
brain_msg_t proto_parse(const char *json, size_t len);

/* {"type":"hello","protocol":2,"token":"…"}; its length, or -1 if it does not fit. */
int proto_hello(char *buf, size_t cap, const char *token);

/* The same hello with an explicit protocol: the bridge build passes 3. */
int proto_hello_version(char *buf, size_t cap, const char *token, int version);

/* The answer to one `cmd`: {"type":"result","id":n,"ok":true,"value":v}.
   A write answers with its level, a read with the sampled bit. Length, or -1. */
int proto_result_value(char *buf, size_t cap, int id, int value);

/* {"type":"result","id":n,"ok":false,"error":"…"}. The phrase is fixed by the
   firmware, so it is copied as is; callers pass no quotes or backslashes. */
int proto_result_error(char *buf, size_t cap, int id, const char *error);

/* The screen socket's hello (server/screen-link.js): the body's, plus the
   panel's size in landscape. Same return rule. */
int proto_hello_screen(char *buf, size_t cap, const char *token, int w, int h);

extern const char PROTO_PING[];
extern const char PROTO_PONG[];

/* The wand was shaken and is still again (core/shake-detector.js). */
extern const char PROTO_SHAKE[];

/* A text frame can arrive in parts (esp_websocket_client's payload_offset /
   payload_len). Feed each part; true once the whole frame is in buf. A part at
   offset 0 starts over; a frame over 511 bytes is dropped (false). */
typedef struct { char buf[512]; size_t len; bool overflow; } textasm_t;
bool textasm_feed(textasm_t *t, const char *data, size_t len, size_t offset, size_t total);
