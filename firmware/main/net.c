#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "led.h"
#include "net.h"

static const char *TAG = "net";
#define UP BIT0
static EventGroupHandle_t bits;

static void on_event(void *arg, esp_event_base_t base, int32_t id, void *data) {
  (void)arg;
  if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
    esp_wifi_connect();
  } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
    xEventGroupClearBits(bits, UP);
    led_set(LED_NO_WIFI);
    esp_wifi_connect();
  } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
    ip_event_got_ip_t *got = data;
    ESP_LOGI(TAG, "on Wi-Fi as " IPSTR, IP2STR(&got->ip_info.ip));
    led_set(LED_CONNECTING);
    xEventGroupSetBits(bits, UP);
  }
}

void net_start(const settings_t *s) {
  bits = xEventGroupCreate();
  ESP_ERROR_CHECK(esp_netif_init());
  ESP_ERROR_CHECK(esp_event_loop_create_default());
  esp_netif_create_default_wifi_sta();
  wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
  ESP_ERROR_CHECK(esp_wifi_init(&init));
  ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_event, NULL));
  ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_event, NULL));

  wifi_config_t cfg = {0};
  strlcpy((char *)cfg.sta.ssid, s->ssid, sizeof cfg.sta.ssid);
  strlcpy((char *)cfg.sta.password, s->pass, sizeof cfg.sta.password);
  cfg.sta.threshold.authmode = s->pass[0] ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;
  ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
  ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &cfg));
  ESP_ERROR_CHECK(esp_wifi_start());
  /* Power save delays incoming frames by up to a beacon interval; a body
     streaming audio both ways with a one-second watchdog cannot afford it. */
  esp_wifi_set_ps(WIFI_PS_NONE);
}

bool net_wait_up(TickType_t ticks) {
  return (xEventGroupWaitBits(bits, UP, pdFALSE, pdTRUE, ticks) & UP) != 0;
}
