# SSD1306 OLED hardware reference

The selected display is a common 0.96-inch 128×64 monochrome I2C module with a
Solomon SSD1306 controller and four 2.54 mm pins in the order GND, VCC, SCL,
SDA. The board is about 27 × 27 mm. The simulator models a 3.3 V module: VCC
must stay within 2.7–3.6 V, the supply current is modeled at 20 mA and the
panel is treated as ready only when its I2C lines reach the configured bus.

The controller supports 7-bit addresses 0x3c and 0x3d. The selected modules
expose one of them through a solder jumper; the simulator treats the address as
an instance property and does not model the physical jumper. Many clone boards
accept 3.3–5 V through an onboard regulator, and some use a different pin order
or a 7-pin SPI header. Those variants are not modeled, and the simulator does
not assume 5 V tolerance for this selected 4-pin module.

Display state is bounded to off, ready, address conflict and bus fault. A ready
display may hold a blank 128×64 frame; frames are session-only data and are not
saved with the bench. The firmware contract names the `ssd1306` driver, the
configured address and a `drawFrame` action, but the current real firmware does
not implement it. Frame contents are represented as a 1-bit, 128×64 buffer;
the simulator does not model refresh timing, contrast, charge-pump behaviour or
panel ageing.

Sources: [Adafruit 0.96-inch 128×64 OLED](https://www.adafruit.com/product/326),
[SSD1306 datasheet](https://cdn-shop.adafruit.com/datasheets/SSD1306.pdf),
[Adafruit monochrome OLED guide](https://learn.adafruit.com/monochrome-oled-breakouts).
