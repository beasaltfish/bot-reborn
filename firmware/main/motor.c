#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "esp_timer.h"
#include "board.h"
#include "motor.h"

static const gpio_num_t PINS[4] = {PIN_DRIVE_A, PIN_DRIVE_B, PIN_STEER_A, PIN_STEER_B};

static portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
static motion_t motion;
static const calib_t *calib;
static uint8_t level[4];   /* what the pins are now; only the motor task writes */

static uint32_t now_ms(void) { return (uint32_t)(esp_timer_get_time() / 1000); }

/* Lows first, then highs: halfway through a change no pair is both high. */
static void write(const uint8_t want[4]) {
  for (int i = 0; i < 4; i++) if (!want[i] && level[i]) { gpio_set_level(PINS[i], 0); level[i] = 0; }
  for (int i = 0; i < 4; i++) if (want[i] && !level[i]) { gpio_set_level(PINS[i], 1); level[i] = 1; }
}

static void motor_task(void *arg) {
  (void)arg;
  TickType_t wake = xTaskGetTickCount();
  for (;;) {
    drive_t d;
    steer_t s;
    portENTER_CRITICAL(&mux);
    motion_now(&motion, now_ms(), &d, &s);
    portEXIT_CRITICAL(&mux);
    uint8_t want[4];
    motor_levels(d, s, *calib, want);
    write(want);
    vTaskDelayUntil(&wake, pdMS_TO_TICKS(10));   /* one tick at the default 100 Hz */
  }
}

void motor_init(void) {
  for (int i = 0; i < 4; i++) gpio_set_level(PINS[i], 0);
  gpio_config_t io = {
    .pin_bit_mask = (1ULL << PIN_DRIVE_A) | (1ULL << PIN_DRIVE_B) | (1ULL << PIN_STEER_A) | (1ULL << PIN_STEER_B),
    .mode = GPIO_MODE_OUTPUT,
    .pull_down_en = GPIO_PULLDOWN_ENABLE,
  };
  gpio_config(&io);
  for (int i = 0; i < 4; i++) gpio_set_level(PINS[i], 0);
}

void motor_start(const calib_t *c) {
  calib = c;
  xTaskCreate(motor_task, "motor", 2048, NULL, 7, NULL);
}

void motor_move(drive_t d, steer_t s, int ms) {
  portENTER_CRITICAL(&mux);
  motion_move(&motion, d, s, ms, now_ms());
  portEXIT_CRITICAL(&mux);
}

void motor_stop(void) {
  portENTER_CRITICAL(&mux);
  motion_stop(&motion);
  portEXIT_CRITICAL(&mux);
}
