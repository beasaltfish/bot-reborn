// The body: settings, the light, the serial console, Wi-Fi, then the brain.
// Firmware spec §2: listen, play, move, keep the watchdog, show the state.

#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "audio.h"
#include "console.h"
#include "led.h"
#include "link.h"
#include "motor.h"
#include "net.h"
#include "settings.h"

static settings_t settings;

static void on_message(const brain_msg_t *m) {
  led_mode_t mode;
  switch (m->type) {
    case MSG_STATE:
      if (led_mode_for_state(m->text, &mode)) led_set(mode);
      break;
    case MSG_HUSH:
      audio_hush();
      break;
    case MSG_MOVE:
      motor_move(m->drive, m->steer, m->ms);
      break;
    case MSG_STOP:
      motor_stop();
      break;
    default:
      break;
  }
}

/* No brain: stop the car, and stop saying whatever it was saying. */
static void on_lost(void) {
  motor_stop();
  audio_hush();
}

static const link_handlers_t HANDLERS = { on_message, audio_play_bytes, on_lost };

void app_main(void) {
  motor_init();   /* before anything else: the pins float until this runs */
  settings_load(&settings);
  motor_start(&settings.calib);
  led_start();
  console_start(&settings);
  printf("body: protocol %d, brain at %s\n", PROTO_VERSION, settings.url);

  /* Nothing to connect with yet: say what is missing until it is typed. */
  while (!settings.ssid[0] || !settings.token[0]) {
    printf("not set up: type %s, then reboot (help lists commands)\n", !settings.ssid[0] ? "wifi <ssid> [pass]" : "token <32 hex>");
    vTaskDelay(pdMS_TO_TICKS(5000));
  }
  audio_start();
  net_start(&settings);
  link_start(&settings, &HANDLERS);
}
