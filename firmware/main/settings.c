#include <string.h>
#include "nvs_flash.h"
#include "esp_log.h"
#include "board.h"
#include "settings.h"

static const char *TAG = "settings";
static nvs_handle_t nvs;
static bool opened;

static void read_str(const char *key, char *buf, size_t cap) {
  size_t len = cap;
  if (nvs_get_str(nvs, key, buf, &len) != ESP_OK) return;   /* not stored: keep the default */
}

static void read_bool(const char *key, bool *out) {
  uint8_t v;
  if (nvs_get_u8(nvs, key, &v) == ESP_OK) *out = v != 0;
}

void settings_load(settings_t *s) {
  esp_err_t err = nvs_flash_init();
  if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    nvs_flash_erase();
    err = nvs_flash_init();
  }
  memset(s, 0, sizeof *s);
  strlcpy(s->url, DEFAULT_BODY_URL, sizeof s->url);
  if (err != ESP_OK || nvs_open("body", NVS_READWRITE, &nvs) != ESP_OK) {
    ESP_LOGE(TAG, "NVS unavailable (%s): nothing typed will be remembered", esp_err_to_name(err));
    return;
  }
  opened = true;
  read_str("ssid", s->ssid, sizeof s->ssid);
  read_str("pass", s->pass, sizeof s->pass);
  read_str("token", s->token, sizeof s->token);
  read_str("url", s->url, sizeof s->url);
  read_bool("drv_swap", &s->calib.drive_swapped);
  read_bool("str_swap", &s->calib.steer_swapped);
}

esp_err_t settings_save(const settings_t *s) {
  if (!opened) return ESP_ERR_INVALID_STATE;
  esp_err_t err = ESP_OK;
  if (err == ESP_OK) err = nvs_set_str(nvs, "ssid", s->ssid);
  if (err == ESP_OK) err = nvs_set_str(nvs, "pass", s->pass);
  if (err == ESP_OK) err = nvs_set_str(nvs, "token", s->token);
  if (err == ESP_OK) err = nvs_set_str(nvs, "url", s->url);
  if (err == ESP_OK) err = nvs_set_u8(nvs, "drv_swap", s->calib.drive_swapped);
  if (err == ESP_OK) err = nvs_set_u8(nvs, "str_swap", s->calib.steer_swapped);
  if (err == ESP_OK) err = nvs_commit(nvs);
  return err;
}
