#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "esp_websocket_client.h"
#include "binasm.h"
#include "frameslot.h"
#include "link.h"
#include "link_policy.h"
#include "proto.h"
#include "screen.h"
#include "screen_link.h"
#include "screen_url.h"

#define CONNECTED BIT0
#define LOST      BIT1

/* A frame is 10-20 KB; the brain stops feeding a socket holding more than
   32 KB (server/screen-link.js maxBuffered), so a bigger one is not ours. */
#define FRAME_CAP (32 * 1024)
#define HELLO_TIMEOUT_MS 5000
/* The brain pings a screen every 2 s and sends frames at ~8 fps; a panel it has
   no frames for hears only the pings. Not the body's one-second watchdog. */
#define SILENCE_MS 6000
#define SEND_TIMEOUT_MS 300

static EventGroupHandle_t bits;
static esp_websocket_client_handle_t client;
static const settings_t *settings;

static uint8_t *frames[FRAMESLOT_BUFFERS];
static frameslot_t slot;
static portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;

/* The client's event task only. */
static textasm_t text;
static binasm_t bin;
static uint8_t frame_op;

/* Event task writes, link task reads. */
static volatile bool welcomed;
static volatile bool pong_due;
static volatile uint32_t last_heard_ms;
static volatile unsigned frames_in;
static retry_t retry;
static char reject_reason[24];

static uint32_t now_ms(void) { return (uint32_t)(esp_timer_get_time() / 1000); }

static void on_text(const char *s, size_t n) {
  brain_msg_t m = proto_parse(s, n);
  switch (m.type) {
    case MSG_WELCOME:
      retry_welcomed(&retry);
      welcomed = true;
      printf("screen link: welcomed\n");
      break;
    case MSG_REJECT:
      strlcpy(reject_reason, m.text, sizeof reject_reason);
      retry_rejected(&retry, m.text, now_ms());
      xEventGroupSetBits(bits, LOST);
      break;
    case MSG_PING:
      pong_due = true;
      break;
    default:
      break;
  }
}

static void on_binary(const esp_websocket_event_data_t *d) {
  if (!welcomed) return;
  if (d->payload_offset == 0) {
    portENTER_CRITICAL(&mux);
    int w = frameslot_begin_write(&slot);
    portEXIT_CRITICAL(&mux);
    bin.buf = frames[w];
    bin.cap = FRAME_CAP;
  }
  if (binasm_feed(&bin, (const uint8_t *)d->data_ptr, d->data_len, d->payload_offset, d->payload_len)) {
    portENTER_CRITICAL(&mux);
    frameslot_commit(&slot, bin.len);
    portEXIT_CRITICAL(&mux);
    frames_in++;
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
    case WEBSOCKET_EVENT_DATA:
      last_heard_ms = now_ms();
      if (d->op_code != 0) frame_op = d->op_code;
      if (frame_op == 0x1) {
        if (textasm_feed(&text, d->data_ptr, d->data_len, d->payload_offset, d->payload_len)) on_text(text.buf, text.len);
      } else if (frame_op == 0x2) {
        on_binary(d);
      }
      break;
    default:
      break;
  }
}

/* Connected: hello, then answer pings and watch for silence until the socket
   is lost. */
static void hold(void) {
  char hello[160];
  int n = proto_hello_screen(hello, sizeof hello, settings->token, screen_width(), screen_height());
  if (n < 0) return;
  esp_websocket_client_send_text(client, hello, n, pdMS_TO_TICKS(1000));
  uint32_t since = now_ms(), last_report = since;
  last_heard_ms = since;
  unsigned reported = frames_in;
  for (;;) {
    if (xEventGroupWaitBits(bits, LOST, pdFALSE, pdFALSE, pdMS_TO_TICKS(50)) & LOST) return;
    uint32_t t = now_ms();
    if (t - last_heard_ms > SILENCE_MS) { printf("screen link: the brain went quiet\n"); return; }
    if (!welcomed && t - since > HELLO_TIMEOUT_MS) { printf("screen link: no welcome\n"); return; }
    if (pong_due) {
      pong_due = false;
      esp_websocket_client_send_text(client, PROTO_PONG, strlen(PROTO_PONG), pdMS_TO_TICKS(SEND_TIMEOUT_MS));
    }
    if (t - last_report >= 10000) {
      portENTER_CRITICAL(&mux);
      unsigned dropped = slot.dropped;
      portEXIT_CRITICAL(&mux);
      printf("screen link: %u frames in the last 10 s, %u dropped in all\n", frames_in - reported, dropped);
      reported = frames_in;
      last_report = t;
    }
  }
}

static void screen_link_task(void *arg) {
  (void)arg;
  /* Frames live in PSRAM: three of them, once, and only when there is a screen. */
  for (int i = 0; i < FRAMESLOT_BUFFERS; i++) {
    frames[i] = heap_caps_malloc(FRAME_CAP, MALLOC_CAP_SPIRAM);
    if (!frames[i]) { printf("screen link: no PSRAM for frames; the screen stays as it is\n"); vTaskDelete(NULL); }
  }
  for (;;) {
    /* The panel up, and the body link knows where the brain is. */
    while (!screen_ready() || !link_dialed_url()[0]) vTaskDelay(pdMS_TO_TICKS(250));
    char url[160];
    if (!screen_url_from_body(link_dialed_url(), url, sizeof url)) {
      printf("screen link: cannot make a /screen address from %s\n", link_dialed_url());
      vTaskDelay(pdMS_TO_TICKS(5000));
      continue;
    }
    xEventGroupClearBits(bits, CONNECTED | LOST);
    text.len = 0;
    frame_op = 0;
    welcomed = false;
    pong_due = false;
    reject_reason[0] = '\0';
    esp_websocket_client_set_uri(client, url);
    if (esp_websocket_client_start(client) == ESP_OK) {
      EventBits_t b = xEventGroupWaitBits(bits, CONNECTED | LOST, pdFALSE, pdFALSE, pdMS_TO_TICKS(5000));
      if ((b & CONNECTED) && !(b & LOST)) hold();
    }
    welcomed = false;
    esp_websocket_client_stop(client);
    if (retry.finished) {
      printf("screen link: rejected (%s); fix it and reboot\n", reject_reason);
      vTaskDelete(NULL);
    }
    uint32_t wait = retry_next_ms(&retry);
    printf("screen link: lost %s; trying again in %u ms\n", url, (unsigned)wait);
    vTaskDelay(pdMS_TO_TICKS(wait));
  }
}

void screen_link_start(const settings_t *s) {
  settings = s;
  bits = xEventGroupCreate();
  frameslot_init(&slot);
  esp_websocket_client_config_t cfg = {
    .uri = "ws://screen.invalid/screen",   /* replaced before every start */
    .buffer_size = 4096,
    .disable_auto_reconnect = true,   /* retry_t decides when, as the body link does */
    .network_timeout_ms = 3000,
    .task_stack = 6144,
  };
  client = esp_websocket_client_init(&cfg);
  esp_websocket_register_events(client, WEBSOCKET_EVENT_ANY, on_event, NULL);
  xTaskCreate(screen_link_task, "screen_link", 4096, NULL, 4, NULL);
}

bool screen_link_take_frame(const uint8_t **jpeg, size_t *len) {
  portENTER_CRITICAL(&mux);
  int i = frameslot_take(&slot, len);
  portEXIT_CRITICAL(&mux);
  if (i < 0) return false;
  *jpeg = frames[i];
  return true;
}

void screen_link_release_frame(void) {
  portENTER_CRITICAL(&mux);
  frameslot_release(&slot);
  portEXIT_CRITICAL(&mux);
}
