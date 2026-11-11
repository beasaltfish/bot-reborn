// Copy is intentionally separate from the device catalogue's electrical data.
/** @type {Record<string, Record<string, string>>} */
const COPY = {
  en: {
    results: '{count} results', required: 'Required', controller: 'Controllers', audio: 'Audio', sensor: 'Sensors', actuator: 'Actuators', display: 'Displays',
    'name.esp32': 'ESP32-S3', 'name.inmp441': 'INMP441 mic', 'name.max98357a': 'MAX98357A amp', 'name.speaker': 'Speaker', 'name.mpu6050': 'MPU-6050 (GY-521)', 'name.toy': 'Toy robot',
    'summary.esp32': 'Controller board for the simulated project.', 'summary.inmp441': 'Microphone module for audio input.', 'summary.max98357a': 'Amplifier module for the speaker.', 'summary.speaker': 'Wired audio output.', 'summary.mpu6050': 'Motion sensor module for the wand.', 'summary.toy': 'Battery-powered toy with drive and steering inputs.', 'summary.display': 'Screen module for visual output.',
  },
  zh: {
    results: '{count} 个结果', required: '必需', controller: '控制器', audio: '音频', sensor: '传感器', actuator: '执行器', display: '显示屏',
    'name.esp32': 'ESP32-S3 控制板', 'name.inmp441': 'INMP441 麦克风', 'name.max98357a': 'MAX98357A 功放', 'name.speaker': '扬声器', 'name.mpu6050': 'MPU-6050（GY-521）', 'name.toy': '玩具机器人',
    'summary.esp32': '模拟项目使用的控制板。', 'summary.inmp441': '用于音频输入的麦克风模块。', 'summary.max98357a': '用于驱动扬声器的功放模块。', 'summary.speaker': '有线音频输出。', 'summary.mpu6050': '用于手杖的运动传感器模块。', 'summary.toy': '带行驶和转向输入的电池供电玩具。', 'summary.display': '用于视觉输出的屏幕模块。',
  },
};

/** @param {string} lang @param {string} key @param {Record<string, string | number>} [vars] */
export function simText(lang, key, vars = {}) {
  const text = COPY[lang === 'zh' ? 'zh' : 'en'][key] ?? COPY.en[key] ?? key;
  return text.replace(/\{([^}]+)\}/g, (match, name) => Object.hasOwn(vars, name) ? String(vars[name]) : match);
}
