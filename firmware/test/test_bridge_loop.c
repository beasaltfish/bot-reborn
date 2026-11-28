// One `cmd` from parse to `result`, with the host-tested pin layer between:
// the bridge's whole contract without a board.

#include <string.h>
#include "check.h"
#include "bridge_io.h"
#include "proto.h"

typedef struct {
  int level[64];
} fake_t;

static bool fake_set(int gpio, int level, void *ctx) {
  ((fake_t *)ctx)->level[gpio] = level;
  return true;
}

static int fake_get(int gpio, void *ctx) {
  return ((fake_t *)ctx)->level[gpio];
}

static const bridge_pin_t PINS[] = {
  { 5, BRIDGE_OUTPUT, 0 },
  { 4, BRIDGE_INPUT, 0 },
};

static void answer(const brain_msg_t *m, bridge_io_t *io, char *buf, size_t cap) {
  const char *error = NULL;
  int value = 0;
  bool ok = m->cmd_write
    ? bridge_io_write(io, m->cmd_pin, m->cmd_level, m->cmd_safe, &error)
    : bridge_io_read(io, m->cmd_pin, &value, &error);
  if (ok) proto_result_value(buf, cap, m->cmd_id, m->cmd_write ? m->cmd_level : value);
  else proto_result_error(buf, cap, m->cmd_id, error);
}

int main(void) {
  fake_t fake = {0};
  bridge_io_t io = {0};
  bridge_pins_t backend = { fake_set, fake_get, &fake };
  CHECK(bridge_io_init(&io, PINS, sizeof PINS / sizeof PINS[0], backend));

  char buf[128];
  const char *write = "{\"type\":\"cmd\",\"id\":7,\"op\":\"pin.write\",\"args\":{\"pin\":5,\"level\":1},\"safe\":0}";
  brain_msg_t w = proto_parse(write, strlen(write));
  CHECK_EQ_INT(w.type, MSG_CMD);
  answer(&w, &io, buf, sizeof buf);
  CHECK_EQ_STR(buf, "{\"type\":\"result\",\"id\":7,\"ok\":true,\"value\":1}");
  CHECK_EQ_INT(fake.level[5], 1);

  fake.level[4] = 1;
  const char *read = "{\"type\":\"cmd\",\"id\":8,\"op\":\"pin.read\",\"args\":{\"pin\":4}}";
  brain_msg_t r = proto_parse(read, strlen(read));
  answer(&r, &io, buf, sizeof buf);
  CHECK_EQ_STR(buf, "{\"type\":\"result\",\"id\":8,\"ok\":true,\"value\":1}");

  const char *wrong = "{\"type\":\"cmd\",\"id\":9,\"op\":\"pin.write\",\"args\":{\"pin\":4,\"level\":1},\"safe\":0}";
  brain_msg_t bad = proto_parse(wrong, strlen(wrong));
  answer(&bad, &io, buf, sizeof buf);
  CHECK_EQ_STR(buf, "{\"type\":\"result\",\"id\":9,\"ok\":false,\"error\":\"pin is not an output\"}");

  bridge_io_release(&io);
  CHECK_EQ_INT(fake.level[5], 0);
  CHECK_DONE();
}
