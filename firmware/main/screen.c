// The pet's screen, set up from a screen_profile. Everything that differs
// between panels (controller, colour order, inversion, orientation, RAM
// offset, SPI mode and clock) is a field of the profile, so a new model is a
// row in the table and not a new code path.
//
// The log is deliberately chatty about what failed: a black panel with the
// backlight on looks the same whether the wires are wrong, the panel refused a
// command, or the pixels were written and never shown.

#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_ili9341.h"
#include "esp_lcd_panel_st7789.h"
#include "esp_lcd_gc9a01.h"
#include "board.h"
#include "screen.h"

#define LCD_HOST SPI2_HOST
/* Pictures are pushed in bands: DMA needs internal RAM, which the audio rings
   share. */
#define BAND_ROWS 16

static esp_lcd_panel_handle_t panel;
static const screen_profile_t *profile;
static volatile bool ready;

/* RGB565 as the panel reads it off the wire: high byte first, so the bytes of
   the little-endian value are swapped. (The JPEG decoder is asked for the same
   order, swap_color_bytes.) */
static uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b) {
  uint16_t v = (uint16_t)(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3));
  return (uint16_t)((v >> 8) | (v << 8));
}

/* Every step's result goes to the log: the first failure is the answer. */
static bool step(const char *what, esp_err_t err) {
  if (err == ESP_OK) return true;
  printf("screen: %s FAILED (%s)\n", what, esp_err_to_name(err));
  return false;
}

bool screen_ready(void) { return ready; }
uint16_t screen_width(void) { return profile ? profile->w : 0; }
uint16_t screen_height(void) { return profile ? profile->h : 0; }

bool screen_draw_band(int y, int rows, const uint16_t *rgb565_rows) {
  if (!ready) return false;
  return esp_lcd_panel_draw_bitmap(panel, 0, y, profile->w, y + rows, rgb565_rows) == ESP_OK;
}

static void fill(uint16_t colour) {
  static uint16_t band[320 * BAND_ROWS];   /* the widest panel in the table */
  for (int i = 0; i < profile->w * BAND_ROWS; i++) band[i] = colour;
  for (int y = 0; y < profile->h; y += BAND_ROWS) {
    int rows = profile->h - y < BAND_ROWS ? profile->h - y : BAND_ROWS;
    if (esp_lcd_panel_draw_bitmap(panel, 0, y, profile->w, y + rows, band) != ESP_OK) {
      printf("screen: draw at y=%d FAILED\n", y);
      return;
    }
  }
}

/* Ask the panel who it is and warn when it is not what was chosen. Only the
   two controllers whose answer is known are checked (ILI9341: 0xD3 → 00 93 41;
   ST7789: 0x04 → 85 85 52). With MISO unplugged the read is noise that matches
   neither, so nothing is said. Never changes anything. */
static void check_identity(esp_lcd_panel_io_handle_t io, controller_t chose) {
  uint8_t id[4] = { 0 };
  if (chose == CTRL_ILI9341) {
    if (esp_lcd_panel_io_rx_param(io, 0xD3, id, sizeof id) != ESP_OK) return;
    bool is9341 = (id[0] == 0x93 && id[1] == 0x41) || (id[1] == 0x93 && id[2] == 0x41);
    bool is7789 = (id[0] == 0x85 && id[1] == 0x85) || (id[1] == 0x85 && id[2] == 0x85);
    if (is7789) printf("screen: you chose an ILI9341 but the panel answers like an ST7789 (%02x %02x %02x %02x)\n", id[0], id[1], id[2], id[3]);
    else if (is9341) printf("screen: panel identifies as an ILI9341, as chosen\n");
  } else if (chose == CTRL_ST7789) {
    if (esp_lcd_panel_io_rx_param(io, 0x04, id, sizeof id) != ESP_OK) return;
    bool is7789 = (id[0] == 0x85 && id[1] == 0x85) || (id[1] == 0x85 && id[2] == 0x85);
    bool is9341 = (id[0] == 0x93 && id[1] == 0x41) || (id[1] == 0x93 && id[2] == 0x41);
    if (is9341) printf("screen: you chose an ST7789 but the panel answers like an ILI9341 (%02x %02x %02x %02x)\n", id[0], id[1], id[2], id[3]);
    else if (is7789) printf("screen: panel identifies as an ST7789, as chosen\n");
  }
}

static void test_task(void *arg) {
  (void)arg;
  static const struct { uint8_t r, g, b; } colours[] = {
    { 255, 255, 255 }, { 255, 0, 0 }, { 0, 255, 0 }, { 0, 0, 255 },
  };
  for (size_t i = 0; i < sizeof colours / sizeof colours[0]; i++) {
    fill(rgb565(colours[i].r, colours[i].g, colours[i].b));
    vTaskDelay(pdMS_TO_TICKS(400));
  }
  fill(0);
  ready = true;
  printf("screen: ready\n");
  vTaskDelete(NULL);
}

void screen_start(const screen_profile_t *p) {
  profile = p;
  printf("screen: %s (%ux%u, %s)\n", p->label, p->w, p->h, p->verified ? "verified" : "unverified");

  spi_bus_config_t bus = {
    .sclk_io_num = PIN_LCD_SCK,
    .mosi_io_num = PIN_LCD_MOSI,
    .miso_io_num = PIN_LCD_MISO,   /* only for check_identity */
    .quadwp_io_num = -1,
    .quadhd_io_num = -1,
    .max_transfer_sz = p->w * BAND_ROWS * sizeof(uint16_t),
  };
  if (!step("spi bus", spi_bus_initialize(LCD_HOST, &bus, SPI_DMA_CH_AUTO))) return;

  esp_lcd_panel_io_spi_config_t cfg = {
    .cs_gpio_num = PIN_LCD_CS,
    .dc_gpio_num = PIN_LCD_DC,
    .spi_mode = p->spi_mode,
    .pclk_hz = p->pclk_hz,
    .trans_queue_depth = 10,
    .lcd_cmd_bits = 8,
    .lcd_param_bits = 8,
  };
  esp_lcd_panel_io_handle_t io = NULL;
  if (!step("panel io", esp_lcd_new_panel_io_spi((esp_lcd_spi_bus_handle_t)LCD_HOST, &cfg, &io))) return;

  esp_lcd_panel_dev_config_t dev = {
    .rgb_ele_order = p->bgr ? LCD_RGB_ELEMENT_ORDER_BGR : LCD_RGB_ELEMENT_ORDER_RGB,
    .bits_per_pixel = 16,
    .reset_gpio_num = PIN_LCD_RST,
  };
  /* Argument order is 2.x's (io first). */
  switch (p->controller) {
    case CTRL_ILI9341:
      if (!step("panel (ili9341)", esp_lcd_new_panel_ili9341(io, &dev, &panel))) return;
      break;
    case CTRL_ST7789:
      if (!step("panel (st7789)", esp_lcd_new_panel_st7789(io, &dev, &panel))) return;
      break;
    case CTRL_GC9A01:
      if (!step("panel (gc9a01)", esp_lcd_new_panel_gc9a01(io, &dev, &panel))) return;
      break;
    default:
      printf("screen: this firmware has no driver for %s yet\n", p->label);
      return;
  }

  step("reset", esp_lcd_panel_reset(panel));
  check_identity(io, p->controller);
  step("init", esp_lcd_panel_init(panel));
  step("invert", esp_lcd_panel_invert_color(panel, p->invert));
  step("swap_xy", esp_lcd_panel_swap_xy(panel, p->swap_xy));
  step("mirror", esp_lcd_panel_mirror(panel, p->mirror_x, p->mirror_y));
  if (p->gap_x || p->gap_y) step("gap", esp_lcd_panel_set_gap(panel, p->gap_x, p->gap_y));
  step("display on", esp_lcd_panel_disp_on_off(panel, true));

  /* SCK is the header pin next to the I2S BCLK. At full drive its 20 MHz
     edges couple into that jumper wire: a clock glitch leaves silence alone
     (zeros shift to zeros) and breaks every real sample, which is the crackle
     heard only while it speaks. The weakest drive slows the edges. */
  const int outputs[] = { PIN_LCD_SCK, PIN_LCD_MOSI, PIN_LCD_CS, PIN_LCD_DC };
  for (size_t i = 0; i < sizeof outputs / sizeof outputs[0]; i++) gpio_set_drive_capability(outputs[i], GPIO_DRIVE_CAP_0);

  /* Priority 3: the audio tasks run at 6, and the display must never starve
     the I2S rings (spec §6.4). */
  xTaskCreate(test_task, "screen", 4096, NULL, 3, NULL);
}
