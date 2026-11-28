// The bridge's pin layer: the small allowlist a protocol-3 board exposes to
// the brain, and the two ops it answers. A pin the table does not name is
// refused; a write's `safe` must match the table, because the value restored
// on disconnect is the board's promise, not the caller's.
//
// The GPIO calls are a backend, so this file stays host-testable: the bridge
// app plugs in driver/gpio.h, the tests plug in an array.

#pragma once
#include <stdbool.h>
#include <stddef.h>

#define BRIDGE_INPUT 0
#define BRIDGE_OUTPUT 1
#define BRIDGE_MAX_PINS 16

typedef struct {
  int gpio;
  int direction;   /* BRIDGE_INPUT or BRIDGE_OUTPUT */
  int safe;        /* outputs: 0 or 1, the level restored on disconnect */
} bridge_pin_t;

typedef struct {
  bool (*set)(int gpio, int level, void *ctx);
  int (*get)(int gpio, void *ctx);
  void *ctx;
} bridge_pins_t;

typedef struct {
  bridge_pin_t pins[BRIDGE_MAX_PINS];
  size_t count;
  bridge_pins_t backend;
} bridge_io_t;

/* Copy the table and check it. False means the bridge must not start: a
   duplicate pin, an out-of-range pin, a missing direction or safe, or a
   backend without both calls. */
bool bridge_io_init(bridge_io_t *io, const bridge_pin_t *pins, size_t count, bridge_pins_t backend);

/* `pin.write`: an output in the table, level 0/1, and the table's safe. */
bool bridge_io_write(bridge_io_t *io, int gpio, int level, int safe, const char **error);

/* `pin.read`: an input in the table. The value is 0 or 1. */
bool bridge_io_read(bridge_io_t *io, int gpio, int *value, const char **error);

/* Disconnect: every output returns to its table's safe. */
void bridge_io_release(bridge_io_t *io);
