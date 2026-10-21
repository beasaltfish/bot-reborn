#include <stdio.h>
#include <string.h>
#include <cJSON.h>
#include "proto.h"

const char PROTO_PING[] = "{\"type\":\"ping\"}";
const char PROTO_PONG[] = "{\"type\":\"pong\"}";

static const char *string_of(const cJSON *obj, const char *key) {
  const cJSON *v = cJSON_GetObjectItemCaseSensitive(obj, key);
  return cJSON_IsString(v) ? v->valuestring : NULL;
}

static void copy_text(brain_msg_t *m, const char *s) {
  strncpy(m->text, s, sizeof m->text - 1);
  m->text[sizeof m->text - 1] = '\0';
}

/* protocol.js: Number.isInteger(m.ms) && 1 <= ms <= MAX_MOVE_MS */
static bool read_move(const cJSON *j, brain_msg_t *m) {
  const char *drive = string_of(j, "drive");
  const char *steer = string_of(j, "steer");
  const cJSON *ms = cJSON_GetObjectItemCaseSensitive(j, "ms");
  if (!drive || !steer || !cJSON_IsNumber(ms)) return false;
  double v = ms->valuedouble;
  if (v != (double)(int)v || v < 1 || v > PROTO_MAX_MOVE_MS) return false;

  if (strcmp(drive, "forward") == 0) m->drive = DRIVE_FORWARD;
  else if (strcmp(drive, "backward") == 0) m->drive = DRIVE_BACKWARD;
  else return false;

  if (strcmp(steer, "left") == 0) m->steer = STEER_LEFT;
  else if (strcmp(steer, "right") == 0) m->steer = STEER_RIGHT;
  else if (strcmp(steer, "straight") == 0) m->steer = STEER_STRAIGHT;
  else return false;

  m->ms = (int)v;
  return true;
}

brain_msg_t proto_parse(const char *json, size_t len) {
  brain_msg_t m = {0};
  cJSON *j = cJSON_ParseWithLength(json, len);
  if (!cJSON_IsObject(j)) goto done;
  const char *type = string_of(j, "type");
  if (!type) goto done;

  if (strcmp(type, "welcome") == 0) {
    const char *name = string_of(j, "name");
    copy_text(&m, name ? name : "");
    m.type = MSG_WELCOME;
  } else if (strcmp(type, "reject") == 0) {
    const char *reason = string_of(j, "reason");
    if (reason) { copy_text(&m, reason); m.type = MSG_REJECT; }
  } else if (strcmp(type, "move") == 0) {
    if (read_move(j, &m)) m.type = MSG_MOVE;
  } else if (strcmp(type, "state") == 0) {
    const char *state = string_of(j, "state");
    if (state) { copy_text(&m, state); m.type = MSG_STATE; }
  } else if (strcmp(type, "stop") == 0) {
    m.type = MSG_STOP;
  } else if (strcmp(type, "hush") == 0) {
    m.type = MSG_HUSH;
  } else if (strcmp(type, "ping") == 0) {
    m.type = MSG_PING;
  } else if (strcmp(type, "pong") == 0) {
    m.type = MSG_PONG;
  }
done:
  cJSON_Delete(j);
  return m;
}

int proto_hello(char *buf, size_t cap, const char *token) {
  int n = snprintf(buf, cap, "{\"type\":\"hello\",\"protocol\":%d,\"token\":\"%s\"}", PROTO_VERSION, token);
  return n < 0 || (size_t)n >= cap ? -1 : n;
}

bool textasm_feed(textasm_t *t, const char *data, size_t len, size_t offset, size_t total) {
  if (offset == 0) { t->len = 0; t->overflow = false; }
  if (t->overflow || offset != t->len || t->len + len >= sizeof t->buf) {
    t->overflow = true;
  } else {
    memcpy(t->buf + t->len, data, len);
    t->len += len;
  }
  if (offset + len < total) return false;
  if (t->overflow) { t->len = 0; return false; }
  t->buf[t->len] = '\0';
  return true;
}
