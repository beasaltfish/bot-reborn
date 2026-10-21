#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "board.h"
#include "led.h"

static volatile led_mode_t mode = LED_NO_WIFI;

/* Waits up to ms, but no longer than the mode stays m: a three-second blink
   must not hold back the next state by three seconds. */
static void wait(uint32_t ms, led_mode_t m) {
  for (uint32_t waited = 0; waited < ms && mode == m; waited += 50) vTaskDelay(pdMS_TO_TICKS(50));
}

static void led_task(void *arg) {
  (void)arg;
  for (;;) {
    led_mode_t m = mode;
    led_pattern_t p = led_pattern(m);
    gpio_set_level(LED_GPIO, 1);
    if (p.off_ms == 0) { wait(1000, m); continue; }
    wait(p.on_ms, m);
    gpio_set_level(LED_GPIO, 0);
    wait(p.off_ms, m);
  }
}

void led_start(void) {
  gpio_config_t io = { .pin_bit_mask = 1ULL << LED_GPIO, .mode = GPIO_MODE_OUTPUT };
  gpio_config(&io);
  xTaskCreate(led_task, "led", 2048, NULL, 2, NULL);
}

void led_set(led_mode_t m) { mode = m; }
