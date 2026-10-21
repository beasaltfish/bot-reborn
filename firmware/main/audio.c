#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "driver/i2s_std.h"
#include "board.h"
#include "link.h"
#include "pcm.h"
#include "playbuf.h"
#include "audio.h"

#define RATE 16000
#define MIC_BLOCK 1600   /* 100 ms, what the brain cuts frames into anyway */
#define DMA_FRAMES 240   /* 15 ms a DMA buffer */
#define DMA_BUFFERS 6    /* 90 ms each way: the speaker's whole latency, well
                            under the brain's ECHO_SLACK_MS of 300 */

static i2s_chan_handle_t tx, rx;
static playbuf_t buffer;
static SemaphoreHandle_t lock;

static void mic_task(void *arg) {
  (void)arg;
  static int32_t raw[MIC_BLOCK];
  static int16_t pcm[MIC_BLOCK];
  for (;;) {
    size_t got = 0;
    if (i2s_channel_read(rx, raw, sizeof raw, &got, portMAX_DELAY) != ESP_OK) continue;
    size_t n = got / sizeof raw[0];
    pcm_from_i2s32(raw, pcm, n, MIC_SHIFT);
    link_send_audio(pcm, n);   /* not welcomed or too slow: this block is dropped */
  }
}

static void speaker_task(void *arg) {
  (void)arg;
  static int16_t pcm[DMA_FRAMES];
  static int32_t out[DMA_FRAMES];
  for (;;) {
    xSemaphoreTake(lock, portMAX_DELAY);
    playbuf_read(&buffer, pcm, DMA_FRAMES);   /* silence when empty */
    xSemaphoreGive(lock);
    pcm_to_i2s32(pcm, out, DMA_FRAMES);
    size_t written;
    i2s_channel_write(tx, out, sizeof out, &written, portMAX_DELAY);
  }
}

void audio_start(void) {
  lock = xSemaphoreCreateMutex();
  playbuf_clear(&buffer);

  i2s_chan_config_t chan = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
  chan.dma_desc_num = DMA_BUFFERS;
  chan.dma_frame_num = DMA_FRAMES;
  chan.auto_clear = true;
  i2s_std_config_t std = {
    .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(RATE),
    /* 32-bit slots: the INMP441 needs 64 clocks a frame. Mono, left slot;
       the INMP441's L/R pin goes to GND. */
    .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_MONO),
    .gpio_cfg = {
      .mclk = I2S_GPIO_UNUSED,
      .bclk = PIN_I2S_BCLK,
      .ws = PIN_I2S_WS,
      .dout = PIN_I2S_DOUT,
      .din = PIN_I2S_DIN,
    },
  };
  esp_err_t err = i2s_new_channel(&chan, &tx, &rx);
  if (err == ESP_OK) err = i2s_channel_init_std_mode(tx, &std);
  if (err == ESP_OK) err = i2s_channel_init_std_mode(rx, &std);
  if (err == ESP_OK) err = i2s_channel_enable(tx);
  if (err == ESP_OK) err = i2s_channel_enable(rx);
  if (err != ESP_OK) {
    printf("audio off: I2S would not start (%s)\n", esp_err_to_name(err));
    return;
  }
  xTaskCreate(mic_task, "mic", 4096, NULL, 6, NULL);
  xTaskCreate(speaker_task, "speaker", 4096, NULL, 6, NULL);
}

void audio_play_bytes(const uint8_t *bytes, size_t n) {
  if (!lock) return;
  xSemaphoreTake(lock, portMAX_DELAY);
  playbuf_write_bytes(&buffer, bytes, n);
  xSemaphoreGive(lock);
}

void audio_hush(void) {
  if (!lock) return;
  xSemaphoreTake(lock, portMAX_DELAY);
  playbuf_clear(&buffer);
  xSemaphoreGive(lock);
}
