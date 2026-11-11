/**
 * Steps for the supported fixed 5 V source and default 220 Ω resistor.
 * @param {string} lang
 * @returns {string[]}
 */
export function ledGuide(lang) {
  return lang === 'zh' ? [
    '在工作台添加直流电源、220 Ω 电阻和 5 毫米 LED。电源在模拟器中始终处于开启状态。',
    '将电源正极连接到电阻的一端，另一端连接到 LED 的 A（正极）。',
    '最后将 LED 的 K（负极）连接到电源负极，完成回路。',
    '点击 LED 查看电流和状态；电阻也可以放在 LED 的负极一侧。',
  ] : [
    'Add a DC power supply, a 220 Ω resistor and a 5 mm LED to the bench. The simulated source is always on.',
    'Connect supply positive to one end of the resistor, and the other end to LED A (anode).',
    'Connect LED K (cathode) to supply negative last to complete the circuit.',
    'Select the LED to inspect its current and state. The resistor can also go on the cathode side.',
  ];
}
