#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "esp_timer.h"
#include "esp_websocket_client.h"
#include "link_policy.h"
#include "led.h"
#include "net.h"
#include "link.h"

#define CONNECTED BIT0
#define LOST      BIT1

/* The brain drops a body that has not said hello within 5 s (link.js). */
#define HELLO_TIMEOUT_MS 5000

/* esp_websocket_client aborts the connection when a send times out, so a send
   waits well past a Wi-Fi stall and leaves "the brain is gone" to the 1 s
   watchdogs. Not longer: the link task also runs the watchdog. */
#define SEND_TIMEOUT_MS 300

static EventGroupHandle_t bits;
static esp_websocket_client_handle_t client;
static const settings_t *settings;
static const link_handlers_t *handlers;

/* Touched by the client's event task and the link task. */
static portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
static dog_t dog;
static volatile bool welcomed;
static volatile bool pong_due;

/* Only the client's event task. */
static textasm_t text;
static uint8_t frame_op;

/* Only the link task, and the event task before it is finished. */
static retry_t retry;
static char reject_reason[sizeof ((brain_msg_t *)0)->text];

static uint32_t now_ms(void) { return (uint32_t)(esp_timer_get_time() / 1000); }

static void on_text(const char *s, size_t n) {
  brain_msg_t m = proto_parse(s, n);
  if (!welcomed) {
    if (m.type == MSG_WELCOME) {
      portENTER_CRITICAL(&mux);
      dog_start(&dog, now_ms());
      portEXIT_CRITICAL(&mux);
      retry_welcomed(&retry);
      welcomed = true;
      printf("welcomed as %s\n", m.text);
    } else if (m.type == MSG_REJECT) {
      strlcpy(reject_reason, m.text, sizeof reject_reason);
      retry_rejected(&retry);
      xEventGroupSetBits(bits, LOST);
    }
    return;
  }
  switch (m.type) {
    case MSG_PING: pong_due = true; break;
    case MSG_MOVE: case MSG_STOP: case MSG_HUSH: case MSG_STATE: handlers->on_message(&m); break;
    default: break;
  }
}

static void on_event(void *arg, esp_event_base_t base, int32_t id, void *event) {
  (void)arg; (void)base;
  esp_websocket_event_data_t *d = event;
  switch (id) {
    case WEBSOCKET_EVENT_CONNECTED:
      xEventGroupSetBits(bits, CONNECTED);
      break;
    case WEBSOCKET_EVENT_DISCONNECTED:
    case WEBSOCKET_EVENT_CLOSED:
    case WEBSOCKET_EVENT_ERROR:
      xEventGroupSetBits(bits, LOST);
      break;
    case WEBSOCKET_EVENT_DATA: {
      portENTER_CRITICAL(&mux);
      dog_heard(&dog, now_ms());
      portEXIT_CRITICAL(&mux);
      /* A frame longer than buffer_size comes as several events; 0 is a
         continuation of whatever the frame began as. */
      if (d->op_code != 0) frame_op = d->op_code;
      if (frame_op == 0x1) {
        if (textasm_feed(&text, d->data_ptr, d->data_len, d->payload_offset, d->payload_len)) on_text(text.buf, text.len);
      } else if (frame_op == 0x2 && welcomed) {
        handlers->on_audio((const uint8_t *)d->data_ptr, d->data_len);
      }
      break;
    }
    default:
      break;
  }
}

static void send_text(const char *s) {
  esp_websocket_client_send_text(client, s, strlen(s), pdMS_TO_TICKS(SEND_TIMEOUT_MS));
}

/* Connected: hello, then pong, ping and watch until the connection is lost
   or the brain goes quiet. */
static void hold(void) {
  char hello[96];
  int n = proto_hello(hello, sizeof hello, settings->token);
  esp_websocket_client_send_text(client, hello, n, pdMS_TO_TICKS(1000));
  uint32_t since = now_ms(), last_ping = since;
  for (;;) {
    if (xEventGroupWaitBits(bits, LOST, pdFALSE, pdFALSE, pdMS_TO_TICKS(50)) & LOST) return;
    uint32_t t = now_ms();
    portENTER_CRITICAL(&mux);
    bool silent = dog_expired(&dog, t);
    portEXIT_CRITICAL(&mux);
    if (silent) { printf("the brain went quiet\n"); return; }
    if (!welcomed && t - since > HELLO_TIMEOUT_MS) { printf("no welcome from the brain\n"); return; }
    if (pong_due) { pong_due = false; send_text(PROTO_PONG); }
    if (welcomed && t - last_ping >= LINK_HEARTBEAT_MS) { last_ping = t; send_text(PROTO_PING); }
  }
}

static void link_task(void *arg) {
  (void)arg;
  for (;;) {
    net_wait_up(portMAX_DELAY);
    led_set(LED_CONNECTING);
    xEventGroupClearBits(bits, CONNECTED | LOST);
    text.len = 0;
    frame_op = 0;
    if (esp_websocket_client_start(client) == ESP_OK) {
      EventBits_t b = xEventGroupWaitBits(bits, CONNECTED | LOST, pdFALSE, pdFALSE, pdMS_TO_TICKS(5000));
      if ((b & CONNECTED) && !(b & LOST)) hold();
    }
    bool had = welcomed;
    welcomed = false;
    portENTER_CRITICAL(&mux);
    dog_stop(&dog);
    portEXIT_CRITICAL(&mux);
    handlers->on_lost();
    esp_websocket_client_stop(client);
    if (retry.finished) {
      printf("rejected: %s — fix it, then type reboot\n", reject_reason);
      led_set(LED_REJECTED);
      vTaskDelete(NULL);
    }
    uint32_t wait = retry_next_ms(&retry);
    printf("%s %s; trying again in %u ms\n", had ? "lost" : "could not reach", settings->url, (unsigned)wait);
    vTaskDelay(pdMS_TO_TICKS(wait));
  }
}

void link_start(const settings_t *s, const link_handlers_t *h) {
  settings = s;
  handlers = h;
  bits = xEventGroupCreate();
  esp_websocket_client_config_t cfg = {
    .uri = s->url,
    .buffer_size = 4096,
    .disable_auto_reconnect = true,   /* retry_t decides when, as the phone does */
    .network_timeout_ms = 3000,
    .task_stack = 6144,
  };
  client = esp_websocket_client_init(&cfg);
  esp_websocket_register_events(client, WEBSOCKET_EVENT_ANY, on_event, NULL);
  xTaskCreate(link_task, "link", 4096, NULL, 5, NULL);
}

bool link_send_audio(const int16_t *pcm, size_t n) {
  if (!welcomed || !esp_websocket_client_is_connected(client)) return false;
  return esp_websocket_client_send_bin(client, (const char *)pcm, (int)(n * sizeof *pcm), pdMS_TO_TICKS(SEND_TIMEOUT_MS)) >= 0;
}
