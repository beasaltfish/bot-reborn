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

/** @param {string} partId @param {{name:string,role?:string,wireOnly?:boolean}} pin */
export function pinDescription(partId, pin) {
  const role = pin.role ?? pin.name.replace(/\.\d+$/, '');
  if (partId === 'inmp441' && pin.name === 'SD') return 'I²S microphone audio data output.';
  if (partId === 'max98357a' && pin.name === 'SD') return 'Amplifier shutdown control. A low level turns it off.';
  if (partId === 'max98357a' && (pin.name === '+' || pin.name === '-')) return 'Bridged amplifier output terminal for the speaker.';
  if (partId === 'speaker' && (pin.name === '+' || pin.name === '-')) return 'Speaker terminal. Connect both terminals to the amplifier outputs.';
  if (/^GPIO\d+$/.test(role)) return 'General-purpose controller pin. Its function depends on the firmware configuration.';
  return EN[role] ?? 'See the device wiring guide for this pin.';
}
