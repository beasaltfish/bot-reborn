// What each bench part is to buy, in the buyer's words. Data only: the
// electrical facts live in parts.js and catalog.js, and this file never
// argues with them — a spec written here that the hardware docs do not back
// is a bug in this file.
//
// The list has to work for someone in any market, so every line carries
// English keywords first and Chinese second, a rough USD range rather than a
// link, and at least one alternative. `mustMatch` holds only the constraints
// that the repo already documents; an entry that needs a number nobody has
// measured leaves it out instead of guessing.

/** @typedef {{ en: string, zh: string }} Copy */
/** @typedef {{ keywords: Copy, mustMatch: Copy[], priceUsd: [number, number], alternatives: Copy[], note?: Copy }} Purchase */

/** @param {string} en @param {string} zh @returns {Copy} */
const bi = (en, zh) => ({ en, zh });

/** @type {Record<string, Purchase>} */
export const PURCHASE = {
  esp32: {
    keywords: bi('ESP32-S3 DevKitC N16R8 development board', 'ESP32-S3 DevKitC N16R8 开发板'),
    mustMatch: [
      bi('ESP32-S3, not the ESP32 or S3 mini', '要 ESP32-S3，不是 ESP32 或 S3 mini'),
      // The firmware keeps the pet's decoded picture in PSRAM and checks the 16 MB
      // flash size (firmware/sdkconfig.defaults, screen_draw.c). A board without
      // them boots and then leaves the screen blank.
      bi('N16R8: 16 MB flash and 8 MB octal PSRAM', 'N16R8：16 MB flash 与 8 MB 八线 PSRAM'),
      bi('two USB-C ports (USB and UART)', '两个 USB-C 口（USB 与 UART）'),
      bi('headers pre-soldered, with 3V3, 5V, GND, GPIO 4-7 and 8-15', '排针已焊好，有 3V3、5V、GND、GPIO 4-7 与 8-15'),
    ],
    priceUsd: [8, 20],
    alternatives: [bi('any ESP32-S3 devkit with 16 MB flash and 8 MB octal PSRAM', '任何 16 MB flash、8 MB 八线 PSRAM 的 ESP32-S3 开发板')],
    note: bi('Without the PSRAM the pet picture cannot be allocated and the screen stays dark. Flashing needs Chrome or Edge.', '没有 PSRAM 时装不下宠物画面，屏会一直黑着。刷板要 Chrome 或 Edge。'),
  },
  inmp441: {
    keywords: bi('INMP441 I2S microphone module', 'INMP441 I2S 麦克风模块'),
    mustMatch: [
      bi('VDD 3.6 V max: 3V3, never 5 V', 'VDD 上限 3.6 V：接 3V3，不能接 5 V'),
      bi('pins SCK, WS, SD, L/R, VDD, GND', '引脚有 SCK、WS、SD、L/R、VDD、GND'),
      bi('L/R pin to GND (the firmware reads the left slot)', 'L/R 引脚接 GND（固件读左声道）'),
    ],
    priceUsd: [2, 6],
    alternatives: [
      bi('ICS-43434 I2S breakout (3.3 V only)', 'ICS-43434 I2S 模块（只支持 3.3 V）'),
      bi('any I2S mic breakout labelled INMP441/ICS-43434', '任何标 INMP441/ICS-43434 的 I2S 麦克风模块'),
    ],
    note: bi('Bare chips are 1.8 V parts; buy the breakout with the regulator and level shifter.', '裸芯片是 1.8 V 器件；买带稳压和电平转换的模块。'),
  },
  max98357a: {
    keywords: bi('MAX98357A I2S amplifier module', 'MAX98357A I2S 功放模块'),
    mustMatch: [
      bi('pins BCLK, LRC, DIN, GAIN, SD, GND, Vin', '引脚有 BCLK、LRC、DIN、GAIN、SD、GND、Vin'),
      bi('speaker screw terminal', '带喇叭接线端子'),
      bi('Vin 5 V (3V3 also works, quieter)', 'Vin 接 5 V（3V3 也能响，声音小）'),
    ],
    priceUsd: [2, 6],
    alternatives: [bi('MAX98357A breakout from any vendor; the chip name is the spec', '任何厂家的 MAX98357A 模块，认芯片名即可')],
  },
  speaker: {
    keywords: bi('8 ohm 2-3 W small speaker', '8 欧 2-3 W 小喇叭'),
    mustMatch: [
      bi('8 ohm', '8 欧'),
      bi('with flying leads or a JST plug, not solder pads only', '带引线或 JST 插头，不是只有焊盘'),
    ],
    priceUsd: [1, 5],
    alternatives: [bi('any 4-8 ohm speaker from a broken radio; 4 ohm plays louder', '任何拆机 4-8 欧喇叭；4 欧更响')],
  },
  resistor: {
    keywords: bi('1/4 W carbon film resistor assortment', '1/4 W 碳膜电阻包'),
    mustMatch: [
      bi('the two values the build names (220 ohm and 10 kohm)', '要接法里点名的阻值（220 欧与 10 千欧）'),
    ],
    priceUsd: [2, 6],
    alternatives: [bi('metal film of the same value; 1/4 W is enough', '同阻值的金属膜电阻；1/4 W 够用')],
    note: bi('A kit beats single bags: the car needs 10 kohm pull-downs, the LED needs 220 ohm.', '买套包比单买划算：小车要 10 千欧下拉，LED 要 220 欧。'),
  },
  'led-5mm': {
    keywords: bi('5 mm red LED', '5 mm 红色 LED'),
    mustMatch: [bi('through-hole, two legs', '直插、两条腿')],
    priceUsd: [1, 4],
    alternatives: [bi('any 5 mm through-hole LED; red matches the status colour', '任何 5 mm 直插 LED；红色对应状态灯颜色')],
  },
  'push-button': {
    keywords: bi('6x6 mm tactile push button', '6×6 mm 轻触按键'),
    mustMatch: [bi('four legs, through-hole', '四脚直插')],
    priceUsd: [1, 4],
    alternatives: [bi('any momentary tactile switch of the same footprint', '任何同封装的自复位轻触开关')],
  },
  'button-module': {
    keywords: bi('KY-004 button module', 'KY-004 按键模块'),
    mustMatch: [bi('three pins: S, VCC, GND', '三针：S、VCC、GND')],
    priceUsd: [1, 3],
    alternatives: [bi('any 3-pin button breakout', '任何三针按键模块')],
  },
  ssd1306: {
    keywords: bi('SSD1306 0.96 inch I2C OLED 128x64', 'SSD1306 0.96 寸 I2C OLED 128×64'),
    mustMatch: [
      bi('I2C, four pins in the order GND, VCC, SCL, SDA', 'I2C 四针，顺序 GND、VCC、SCL、SDA'),
      bi('VCC 2.7-3.6 V: this is the 3.3 V module, a 5 V-only board is a different one', 'VCC 2.7-3.6 V：这是 3.3 V 模块，只吃 5 V 的是另一种'),
    ],
    priceUsd: [2, 6],
    alternatives: [bi('another SSD1306 128x64 I2C module that the listing rates for 3.3 V', '另一种标称 3.3 V 可用的 SSD1306 128×64 I2C 模块')],
    note: bi('The firmware drives this in the workbench only; the body firmware has no OLED driver yet.', '固件目前只在工作台里驱动它；真板固件还没有 OLED 驱动。'),
  },
  'hc-sr04': {
    keywords: bi('HC-SR04 ultrasonic distance sensor', 'HC-SR04 超声波测距模块'),
    mustMatch: [
      bi('5 V supply', '5 V 供电'),
      bi('ECHO is a 5 V output: needs a divider or level shifter before a GPIO', 'ECHO 输出 5 V：进 GPIO 前要分压或电平转换'),
    ],
    priceUsd: [1, 4],
    alternatives: [bi('HC-SR04P, which works at 3.3 V', 'HC-SR04P，3.3 V 可用')],
  },
  'bme280-i2c': {
    keywords: bi('BME280 I2C breakout 3.3 V', 'BME280 I2C 模块 3.3 V'),
    mustMatch: [
      bi('BME280, not BMP280 (no humidity)', '要 BME280，不是 BMP280（没有湿度）'),
      bi('I2C with an address jumper (0x76/0x77)', 'I2C 带地址跳线（0x76/0x77）'),
    ],
    priceUsd: [3, 10],
    alternatives: [bi('Adafruit 2652 breakout, or any board with pull-ups for 3.3 V', 'Adafruit 2652 模块，或任何按 3.3 V 上拉的模块')],
    note: bi('Breakouts whose pull-ups go to 5 V put 5 V on the ESP32 pins; check before buying.', '上拉接到 5 V 的模块会往 ESP32 引脚灌 5 V；买之前看清。'),
  },
  sg90: {
    keywords: bi('SG90 9g micro servo', 'SG90 9g 微型舵机'),
    mustMatch: [bi('three-wire lead: GND, VCC, SIG', '三线：GND、VCC、SIG')],
    priceUsd: [2, 5],
    alternatives: [bi('SG92R, same wiring, more torque', 'SG92R，接线相同，扭矩更大')],
    note: bi('Stall current is close to a USB port limit; power it from its own 5 V supply.', '堵转电流接近 USB 口上限；用独立的 5 V 供电。'),
  },
  tb6612fng: {
    keywords: bi('TB6612FNG motor driver module', 'TB6612FNG 电机驱动模块'),
    mustMatch: [
      bi('breakout board with VM, VCC, GND, AIN1/AIN2/PWMA/STBY, BIN1/BIN2/PWMB', '模块要有 VM、VCC、GND、AIN1/AIN2/PWMA/STBY、BIN1/BIN2/PWMB'),
      bi('screw terminals for the motors', '电机用接线端子'),
    ],
    priceUsd: [2, 6],
    alternatives: [bi('another TB6612FNG breakout with the same pin order', '另一种引脚顺序相同的 TB6612FNG 模块')],
    note: bi('Never wire the coils to the inputs; the firmware drives the inputs only.', '不要把电机线圈接到输入端；固件只驱动输入端。'),
  },
  'dc-motor-small': {
    keywords: bi('small DC gear motor 3-6 V', '小型直流减速电机 3-6 V'),
    mustMatch: [bi('two leads, 3-6 V', '两线，3-6 V')],
    priceUsd: [2, 6],
    alternatives: [bi('the motor already inside a cheap RC toy', '便宜遥控玩具里原有的电机')],
  },
  'ws2812-strip': {
    keywords: bi('WS2812B LED strip 5 V', 'WS2812B 灯带 5 V'),
    mustMatch: [
      bi('5 V data level: a 3.3 V GPIO may need a level shifter', '数据电平 5 V：3.3 V GPIO 可能需要电平转换'),
      bi('DIN and DOUT pads broken out', 'DIN 与 DOUT 焊盘引出'),
    ],
    priceUsd: [3, 10],
    alternatives: [bi('SK6812 strip, same protocol', 'SK6812 灯带，协议相同')],
    note: bi('Every LED at full white is 60 mA; a long strip needs its own 5 V supply.', '每颗全白 60 mA；长灯带要独立 5 V 电源。'),
  },
  mpu6050: {
    keywords: bi('MPU-6050 GY-521 module', 'MPU-6050 GY-521 模块'),
    mustMatch: [
      bi('I2C, four pins (VCC, GND, SCL, SDA)', 'I2C 四针（VCC、GND、SCL、SDA）'),
      bi('3.3 V logic, module regulator accepts 5 V', '3.3 V 逻辑，模块稳压接受 5 V'),
    ],
    priceUsd: [2, 6],
    alternatives: [bi('another MPU-6050 GY-521 board; clone chips read the same registers', '另一种 MPU-6050 GY-521 模块；克隆芯片寄存器一致')],
    note: bi('Reads on a real board are untested; the wand has only been tried in the workbench.', '真板读数还没试过；签棒只在工作台里验证过。'),
  },
  'battery-4xaa': {
    keywords: bi('4xAA battery holder with leads', '4×AA 电池盒带引线'),
    mustMatch: [bi('four cells in series (6 V alkaline, 4.8 V NiMH)', '四节串联（碱性 6 V，镍氢 4.8 V）')],
    priceUsd: [2, 5],
    alternatives: [bi('any 4-cell holder with flying leads', '任何四节带引线电池盒')],
    note: bi('A TA8050-class toy runs better on 4xAA than on the ESP32 5 V rail.', '遥控玩具用 4×AA 比用 ESP32 的 5 V 更稳。'),
  },
  'breadboard-regulator': {
    keywords: bi('MB102 breadboard power supply module', 'MB102 面包板电源模块'),
    mustMatch: [
      bi('3.3 V and 5 V rails', '有 3.3 V 与 5 V 输出'),
      bi('DC jack or USB input', '有 DC 口或 USB 输入'),
    ],
    priceUsd: [2, 5],
    alternatives: [bi('any breadboard regulator with switchable 3.3/5 V', '任何 3.3/5 V 可切换的面包板电源')],
  },
  toy: {
    keywords: bi('cheap RC toy car with a driver board', '带驱动板的便宜遥控玩具车'),
    mustMatch: [
      bi('its driver board exposes forward/backward/left/right inputs', '驱动板引出前进/后退/左/右输入'),
      bi('room for the ESP32 or a phone on top', '车顶放得下 ESP32 或手机'),
    ],
    priceUsd: [4, 15],
    alternatives: [bi('any toy whose board takes four switch inputs', '任何驱动板吃四路开关输入的玩具')],
    note: bi('Measure the board first: the firmware drives the inputs, never the motor coils.', '先量驱动板：固件驱动输入端，不接电机线圈。'),
  },
  'usb-cable': {
    keywords: bi('USB-C data cable', 'USB-C 数据线'),
    mustMatch: [
      bi('data, not charge-only', '要能传数据，不是纯充电线'),
      bi('USB-C to the port the computer has', 'USB-C 转你电脑上的接口'),
    ],
    priceUsd: [3, 8],
    alternatives: [bi('the cable that came with a phone, if it transfers data', '手机原装线，只要能传数据')],
    note: bi('The board has two USB-C ports: the flashing port is marked USB.', '板子有两个 USB-C 口：刷板用标 USB 的那个。'),
  },
  breadboard: {
    keywords: bi('830 point solderless breadboard', '830 孔免焊面包板'),
    mustMatch: [
      bi('830 tie points, two power rails', '830 孔，两侧电源轨'),
      bi('the same width as the ESP32 header rows, so it straddles the seam', '宽度能跨过两块板之间的缝放 ESP32'),
    ],
    priceUsd: [3, 8],
    alternatives: [bi('two 400 point boards, if the ESP32 still straddles the join', '两块 400 孔板，前提是 ESP32 仍能跨接')],
    note: bi('The audio build needs two: the ESP32 is wider than one board.', '音频这套要两块：ESP32 比一块板宽。'),
  },
  'jumper-wires': {
    keywords: bi('dupont jumper wires male-male and male-female', '杜邦线 公对公 与 公对母'),
    mustMatch: [bi('mixed lengths 10-20 cm', '长短混合 10-20 cm'), bi('at least 40 wires', '至少 40 根')],
    priceUsd: [3, 8],
    alternatives: [bi('solid-core wire cut and stripped by hand', '实心线自己剪剥')],
    note: bi('Short wires matter for I2S: long ones ring and the mic misreads the clock.', 'I2S 的线要短：长线会振铃，麦克风会错读时钟。'),
  },
};

/** Things the bench shows but nobody buys: instruments and virtual parts. */
export const NO_PURCHASE = new Set(['dc-source', 'bench-supply', 'usb-5v-source']);

/** @param {string} partId @returns {Purchase | undefined} */
export function purchaseFor(partId) {
  return Object.hasOwn(PURCHASE, partId) ? PURCHASE[partId] : undefined;
}
