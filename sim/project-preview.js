// What a project demo shows after its animated build. These are visual previews,
// not a claim that the unplugged bench is electrically powered.
import { formatReadings } from './devices/ssd1306.js';

const READINGS = { temperatureC: 25, humidityPct: 50, pressureHpa: 1013 };

/** @param {string} id @param {{temperatureC?:number,humidityPct?:number,pressureHpa?:number}} [readings] */
export function previewStates(id, readings = READINGS) {
  switch (id) {
    case 'environment-display': {
      const frame = formatReadings(readings).frame;
      return { display: { oled: { state: 'ready', frame, lines: formatReadings(readings).lines } } };
    }
    case 'proximity-servo':
      return { servo: { servo: { state: 'moving', angle: 45, pulseUs: 975 } } };
    case 'motor-driver-basics':
      return { motor: { motor: { state: 'forward', rpmRatio: 0.5 } } };
    case 'status-light-strip':
      return { strip: { strip: { state: 'active', colors: Array.from({ length: 8 }, () => [[255, 255, 255]]) } } };
    case 'button-led':
      return { buttons: { btn: true } };
    default:
      return null;
  }
}

/** @param {string} id @param {string} lang */
export function previewText(id, lang = 'en') {
  const zh = lang === 'zh';
  /** @type {Record<string, [string,string]>} */
  const copy = {
    'led-basics': ['Demo: the LED lights when the loop is complete.', '演示：回路闭合后 LED 点亮。'],
    'power-a-rail': ['Demo: the regulator holds the rail at its selected output.', '演示：稳压器把电源轨维持在所选输出。'],
    'bme280-readings': ['Demo: simulated temperature, humidity and pressure are ready.', '演示：模拟的温度、湿度和气压已就绪。'],
    'distance-reader': ['Demo: a simulated 100 cm target is measured.', '演示：测量到模拟的 100 cm 目标。'],
    'button-led': ['Demo: the button pulls the input low.', '演示：按键把输入拉低。'],
    'environment-display': ['Demo: the readings are drawn on the OLED.', '演示：读数已绘制到 OLED。'],
    'proximity-servo': ['Demo: distance moves the servo to 45°.', '演示：距离让舵机转到 45°。'],
    'motor-driver-basics': ['Demo: the motor spins forward at half speed.', '演示：电机以半速正转。'],
    'status-light-strip': ['Demo: the strip lights white at full brightness.', '演示：灯带以全亮白色点亮。'],
    tarot: ['Demo: shake the wand to draw a card.', '演示：摇晃手杖抽一张牌。'],
  };
  const entry = copy[id];
  if (!entry) return null;
  return zh ? entry[1] : entry[0];
}
