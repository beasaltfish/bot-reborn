// The bridge's permission slip and safe restore, without an ESP32: a fake
// backend records levels and the tests ask what the bridge allowed.

#include <string.h>
#include "check.h"
#include "bridge_io.h"

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

static bridge_io_t make(fake_t *fake) {
  bridge_io_t io = {0};
  bridge_pins_t backend = { fake_set, fake_get, fake };
  CHECK(bridge_io_init(&io, PINS, sizeof PINS / sizeof PINS[0], backend));
  return io;
}

static void writes_and_reads_only_declared_pins(void) {
  fake_t fake = {0};
  bridge_io_t io = make(&fake);
  const char *error = NULL;

  CHECK(bridge_io_write(&io, 5, 1, 0, &error));
  CHECK_EQ_INT(fake.level[5], 1);

  CHECK(!bridge_io_write(&io, 4, 1, 0, &error));
  CHECK_EQ_STR(error, "pin is not an output");
  CHECK(!bridge_io_write(&io, 9, 1, 0, &error));
  CHECK_EQ_STR(error, "pin is not exposed by this bridge");
  CHECK(!bridge_io_write(&io, 5, 2, 0, &error));
  CHECK_EQ_STR(error, "level must be 0 or 1");
  CHECK(!bridge_io_write(&io, 5, 1, 1, &error));
  CHECK_EQ_STR(error, "safe does not match the declared output");

  fake.level[4] = 1;
  int value = -1;
  CHECK(bridge_io_read(&io, 4, &value, &error));
  CHECK_EQ_INT(value, 1);
  CHECK(!bridge_io_read(&io, 5, &value, &error));
  CHECK_EQ_STR(error, "pin is not an input");
  CHECK(!bridge_io_read(&io, 9, &value, &error));
  CHECK_EQ_STR(error, "pin is not exposed by this bridge");
}

static void release_restores_every_output_safe(void) {
  fake_t fake = {0};
  bridge_io_t io = make(&fake);
  const char *error = NULL;
  CHECK(bridge_io_write(&io, 5, 1, 0, &error));
  CHECK_EQ_INT(fake.level[5], 1);
  bridge_io_release(&io);
  CHECK_EQ_INT(fake.level[5], 0);
}

static void a_bad_table_or_backend_is_refused(void) {
  fake_t fake = {0};
  bridge_io_t io = {0};
  bridge_pins_t good = { fake_set, fake_get, &fake };
  bridge_pins_t no_get = { fake_set, NULL, &fake };
  const bridge_pin_t duplicate[] = { { 5, BRIDGE_OUTPUT, 0 }, { 5, BRIDGE_INPUT, 0 } };
  const bridge_pin_t high[] = { { 49, BRIDGE_OUTPUT, 0 } };
  const bridge_pin_t bad_safe[] = { { 5, BRIDGE_OUTPUT, 2 } };
  const bridge_pin_t bad_direction[] = { { 5, 7, 0 } };

  CHECK(!bridge_io_init(&io, PINS, 2, no_get));
  CHECK(!bridge_io_init(&io, duplicate, 2, good));
  CHECK(!bridge_io_init(&io, high, 1, good));
  CHECK(!bridge_io_init(&io, bad_safe, 1, good));
  CHECK(!bridge_io_init(&io, bad_direction, 1, good));
  CHECK(!bridge_io_init(&io, PINS, BRIDGE_MAX_PINS + 1, good));
}

int main(void) {
  writes_and_reads_only_declared_pins();
  release_restores_every_output_safe();
  a_bad_table_or_backend_is_refused();
  CHECK_DONE();
}
