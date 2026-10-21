// The body's end of the wire: hello, the heartbeat, the watchdog, and
// knocking again after a drop — phone/body-link.js and server/fake-body.js in
// C. A reject is final until reboot.

#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "proto.h"
#include "settings.h"

typedef struct {
  void (*on_message)(const brain_msg_t *m);   /* move, stop, hush, state — after welcome */
  void (*on_audio)(const uint8_t *bytes, size_t n);
  void (*on_lost)(void);                      /* a drop or the watchdog: stop the car */
} link_handlers_t;

void link_start(const settings_t *s, const link_handlers_t *h);
/* False, and nothing sent, before welcome or when the send does not go
   within 50 ms: the microphone drops that block rather than wait. */
bool link_send_audio(const int16_t *pcm, size_t n);
