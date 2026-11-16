// What a project demo says after its build. Device state is not faked here:
// it comes from the firmware that was flashed and is running.
/** @param {string} id @param {string} lang */
export function previewText(id, lang = 'en') {
  const zh = lang === 'zh';
  /** @type {Record<string, [string,string]>} */
  const copy = {
    'led-basics': ['Demo: the LED lights when the loop is complete.', '演示：回路闭合后 LED 点亮。'],
    'power-a-rail': ['Demo: the regulator holds the rail at its selected output.', '演示：稳压器把电源轨维持在所选输出。'],
    'bme280-readings': ['Demo: simulated temperature, humidity and pressure are ready.', '演示：模拟的温度、湿度和气压已就绪。'],
    'distance-reader': ['Demo: no reading — ECHO is 5 V and needs level shifting.', '演示：没有读数——ECHO 是 5 V，需要电平转换。'],
    'button-led': ['Demo: the button pulls the input low.', '演示：按键把输入拉低。'],
    'environment-display': ['Demo: the readings are drawn on the OLED.', '演示：读数已绘制到 OLED。'],
    'proximity-servo': ['Demo: the servo stays still until ECHO is level-shifted.', '演示：电平转换前舵机不动。'],
    'motor-driver-basics': ['Demo: the motor spins forward at half speed.', '演示：电机以半速正转。'],
    'status-light-strip': ['Demo: the strip lights white at full brightness.', '演示：灯带以全亮白色点亮。'],
    tarot: ['Demo: shake the wand to draw a card.', '演示：摇晃手杖抽一张牌。'],
  };
  const entry = copy[id];
  if (!entry) return null;
  return zh ? entry[1] : entry[0];
}
