#include <math.h>
#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_timer.h"
#include "driver/i2c_master.h"
#include "board.h"
#include "imu.h"
#include "link.h"
#include "shake.h"

#define REG_PWR_MGMT_1 0x6B
#define REG_ACCEL_XOUT 0x3B
#define LSB_PER_G      16384.0f   /* the default +-2 g range */
#define SAMPLE_MS      20         /* 50 Hz */
#define BUS_TIMEOUT_MS 50

/* 0 to 1: how far the pull is from resting 1 g, 2 g being full scale. */
static float level_of(const uint8_t raw[6]) {
  float a[3];
  for (int i = 0; i < 3; i++) a[i] = (float)(int16_t)((raw[2 * i] << 8) | raw[2 * i + 1]) / LSB_PER_G;
  float dev = fabsf(sqrtf(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) - 1.0f) / 2.0f;
  return dev > 1.0f ? 1.0f : dev;
}

static void imu_task(void *arg) {
  (void)arg;
  i2c_master_bus_config_t bus_cfg = {
    .i2c_port = I2C_NUM_0, .sda_io_num = PIN_I2C_SDA, .scl_io_num = PIN_I2C_SCL,
    .clk_source = I2C_CLK_SRC_DEFAULT, .glitch_ignore_cnt = 7,
    .flags.enable_internal_pullup = true,
  };
  i2c_master_bus_handle_t bus;
  i2c_master_dev_handle_t dev;
  i2c_device_config_t dev_cfg = { .dev_addr_length = I2C_ADDR_BIT_LEN_7, .device_address = IMU_ADDR, .scl_speed_hz = 400000 };
  const uint8_t wake[2] = { REG_PWR_MGMT_1, 0 };
  if (i2c_new_master_bus(&bus_cfg, &bus) != ESP_OK
      || i2c_master_bus_add_device(bus, &dev_cfg, &dev) != ESP_OK
      || i2c_master_transmit(dev, wake, sizeof wake, BUS_TIMEOUT_MS) != ESP_OK) {
    printf("wand: no MPU-6050 answered on SDA=%d SCL=%d; shaking is off\n", PIN_I2C_SDA, PIN_I2C_SCL);
    vTaskDelete(NULL);
    return;
  }
  printf("wand: MPU-6050 found\n");

  shake_t shake;
  shake_init(&shake);
  const uint8_t reg = REG_ACCEL_XOUT;
  uint8_t raw[6];
  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(SAMPLE_MS));
    if (i2c_master_transmit_receive(dev, &reg, 1, raw, sizeof raw, BUS_TIMEOUT_MS) != ESP_OK) continue;
    uint32_t now = (uint32_t)(esp_timer_get_time() / 1000);
    if (shake_feed(&shake, level_of(raw), now)) link_send_shake();
  }
}

void imu_start(void) {
  xTaskCreate(imu_task, "imu", 4096, NULL, 4, NULL);
}
