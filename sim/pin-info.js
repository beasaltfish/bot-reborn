// Human-readable pin descriptions for the devices currently on the bench.
/** @type {Record<string, string>} */
const EN = {
  GND: 'Common ground reference shared with the controller.',
  VCC: 'Power input. Check the module supply requirements before connecting it.',
  VDD: 'Power input for the microphone. Use 3.3 V in this build.',
  Vin: 'Amplifier power input. This build uses 5 V.',
  SDA: 'I²C data line, shared with other compatible I²C devices.',
  SCL: 'I²C clock line, shared with other compatible I²C devices.',
  BCLK: 'I²S bit clock input.', LRC: 'I²S word-select clock input.',
  DIN: 'I²S audio data input.', WS: 'I²S word-select clock input.',
  SD: 'Data or shutdown pin. Its function depends on the module.',
  SCK: 'Clock signal. The connected device and protocol determine its use.',
  MOSI: 'SPI data sent from the controller to the display.',
  MISO: 'SPI data sent from the module to the controller.',
  CS: 'SPI chip select. Selects the module receiving commands.',
  DC: 'Display control: distinguishes commands from pixel data.',
  RST: 'Reset input for initializing the device.',
  BL: 'Display backlight control or power input.',
  'L/R': 'Selects the I²S microphone channel. Ground selects the left channel.',
  GAIN: 'Amplifier gain selection input.',
  '3V3': '3.3 V supply pin on the controller board.',
  '5V': '5 V supply pin on the controller board.',
  U3A: 'Wheel driver input A.', U3B: 'Wheel driver input B.',
  U5A: 'Steering driver input A.', U5B: 'Steering driver input B.',
};

/** @type {Record<string, string>} */
const ZH = {
  GND: '公共地线，与控制器共享参考电位。', VCC: '电源输入，接线前请确认模块的供电要求。',
  VDD: '麦克风电源输入，本项目使用 3.3 V。', Vin: '功放电源输入，本项目使用 5 V。',
  SDA: 'I²C 数据线，可由兼容的 I²C 器件共享。', SCL: 'I²C 时钟线，可由兼容的 I²C 器件共享。',
  BCLK: 'I²S 位时钟输入。', LRC: 'I²S 字选择时钟输入。', DIN: 'I²S 音频数据输入。', WS: 'I²S 字选择时钟输入。',
  SD: '数据或关断引脚，具体功能取决于模块。', SCK: '时钟信号，用途取决于连接的器件和协议。',
  MOSI: '从控制器发送到显示屏的 SPI 数据。', MISO: '从模块发送到控制器的 SPI 数据。',
  CS: 'SPI 片选，选择接收命令的模块。', DC: '显示屏控制引脚，用于区分命令和像素数据。',
  RST: '复位输入，用于初始化器件。', BL: '显示屏背光控制或供电输入。',
  'L/R': '选择 I²S 麦克风声道，接地选择左声道。', GAIN: '功放增益选择输入。',
  '3V3': '控制板上的 3.3 V 电源引脚。', '5V': '控制板上的 5 V 电源引脚。',
  U3A: '行驶电机驱动输入 A。', U3B: '行驶电机驱动输入 B。',
  U5A: '转向驱动输入 A。', U5B: '转向驱动输入 B。',
};

/** @type {Record<string, Record<string, string>>} */
const BME280 = {
  en: { VIN: 'Power input, 3–5 V. Match the controller logic voltage.', '3Vo': 'Regulated 3.3 V output, not a power input.', GND: 'Common ground for power and logic.', SCK: 'I²C clock (SCL); also the SPI clock.', SDI: 'I²C data (SDA); also the SPI data input.', SDO: 'Address selection: default 0x77; connect to ground for 0x76.', CS: 'SPI chip select; leave unconnected for I²C.' },
  zh: { VIN: '电源输入，3–5 V；应与控制器逻辑电压一致。', '3Vo': '稳压后的 3.3 V 输出，不是电源输入。', GND: '电源与逻辑共用的地线。', SCK: 'I²C 时钟（SCL），也可作为 SPI 时钟。', SDI: 'I²C 数据（SDA），也可作为 SPI 数据输入。', SDO: '地址选择：默认 0x77，接地选择 0x76。', CS: 'SPI 片选；使用 I²C 时无需连接。' },
};

/** @param {string} partId @param {{name:string,role?:string,wireOnly?:boolean}} pin @param {string} [lang] */
export function pinDescription(partId, pin, lang = 'en') {
  const role = pin.role ?? pin.name.replace(/\.\d+$/, '');
  if (partId === 'bme280-i2c' && BME280[lang === 'zh' ? 'zh' : 'en'][role]) return BME280[lang === 'zh' ? 'zh' : 'en'][role];
  if (partId === 'hc-sr04') {
    const copy = lang === 'zh'
      ? { VCC: '5 V 模块电源输入。', TRIG: '测距触发输入；3.3 V 触发兼容性尚未确认。', ECHO: '5 V 回波输出；不能直接接 3.3 V GPIO，需合适的电平转换。', GND: '电源与逻辑共用地线。' }
      : { VCC: '5 V module supply input.', TRIG: 'Ranging trigger input; 3.3 V trigger compatibility is not established.', ECHO: '5 V echo output; do not connect directly to a 3.3 V GPIO. Use suitable level shifting.', GND: 'Common ground for supply and logic.' };
    if (Object.hasOwn(copy, role)) return /** @type {Record<string,string>} */ (copy)[role];
  }
  if (lang === 'zh') {
    if (partId === 'dc-source' && pin.name === '+') return '直流电源正极输出；电压相对于负极设定。';
    if (partId === 'dc-source' && pin.name === '-') return '直流电源负极或回流端，不一定是大地或控制板地。';
    if (partId === 'led-5mm' && pin.name === 'A') return 'LED 正极，连接到电源正极方向。';
    if (partId === 'led-5mm' && pin.name === 'K') return 'LED 负极，连接到电源负极方向。';
    if (partId === 'inmp441' && pin.name === 'SD') return 'I²S 麦克风音频数据输出。';
    if (partId === 'max98357a' && pin.name === 'SD') return '功放关断控制，低电平时关闭。';
    if (partId === 'max98357a' && (pin.name === '+' || pin.name === '-')) return '连接扬声器的桥接功放输出端。';
    if (partId === 'speaker' && (pin.name === '+' || pin.name === '-')) return '扬声器端子，两个端子分别连接功放输出。';
    if (/^GPIO\d+$/.test(role)) return '通用控制器引脚，具体功能取决于固件配置。';
    return ZH[role] ?? '请查看器件接线指南了解此引脚。';
  }
  if (partId === 'dc-source' && pin.name === '+') return 'Positive output of the DC supply; voltage is set relative to its negative terminal.';
  if (partId === 'dc-source' && pin.name === '-') return 'Negative output or return; it is not necessarily earth or controller ground.';
  if (partId === 'led-5mm' && pin.name === 'A') return 'LED anode, connected towards the positive supply.';
  if (partId === 'led-5mm' && pin.name === 'K') return 'LED cathode, connected towards the negative supply.';
  if (partId === 'inmp441' && pin.name === 'SD') return 'I²S microphone audio data output.';
  if (partId === 'max98357a' && pin.name === 'SD') return 'Amplifier shutdown control. A low level turns it off.';
  if (partId === 'max98357a' && (pin.name === '+' || pin.name === '-')) return 'Bridged amplifier output terminal for the speaker.';
  if (partId === 'speaker' && (pin.name === '+' || pin.name === '-')) return 'Speaker terminal. Connect both terminals to the amplifier outputs.';
  if (/^GPIO\d+$/.test(role)) return 'General-purpose controller pin. Its function depends on the firmware configuration.';
  return EN[role] ?? 'See the device wiring guide for this pin.';
}
