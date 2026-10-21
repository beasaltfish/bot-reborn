#include <stdlib.h>
#include <cJSON.h>
#include "check.h"
#include "proto.h"

static const char *type_name(msg_type_t t) {
  switch (t) {
    case MSG_WELCOME: return "welcome"; case MSG_REJECT: return "reject";
    case MSG_MOVE: return "move";       case MSG_STOP: return "stop";
    case MSG_HUSH: return "hush";       case MSG_STATE: return "state";
    case MSG_PING: return "ping";       case MSG_PONG: return "pong";
    default: return "null";
  }
}

static char *read_file(const char *path) {
  FILE *f = fopen(path, "rb");
  if (!f) { perror(path); exit(1); }
  fseek(f, 0, SEEK_END);
  long n = ftell(f);
  rewind(f);
  char *buf = malloc((size_t)n + 1);
  if (fread(buf, 1, (size_t)n, f) != (size_t)n) exit(1);
  buf[n] = '\0';
  fclose(f);
  return buf;
}

/* The shared vectors: core/protocol.js agrees with every one of them
   (test/firmware-vectors.test.js), so this is the C parser agreeing with JS. */
static void agrees_with_the_shared_vectors(void) {
  char *text = read_file(VECTORS);
  cJSON *all = cJSON_Parse(text);
  CHECK(cJSON_IsArray(all));
  int n = 0;
  cJSON *v;
  cJSON_ArrayForEach(v, all) {
    const char *msg = cJSON_GetObjectItem(v, "text")->valuestring;
    cJSON *want = cJSON_GetObjectItem(v, "type");
    const char *want_name = cJSON_IsString(want) ? want->valuestring : "null";
    brain_msg_t m = proto_parse(msg, strlen(msg));
    if (strcmp(type_name(m.type), want_name) != 0) {
      fprintf(stderr, "vector %s: got %s, want %s\n", msg, type_name(m.type), want_name);
      check_failures++;
    }
    n++;
  }
  CHECK(n > 20);
  cJSON_Delete(all);
  free(text);
}

static void reads_a_moves_fields(void) {
  const char *s = "{\"type\":\"move\",\"drive\":\"backward\",\"steer\":\"right\",\"ms\":750}";
  brain_msg_t m = proto_parse(s, strlen(s));
  CHECK_EQ_INT(m.type, MSG_MOVE);
  CHECK_EQ_INT(m.drive, DRIVE_BACKWARD);
  CHECK_EQ_INT(m.steer, STEER_RIGHT);
  CHECK_EQ_INT(m.ms, 750);
}

static void reads_text_fields_and_cuts_them_short(void) {
  const char *r = "{\"type\":\"reject\",\"reason\":\"busy\"}";
  brain_msg_t rm = proto_parse(r, strlen(r));
  CHECK_EQ_STR(rm.text, "busy");
  const char *s = "{\"type\":\"state\",\"state\":\"SPEAKING\"}";
  brain_msg_t sm = proto_parse(s, strlen(s));
  CHECK_EQ_STR(sm.text, "SPEAKING");
  const char *w = "{\"type\":\"welcome\",\"name\":\"A name far longer than twenty-three bytes\"}";
  brain_msg_t m = proto_parse(w, strlen(w));
  CHECK_EQ_INT(m.type, MSG_WELCOME);
  CHECK_EQ_INT(strlen(m.text), sizeof m.text - 1);
}

static void parses_only_len_bytes(void) {
  /* A WebSocket payload is not NUL-terminated. */
  const char *s = "{\"type\":\"stop\"}GARBAGE";
  CHECK_EQ_INT(proto_parse(s, 15).type, MSG_STOP);
}

static void writes_a_hello_cjson_reads_back(void) {
  char buf[128];
  int n = proto_hello(buf, sizeof buf, "0123456789abcdef0123456789abcdef");
  CHECK(n > 0);
  CHECK_EQ_INT(n, strlen(buf));
  cJSON *j = cJSON_Parse(buf);
  CHECK_EQ_STR(cJSON_GetObjectItem(j, "type")->valuestring, "hello");
  CHECK_EQ_INT(cJSON_GetObjectItem(j, "protocol")->valueint, 2);
  CHECK_EQ_STR(cJSON_GetObjectItem(j, "token")->valuestring, "0123456789abcdef0123456789abcdef");
  cJSON_Delete(j);
  CHECK_EQ_INT(proto_hello(buf, 10, "0123456789abcdef0123456789abcdef"), -1);
}

static void ping_and_pong_are_what_the_brain_parses(void) {
  CHECK_EQ_STR(PROTO_PING, "{\"type\":\"ping\"}");
  CHECK_EQ_STR(PROTO_PONG, "{\"type\":\"pong\"}");
}

static void textasm_joins_a_frame_sent_in_three_parts(void) {
  textasm_t t = {0};
  const char *msg = "{\"type\":\"state\",\"state\":\"THINKING\"}";
  size_t n = strlen(msg);
  CHECK(!textasm_feed(&t, msg, 10, 0, n));
  CHECK(!textasm_feed(&t, msg + 10, 10, 10, n));
  CHECK(textasm_feed(&t, msg + 20, n - 20, 20, n));
  CHECK_EQ_STR(t.buf, msg);
  CHECK_EQ_INT(proto_parse(t.buf, t.len).type, MSG_STATE);
}

static void textasm_starts_over_at_offset_zero(void) {
  textasm_t t = {0};
  CHECK(!textasm_feed(&t, "{\"type\":", 8, 0, 20));
  CHECK(textasm_feed(&t, "{\"type\":\"hush\"}", 15, 0, 15));
  CHECK_EQ_STR(t.buf, "{\"type\":\"hush\"}");
}

static void textasm_drops_an_overlong_frame(void) {
  textasm_t t = {0};
  char big[600];
  memset(big, 'x', sizeof big);
  CHECK(!textasm_feed(&t, big, 300, 0, 600));
  CHECK(!textasm_feed(&t, big + 300, 300, 300, 600));
  CHECK(textasm_feed(&t, "{\"type\":\"stop\"}", 15, 0, 15));
  CHECK_EQ_STR(t.buf, "{\"type\":\"stop\"}");
}

int main(void) {
  agrees_with_the_shared_vectors();
  reads_a_moves_fields();
  reads_text_fields_and_cuts_them_short();
  parses_only_len_bytes();
  writes_a_hello_cjson_reads_back();
  ping_and_pong_are_what_the_brain_parses();
  textasm_joins_a_frame_sent_in_three_parts();
  textasm_starts_over_at_offset_zero();
  textasm_drops_an_overlong_frame();
  CHECK_DONE();
}
