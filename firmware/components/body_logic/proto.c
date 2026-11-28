#include <stdio.h>
#include <string.h>
#include <cJSON.h>
#include "proto.h"

const char PROTO_PING[] = "{\"type\":\"ping\"}";
const char PROTO_SHAKE[] = "{\"type\":\"shake\"}";
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

/* One bounded IO op from the brain (core/protocol.js: cmd). The op names a
   gpio number, not a resource name; the bridge's allowlist decides whether
   that number is a pin it may touch. */
static bool read_cmd(const cJSON *j, brain_msg_t *m) {
  const cJSON *id = cJSON_GetObjectItemCaseSensitive(j, "id");
  const char *op = string_of(j, "op");
  const cJSON *args = cJSON_GetObjectItemCaseSensitive(j, "args");
  const cJSON *pin = cJSON_IsObject(args) ? cJSON_GetObjectItemCaseSensitive(args, "pin") : NULL;
  if (!cJSON_IsNumber(id) || id->valuedouble != (double)id->valueint
      || id->valueint < 1 || id->valueint > 255) return false;
  if (!op || !cJSON_IsObject(args) || !cJSON_IsNumber(pin)
      || pin->valuedouble != (double)pin->valueint
      || pin->valueint < 0 || pin->valueint > PROTO_MAX_GPIO) return false;

  m->cmd_id = id->valueint;
  m->cmd_pin = pin->valueint;
  if (strcmp(op, "pin.write") == 0) {
    const cJSON *level = cJSON_GetObjectItemCaseSensitive(args, "level");
    const cJSON *safe = cJSON_GetObjectItemCaseSensitive(j, "safe");
    if (!cJSON_IsNumber(level) || level->valuedouble != (double)level->valueint
        || (level->valueint != 0 && level->valueint != 1)) return false;
    if (!cJSON_IsNumber(safe) || safe->valuedouble != (double)safe->valueint
        || (safe->valueint != 0 && safe->valueint != 1)) return false;
    m->cmd_write = true;
    m->cmd_level = level->valueint;
    m->cmd_safe = safe->valueint;
  } else if (strcmp(op, "pin.read") == 0) {
    m->cmd_write = false;
  } else {
    return false;
  }
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
  } else if (strcmp(type, "cmd") == 0) {
    if (read_cmd(j, &m)) m.type = MSG_CMD;
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

int proto_hello_version(char *buf, size_t cap, const char *token, int version) {
  int n = snprintf(buf, cap, "{\"type\":\"hello\",\"protocol\":%d,\"token\":\"%s\"}", version, token);
  return n < 0 || (size_t)n >= cap ? -1 : n;
}

int proto_hello(char *buf, size_t cap, const char *token) {
  return proto_hello_version(buf, cap, token, PROTO_VERSION);
}

int proto_result_value(char *buf, size_t cap, int id, int value) {
  int n = snprintf(buf, cap, "{\"type\":\"result\",\"id\":%d,\"ok\":true,\"value\":%d}", id, value);
  return n < 0 || (size_t)n >= cap ? -1 : n;
}

int proto_result_error(char *buf, size_t cap, int id, const char *error) {
  int n = snprintf(buf, cap, "{\"type\":\"result\",\"id\":%d,\"ok\":false,\"error\":\"%s\"}", id, error);
  return n < 0 || (size_t)n >= cap ? -1 : n;
}

int proto_hello_screen(char *buf, size_t cap, const char *token, int w, int h) {
  int n = snprintf(buf, cap, "{\"type\":\"hello\",\"protocol\":%d,\"token\":\"%s\",\"screen\":{\"w\":%d,\"h\":%d}}",
                   PROTO_VERSION, token, w, h);
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
