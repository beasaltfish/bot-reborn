#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/usb_serial_jtag.h"
#include "driver/usb_serial_jtag_vfs.h"
#include "esp_system.h"
#include "command.h"
#include "console.h"

static settings_t *settings;

static const char HELP[] =
  "  wifi <ssid> [pass]   quote either to hold spaces; empty pass = open network\n"
  "  token <32 hex>       from the admin page\n"
  "  url ws://<ip>:8787/body\n"
  "  cal                  show calibration\n"
  "  cal drive            swap forward/backward (decide this first)\n"
  "  cal steer            swap left/right\n"
  "  reboot\n";

static const char *yes(bool b) { return b ? "yes" : "no"; }

static void save(const char *what) {
  esp_err_t err = settings_save(settings);
  if (err == ESP_OK) printf("%s saved\n", what);
  else printf("error: could not save (%s)\n", esp_err_to_name(err));
}

static void act(const char *line) {
  cmd_t c = cmd_parse(line);
  switch (c.kind) {
    case CMD_INVALID:
      if (c.error) printf("error: %s\n", c.error);
      break;
    case CMD_HELP: fputs(HELP, stdout); break;
    case CMD_CAL_SHOW: break;
    case CMD_CAL_DRIVE: settings->calib.drive_swapped = !settings->calib.drive_swapped; save("calibration"); break;
    case CMD_CAL_STEER: settings->calib.steer_swapped = !settings->calib.steer_swapped; save("calibration"); break;
    case CMD_WIFI:
      strlcpy(settings->ssid, c.a, sizeof settings->ssid);
      strlcpy(settings->pass, c.b, sizeof settings->pass);
      save("wifi");
      printf("type reboot to use it\n");
      break;
    case CMD_TOKEN:
      strlcpy(settings->token, c.a, sizeof settings->token);
      printf("token %.4s… ", settings->token);
      save("");
      printf("type reboot to use it\n");
      break;
    case CMD_URL:
      strlcpy(settings->url, c.a, sizeof settings->url);
      save("url");
      printf("type reboot to use it\n");
      break;
    case CMD_REBOOT: fflush(stdout); esp_restart(); break;
  }
  if (c.kind == CMD_CAL_SHOW || c.kind == CMD_CAL_DRIVE || c.kind == CMD_CAL_STEER) {
    printf("drive swapped: %s, steer swapped: %s\n", yes(settings->calib.drive_swapped), yes(settings->calib.steer_swapped));
  }
}

static void console_task(void *arg) {
  (void)arg;
  char line[256];
  size_t n = 0;
  for (;;) {
    uint8_t ch;
    if (usb_serial_jtag_read_bytes(&ch, 1, portMAX_DELAY) <= 0) continue;
    if (ch == '\r' || ch == '\n') {
      putchar('\n');
      if (n) { line[n] = '\0'; act(line); n = 0; }
    } else if ((ch == 0x7f || ch == '\b') && n) {
      n--;
      fputs("\b \b", stdout);
    } else if (ch >= 0x20 && n < sizeof line - 1) {
      line[n++] = (char)ch;
      putchar(ch);
    }
    fflush(stdout);
  }
}

void console_start(settings_t *s) {
  settings = s;
  usb_serial_jtag_driver_config_t cfg = USB_SERIAL_JTAG_DRIVER_CONFIG_DEFAULT();
  usb_serial_jtag_driver_install(&cfg);
  usb_serial_jtag_vfs_use_driver();
  xTaskCreate(console_task, "console", 4096, NULL, 3, NULL);
}
