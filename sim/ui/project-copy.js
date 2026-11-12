// The legacy targets own the canonical English reasons. Translation is keyed
// by that source text so inserting optional links cannot shift explanations.
/** @type {Record<string, string>} */
const ZH = {
  'Power the breakout at 3.3 V so its I2C pull-ups match the ESP32 logic.': '使用 3.3 V 为模块供电，使 I2C 上拉电压与 ESP32 逻辑电压匹配。',
  'Share ground between the sensor and controller.': '传感器与控制器共地。',
  'Connect SDI to the configured I2C data line.': '将 SDI 连接到配置的 I2C 数据线。',
  'Connect SCK to the configured I2C clock line.': '将 SCK 连接到配置的 I2C 时钟线。',
  'Connect the positive supply to the current-limiting resistor.': '将电源正极连接到限流电阻。',
  'Connect the resistor to the LED anode.': '将电阻连接到 LED 阳极。',
  'Connect the LED cathode to the source return to complete the loop.': '将 LED 阴极连接到电源回流端，形成闭合回路。',
  'The battery pack feeds the regulator input.': '电池盒为稳压模块输入端供电。',
  'Connect the pack return to the regulator ground.': '将电池盒负极接到稳压模块地。',
  'The regulated rail feeds the current-limiting resistor.': '稳压后的电源轨为限流电阻供电。',
  'The resistor feeds the LED anode.': '电阻连接到 LED 阳极。',
  'The LED cathode returns to the regulator ground.': 'LED 阴极回到稳压模块地。',
  'The mic is rated 3.6 V at most, so it takes 3V3, not 5V.': '麦克风额定电压最高为 3.6 V，因此应接 3V3，不能接 5V。',
  'The mic needs a ground shared with the ESP32.': '麦克风需要与 ESP32 共地。',
  'With L/R low the mic talks in the left slot, which is the one the firmware reads.': 'L/R 接低电平时麦克风使用左声道时隙，固件读取的正是该时隙。',
  'The ESP32 clocks the mic bit by bit on BCLK, GPIO 12.': 'ESP32 通过 GPIO 12 上的 BCLK 逐位为麦克风提供时钟。',
  'The word-select line, GPIO 13, tells the mic which slot is being read.': 'GPIO 13 上的字选择信号告诉麦克风正在读取哪个时隙。',
  'The mic sends its samples to the ESP32 on GPIO 15.': '麦克风通过 GPIO 15 将采样数据发送给 ESP32。',
  'The amp runs on 5V on this build; 3V3 works too, only quieter.': '此接法使用 5V 为功放供电；3V3 也可以，但声音较小。',
  'The amp needs a ground shared with the ESP32.': '功放需要与 ESP32 共地。',
  'The amp shares the bit clock with the mic, so BCLK fans out to both.': '功放与麦克风共享位时钟，因此 BCLK 同时连接两者。',
  'The amp shares the word-select line with the mic, so GPIO 13 goes to both.': '功放与麦克风共享字选择信号，因此 GPIO 13 同时连接两者。',
  'The ESP32 sends the sound to play to the amp on GPIO 14.': 'ESP32 通过 GPIO 14 将待播放的音频数据发送给功放。',
  'The speaker goes through the amp screw terminal, plus to plus.': '扬声器通过功放的螺丝端子连接，正极接正极。',
  'The speaker goes through the amp screw terminal, minus to minus.': '扬声器通过功放的螺丝端子连接，负极接负极。',
  "The wand runs on 3V3 here, the same supply as the ESP32's own pins.": '此处手杖使用 3V3 供电，与 ESP32 引脚的电源一致。',
  'The wand needs a ground shared with the ESP32.': '手杖需要与 ESP32 共地。',
  'I2C data goes on GPIO 1, so the ESP32 can ask the wand how hard it is being shaken.': 'I2C 数据线接 GPIO 1，让 ESP32 读取手杖的摇动情况。',
  'The I2C clock goes on GPIO 2.': 'I2C 时钟线接 GPIO 2。',
  "The wheel driver U3 takes input A here (it was the FT232H's D4).": '车轮驱动器 U3 的输入 A 接此处（原来接 FT232H 的 D4）。',
  'U3 input B: one of these two high is forward, the other backward (D5).': 'U3 输入 B：两个输入分别拉高时对应前进和后退（D5）。',
  'The steering driver U5 takes input A on this pin, never on its coil (D6).': '此引脚连接转向驱动器 U5 的输入 A，切勿接到线圈上（D6）。',
  'U5 input B: one side of the axle or the other (D7).': 'U5 输入 B：控制车轴向另一侧转动（D7）。',
  "Both boards must share one ground, or the ESP32's high and low mean nothing to the toy.": '两块板必须共地，否则玩具无法正确理解 ESP32 的高低电平。',
  'The panel is clocked on GPIO 11.': '屏幕时钟连接 GPIO 11。',
  'The picture reaches the panel on GPIO 10.': '图像数据通过 GPIO 10 发送到屏幕。',
  'Chip select is GPIO 9: the firmware drives the panel it finds there, and only one kind.': '片选连接 GPIO 9：固件驱动连接到这里的屏幕，且一次只支持一种型号。',
  'GPIO 8 tells the panel whether a byte is a pixel or an order.': 'GPIO 8 告诉屏幕收到的是像素数据还是命令。',
  'GPIO 18 resets the panel, so the firmware can start it from scratch.': 'GPIO 18 用于复位屏幕，以便固件重新初始化。',
  'This module has its own regulator, so 5V is what it wants.': '此模块自带稳压器，需要使用 5V 供电。',
  "The panel needs the ESP32's ground.": '屏幕需要与 ESP32 共地。',
  "The backlight is lit from 3V3; the board's own pull-up can do it, but a wire is sure.": '背光由 3V3 点亮；板载上拉也可能使其点亮，但接线更可靠。',
  'This module takes 3V3 only; 5V would burn it.': '此模块只能使用 3V3 供电，5V 会将其烧毁。',
};

/** @param {string} lang @param {string} reason @returns {string | null} */
export function projectReason(lang, reason) {
  return lang === 'zh' ? ZH[reason] ?? null : reason;
}
