// First light for the pet's screen: SPI up, panel initialised, white / red /
// green / blue in a loop. The frames the brain streams arrive in the next
// step; this exists so a wrong controller, a mirrored panel or swapped colour
// channels is found in one flash instead of being argued about.
//
// It is deliberately talkative. A black panel with the backlight on looks the
// same whether the wires are wrong, the panel refused a command, or the pixels
// were written and never displayed, and the log is the only place that
// difference exists. It also asks the panel who it is (0x04) over a range of
// SPI modes and clocks, because a read sampled on the wrong clock edge comes
// back as plausible-looking garbage — 80 00 00 00, say — and that is a guess
// the firmware can settle by itself.

#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_ili9341.h"
#include "esp_lcd_panel_st7789.h"
#include "board.h"
#include "screen.h"

#define LCD_HOST SPI2_HOST
/* The fastest clock we will try. The panel will take 40 MHz, but these are
   jumper wires: raise it only after the picture is right. */
#define LCD_PCLK_HZ (20 * 1000 * 1000)
/* Colour is pushed in bands, not one 150 kB frame: internal RAM is for the
   audio rings until PSRAM is turned on for the JPEG buffers. */
#define BAND_ROWS 16

/* Which controller the panel claims to be. Decided from its own answer when
   it gives one, so a cheap 2.0" ST7789 works without a recompile. */
enum { PANEL_UNKNOWN, PANEL_ILI9341, PANEL_ST7789 };

static esp_lcd_panel_handle_t panel;
static uint16_t band[LCD_W * BAND_ROWS];
/* NULL when every step succeeded; otherwise the step that did not. Repeated
   in every cycle's log line, because the native-USB console loses the first
   seconds of a boot and the bring-up answer must not live there. */
static const char *init_failure;
/* The panel's answer to "who are you", kept as text for the same reason. */
static char panel_id[96] = "not asked";
/* Which mode/clock answered, for the "up" line. */
static const char *chosen;
/* Did the GPIO10-GPIO17 jumper read back? Printed in every cycle line for the
   same reason as the ID: the boot log's first seconds are lost. */
static bool loopback;

/* Is the ESP32's own SPI path alive? With a jumper from GPIO 10 (MOSI) to
   GPIO 17 (MISO) and the panel's MISO wire removed, this reads back what it
   writes. It answers the one question no amount of looking at the panel can:
   is the silence here, or in the module? Harmless without the jumper — the
   panel's MISO is tri-state when idle, so the reads simply do not match. */
static bool probe_loopback(void) {
  gpio_config_t out = { .pin_bit_mask = 1ULL << PIN_LCD_MOSI, .mode = GPIO_MODE_OUTPUT };
  gpio_config_t in = { .pin_bit_mask = 1ULL << PIN_LCD_MISO, .mode = GPIO_MODE_INPUT,
                       .pull_down_en = GPIO_PULLDOWN_ENABLE };
  gpio_config(&out);
  gpio_config(&in);
  bool ok = true;
  for (int i = 0; i < 8; i++) {
    int level = i & 1;
    gpio_set_level(PIN_LCD_MOSI, level);
    vTaskDelay(pdMS_TO_TICKS(2));
    if (gpio_get_level(PIN_LCD_MISO) != level) ok = false;
  }
  gpio_reset_pin(PIN_LCD_MOSI);
  gpio_reset_pin(PIN_LCD_MISO);
  return ok;
}

static uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b) {
  return (uint16_t)(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3));
}

/** Every step's result goes to the log: the first failure is the answer. */
static bool step(const char *what, esp_err_t err) {
  if (err == ESP_OK) {
    printf("screen: %s ok\n", what);
    return true;
  }
  printf("screen: %s FAILED (%s)\n", what, esp_err_to_name(err));
  if (init_failure == NULL) init_failure = what;
  return false;
}

static void fill(uint16_t colour) {
  for (int i = 0; i < LCD_W * BAND_ROWS; i++) band[i] = colour;
  for (int y = 0; y < LCD_H; y += BAND_ROWS) {
    esp_err_t err = esp_lcd_panel_draw_bitmap(panel, 0, y, LCD_W, y + BAND_ROWS, band);
    /* One line per colour, not 15: the first failure is the one that matters. */
    if (err != ESP_OK) {
      printf("screen: draw at y=%d FAILED (%s)\n", y, esp_err_to_name(err));
      return;
    }
  }
}

/** @param id 4 bytes from RDDID; the pair 93 41 is an ILI9341, 85 52 an ST7789. */
static bool id_is_ili9341(const uint8_t id[4]) {
  for (int i = 0; i < 3; i++) if (id[i] == 0x93 && id[i + 1] == 0x41) return true;
  return false;
}

/** ST7789 answers 0x04 with 85 85 52 (or 00 85 85 with the leading byte cut). */
static bool id_is_st7789(const uint8_t id[4]) {
  for (int i = 0; i < 3; i++) if (id[i] == 0x85 && id[i + 1] == 0x85) return true;
  return false;
}

static void describe_id(const char *how, const uint8_t id[4], esp_err_t err) {
  if (err != ESP_OK) {
    snprintf(panel_id, sizeof panel_id, "%s: read failed (%s)", how, esp_err_to_name(err));
  } else {
    const char *name = "";
    for (int i = 0; i < 3; i++) {
      if (id[i] == 0x93 && id[i + 1] == 0x41) name = " ILI9341";
      else if (id[i] == 0x85 && id[i + 1] == 0x85) name = " ST7789?";
    }
    snprintf(panel_id, sizeof panel_id, "%s: %02x %02x %02x %02x%s", how,
             id[0], id[1], id[2], id[3], name);
  }
  printf("screen: id %s\n", panel_id);
}

static void screen_task(void *arg) {
  (void)arg;
  /* The colours are converted here, not in the table: rgb565() is a function
     call, and a file-scope table's initialiser has to be constant. */
  static const struct { const char *name; uint8_t r, g, b; } steps[] = {
    { "white", 255, 255, 255 }, { "red", 255, 0, 0 },
    { "green", 0, 255, 0 }, { "blue", 0, 0, 255 },
  };
  /* 20 cycles, ~4 s each. Bring-up only: long enough to probe a pin with a
     meter or attach the monitor late, short enough that an idle board stops
     shouting. Replaced when frames arrive. */
  for (int cycle = 1; cycle <= 20; cycle++) {
    printf("screen: cycle %d, init %s, loop %s, id %s\n", cycle,
           init_failure ? init_failure : "ok", loopback ? "ok" : "no-jumper", panel_id);
    for (size_t i = 0; i < sizeof steps / sizeof steps[0]; i++) {
      fill(rgb565(steps[i].r, steps[i].g, steps[i].b));
      vTaskDelay(pdMS_TO_TICKS(1000));
    }
  }
  printf("screen: colour test done — cycles over, holding blue\n");
  vTaskDelete(NULL);
}

void screen_start(void) {
  /* Before SPI owns the pins: with a GPIO10-GPIO17 jumper this says whether
     the board's SPI path works at all. */
  loopback = probe_loopback();
  printf("screen: loopback %s\n", loopback ? "ok (MOSI-MISO jumper)" : "no jumper");

  spi_bus_config_t bus = {
    .sclk_io_num = PIN_LCD_SCK,
    .mosi_io_num = PIN_LCD_MOSI,
    .miso_io_num = PIN_LCD_MISO, /* only for the ID read below */
    .quadwp_io_num = -1,
    .quadhd_io_num = -1,
    .max_transfer_sz = LCD_W * BAND_ROWS * sizeof(uint16_t),
  };
  if (!step("spi bus", spi_bus_initialize(LCD_HOST, &bus, SPI_DMA_CH_AUTO))) return;

  /* The panel's power-on reset takes ~120 ms; reading before it is done is
     another way to get an answer that means nothing. */
  vTaskDelay(pdMS_TO_TICKS(150));

  esp_lcd_panel_io_handle_t io = NULL;
  /* Set from the winning read, below. Two of these panels are sold as "2.8
     TFT" and one of them answers 85 85 52, not 93 41. */
  int want = PANEL_UNKNOWN;
  static const struct { int mode; unsigned hz; const char *how; } tries[] = {
    { 0, 1000000, "mode0 1MHz" }, { 3, 1000000, "mode3 1MHz" },
    { 0, 10000000, "mode0 10MHz" }, { 3, 10000000, "mode3 10MHz" },
    { 0, LCD_PCLK_HZ, "mode0 20MHz" }, { 3, LCD_PCLK_HZ, "mode3 20MHz" },
  };
  for (size_t i = 0; i < sizeof tries / sizeof tries[0]; i++) {
    esp_lcd_panel_io_spi_config_t cfg = {
      .cs_gpio_num = PIN_LCD_CS,
      .dc_gpio_num = PIN_LCD_DC,
      .spi_mode = tries[i].mode,
      .pclk_hz = tries[i].hz,
      .trans_queue_depth = 10,
      .lcd_cmd_bits = 8,
      .lcd_param_bits = 8,
    };
    esp_lcd_panel_io_handle_t candidate = NULL;
    esp_err_t err = esp_lcd_new_panel_io_spi((esp_lcd_spi_bus_handle_t)LCD_HOST, &cfg, &candidate);
    if (err != ESP_OK) {
      snprintf(panel_id, sizeof panel_id, "%s: panel io FAILED (%s)", tries[i].how, esp_err_to_name(err));
      printf("screen: id %s\n", panel_id);
      continue;
    }
    uint8_t id[4] = { 0 };
    err = esp_lcd_panel_io_rx_param(candidate, 0x04, id, sizeof id);
    describe_id(tries[i].how, id, err);
    if (err == ESP_OK && (id_is_ili9341(id) || id_is_st7789(id))) {
      want = id_is_ili9341(id) ? PANEL_ILI9341 : PANEL_ST7789;
      io = candidate;
      chosen = tries[i].how;
      break;
    }
    esp_lcd_panel_io_del(candidate);
  }

  if (io == NULL) {
    /* Nothing answered with an ID. Keep going anyway on the plainest settings,
       so the picture is still attempted — a panel whose MISO is not wired can
       still be an ILI9341, and the scan above is the finding. */
    esp_lcd_panel_io_spi_config_t cfg = {
      .cs_gpio_num = PIN_LCD_CS,
      .dc_gpio_num = PIN_LCD_DC,
      .spi_mode = 0,
      .pclk_hz = 10000000,
      .trans_queue_depth = 10,
      .lcd_cmd_bits = 8,
      .lcd_param_bits = 8,
    };
    chosen = "mode0 10MHz (fallback)";
    if (!step("panel io", esp_lcd_new_panel_io_spi((esp_lcd_spi_bus_handle_t)LCD_HOST, &cfg, &io))) return;
  }

  esp_lcd_panel_dev_config_t dev = {
    .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_BGR,
    .bits_per_pixel = 16,
    .reset_gpio_num = PIN_LCD_RST,
  };
  /* Argument order is 2.x's (io first). 1.x had it the other way round. */
  if (want == PANEL_ST7789) {
    if (!step("panel (st7789)", esp_lcd_new_panel_st7789(io, &dev, &panel))) return;
  } else if (!step("panel (ili9341)", esp_lcd_new_panel_ili9341(io, &dev, &panel))) return;

  step("reset", esp_lcd_panel_reset(panel));
  step("init", esp_lcd_panel_init(panel));
  /* These panels are sold with the inversion on; without it every colour is
     its negative. Flipping it is the first thing to try if red looks cyan. */
  step("invert", esp_lcd_panel_invert_color(panel, true));
  /* Landscape: the panel is native 240x320 portrait. */
  step("swap_xy", esp_lcd_panel_swap_xy(panel, true));
  step("mirror", esp_lcd_panel_mirror(panel, true, false));
  step("display on", esp_lcd_panel_disp_on_off(panel, true));

  printf("screen: %s %dx%d up via %s, colour test (invert=on swap_xy=on mirror=on,off)\n",
         want == PANEL_ST7789 ? "ST7789" : want == PANEL_ILI9341 ? "ILI9341" : "unknown panel",
         LCD_W, LCD_H, chosen);
  /* Priority 3: the audio tasks run at 6, and the display must never starve
     the I2S rings (spec §6.4). */
  xTaskCreate(screen_task, "screen", 4096, NULL, 3, NULL);
}
