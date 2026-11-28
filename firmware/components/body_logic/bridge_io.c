#include <string.h>
#include "bridge_io.h"

static const bridge_pin_t *find(const bridge_io_t *io, int gpio) {
  for (size_t i = 0; i < io->count; i++) {
    if (io->pins[i].gpio == gpio) return &io->pins[i];
  }
  return NULL;
}

bool bridge_io_init(bridge_io_t *io, const bridge_pin_t *pins, size_t count, bridge_pins_t backend) {
  if (!io || !pins || count > BRIDGE_MAX_PINS || !backend.set || !backend.get) return false;
  memset(io, 0, sizeof *io);
  io->backend = backend;
  for (size_t i = 0; i < count; i++) {
    const bridge_pin_t *pin = &pins[i];
    if (pin->gpio < 0 || pin->gpio > 48) return false;
    if (pin->direction != BRIDGE_INPUT && pin->direction != BRIDGE_OUTPUT) return false;
    if (pin->direction == BRIDGE_OUTPUT && pin->safe != 0 && pin->safe != 1) return false;
    for (size_t j = 0; j < i; j++) {
      if (io->pins[j].gpio == pin->gpio) return false;
    }
    io->pins[i] = *pin;
  }
  io->count = count;
  return true;
}

bool bridge_io_write(bridge_io_t *io, int gpio, int level, int safe, const char **error) {
  *error = NULL;
  const bridge_pin_t *pin = find(io, gpio);
  if (!pin) { *error = "pin is not exposed by this bridge"; return false; }
  if (pin->direction != BRIDGE_OUTPUT) { *error = "pin is not an output"; return false; }
  if (level != 0 && level != 1) { *error = "level must be 0 or 1"; return false; }
  if (safe != pin->safe) { *error = "safe does not match the declared output"; return false; }
  if (!io->backend.set(gpio, level, io->backend.ctx)) { *error = "gpio write failed"; return false; }
  return true;
}

bool bridge_io_read(bridge_io_t *io, int gpio, int *value, const char **error) {
  *error = NULL;
  const bridge_pin_t *pin = find(io, gpio);
  if (!pin) { *error = "pin is not exposed by this bridge"; return false; }
  if (pin->direction != BRIDGE_INPUT) { *error = "pin is not an input"; return false; }
  *value = io->backend.get(gpio, io->backend.ctx) ? 1 : 0;
  return true;
}

void bridge_io_release(bridge_io_t *io) {
  if (!io) return;
  for (size_t i = 0; i < io->count; i++) {
    if (io->pins[i].direction == BRIDGE_OUTPUT) {
      io->backend.set(io->pins[i].gpio, io->pins[i].safe, io->backend.ctx);
    }
  }
}
