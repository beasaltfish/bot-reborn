#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "jpeg_decoder.h"
#include "screen.h"
#include "screen_draw.h"
#include "screen_link.h"

#define BAND_ROWS 16

static uint32_t now_ms(void) { return (uint32_t)(esp_timer_get_time() / 1000); }

static void draw_task(void *arg) {
  (void)arg;
  while (!screen_ready()) vTaskDelay(pdMS_TO_TICKS(100));
  const int w = screen_width(), h = screen_height();
  /* The whole decoded picture in PSRAM; DMA reads one band at a time from a
     small internal buffer (SPI DMA wants internal RAM). */
  uint16_t *picture = heap_caps_malloc((size_t)w * h * sizeof(uint16_t), MALLOC_CAP_SPIRAM);
  uint16_t *band = heap_caps_malloc((size_t)w * BAND_ROWS * sizeof(uint16_t), MALLOC_CAP_DMA | MALLOC_CAP_INTERNAL);
  if (!picture || !band) {
    printf("screen draw: out of memory for the picture; the screen stays as it is\n");
    vTaskDelete(NULL);
  }
  uint32_t last_report = now_ms(), last_complaint = 0;
  unsigned drawn = 0, skipped = 0;
  for (;;) {
    const uint8_t *jpeg;
    size_t len;
    if (!screen_link_take_frame(&jpeg, &len)) { vTaskDelay(pdMS_TO_TICKS(20)); continue; }

    esp_jpeg_image_cfg_t cfg = {
      .indata = (uint8_t *)jpeg,
      .indata_size = len,
      .outbuf = (uint8_t *)picture,
      .outbuf_size = (size_t)w * h * sizeof(uint16_t),
      .out_format = JPEG_IMAGE_FORMAT_RGB565,
      .out_scale = JPEG_IMAGE_SCALE_0,
      .flags = { .swap_color_bytes = 1 },
    };
    esp_jpeg_image_output_t out;
    esp_err_t err = esp_jpeg_decode(&cfg, &out);
    screen_link_release_frame();
    uint32_t t = now_ms();
    if (err != ESP_OK || out.width != w || out.height != h) {
      skipped++;
      /* One line a minute: idle is 8 frames a second. */
      if (t - last_complaint > 60000 || last_complaint == 0) {
        last_complaint = t;
        printf("screen draw: skipped a frame (%s, %dx%d, panel is %dx%d)\n",
               err == ESP_OK ? "wrong size" : esp_err_to_name(err),
               err == ESP_OK ? out.width : 0, err == ESP_OK ? out.height : 0, w, h);
      }
      continue;
    }
    for (int y = 0; y < h; y += BAND_ROWS) {
      int rows = h - y < BAND_ROWS ? h - y : BAND_ROWS;
      memcpy(band, picture + (size_t)y * w, (size_t)rows * w * sizeof(uint16_t));
      screen_draw_band(y, rows, band);
    }
    drawn++;
    if (t - last_report >= 10000) {
      printf("screen draw: %u frames drawn, %u skipped in the last 10 s\n", drawn, skipped);
      drawn = skipped = 0;
      last_report = t;
    }
  }
}

void screen_draw_start(void) {
  /* Priority 3: the audio tasks run at 6; a slow decode must not delay them. */
  xTaskCreate(draw_task, "screen_draw", 8192, NULL, 3, NULL);
}
