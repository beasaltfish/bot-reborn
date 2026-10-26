// The wiring the firmware expects (firmware/main/board.h), link by link, with
// the reason each one is there. The hint and the "does it work" check read it;
// the scene never does, so the bench can be wired wrongly on purpose.
//
// Points are "<instanceId>:<pinName>"; the ESP32's power pins are named as pins
// (esp:3V3, esp:5V, esp:GND), the same as any other.

/** @typedef {{ a: string, b: string, why: string }} Link */

/** @type {Link[]} */
export const TARGET = [
  { a: 'mic:VDD', b: 'esp:3V3', why: 'The mic is rated 3.6 V at most, so it takes 3V3, not 5V.' },
  { a: 'mic:GND', b: 'esp:GND', why: 'The mic needs a ground shared with the ESP32.' },
  { a: 'mic:L/R', b: 'esp:GND', why: 'With L/R low the mic talks in the left slot, which is the one the firmware reads.' },
  { a: 'mic:SCK', b: 'esp:GPIO12', why: 'The ESP32 clocks the mic bit by bit on BCLK, GPIO 12.' },
  { a: 'mic:WS', b: 'esp:GPIO13', why: 'The word-select line, GPIO 13, tells the mic which slot is being read.' },
  { a: 'mic:SD', b: 'esp:GPIO15', why: 'The mic sends its samples to the ESP32 on GPIO 15.' },
  { a: 'amp:Vin', b: 'esp:5V', why: 'The amp runs on 5V on this build; 3V3 works too, only quieter.' },
  { a: 'amp:GND', b: 'esp:GND', why: 'The amp needs a ground shared with the ESP32.' },
  { a: 'amp:BCLK', b: 'esp:GPIO12', why: 'The amp shares the bit clock with the mic, so BCLK fans out to both.' },
  { a: 'amp:LRC', b: 'esp:GPIO13', why: 'The amp shares the word-select line with the mic, so GPIO 13 goes to both.' },
  { a: 'amp:DIN', b: 'esp:GPIO14', why: 'The ESP32 sends the sound to play to the amp on GPIO 14.' },
  { a: 'spk:+', b: 'amp:+', why: 'The speaker goes through the amp screw terminal, plus to plus.' },
  { a: 'spk:-', b: 'amp:-', why: 'The speaker goes through the amp screw terminal, minus to minus.' },
];
