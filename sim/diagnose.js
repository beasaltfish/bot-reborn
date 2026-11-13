// Guesses what the user meant. After power-on, diagnose() turns the unmet links
// of TARGET and the power-on faults into hints; nextHint() is the Hint button,
// which just names the first link still missing.
//
// Order, most specific first: hanging > swapped > neighbour-pin > off-by-one >
// fault > missing. Pins hanging in the air come first: no wiring can work
// until they sit in holes. A guess about a particular wire beats a general consequence, and a
// consequence beats "nothing is there". Each unmet link gets at most one guess
// (the first that fits), so one mistake is not reported three ways.

import { PARTS } from './parts.js';
import { pinPoints } from './bench.js';
import { nets } from './netlist.js';
import { targetFor } from './target.js';
import { chineseFault } from './ui/diagnose-copy.js';
import { simText } from './ui/strings.js';
import { projectReason } from './ui/project-copy.js';

/**
 * @typedef {{ kind: 'hanging' | 'swapped' | 'neighbour-pin' | 'off-by-one' | 'missing' | 'fault', text: string, points: string[] }} Hint
 */

/** The word for each instance stem: "mic2 SCK", "speaker 2 +". */
const STEM = /** @type {Record<string, string>} */ ({ mic: 'mic', amp: 'amp', spk: 'speaker', scr: 'screen', imu: 'imu' });

/** @param {string} id @returns {{ stem: string, num: string }} */
function split(id) {
  const m = /^([a-z]+?)(\d*)$/.exec(id);
  return { stem: m ? m[1] : id, num: m ? m[2] : '' };
}

/**
 * A point the way the board's silk prints it: "GPIO 12", "mic SCK", "speaker 2 +".
 * @param {string} point
 */
export function name(point) {
  const [id, pin] = point.split(':');
  const base = pin.replace(/\.\d+$/, '');
  if (id === 'esp') return base.replace(/^GPIO(\d+)$/, 'GPIO $1');
  const { stem, num } = split(id);
  const label = STEM[stem] ?? stem;
  // "mic2" is a name, "speaker 2" reads as one; both match how the pins are printed.
  return stem === 'spk' ? `${label}${num ? ` ${num}` : ''} ${base}` : `${label}${num} ${base}`;
}

/**
 * The pins of the same part next to this one in its row: the ones a hand slips onto.
 * @param {import('./bench.js').Bench} b
 * @param {string} point
 */
function neighbours(b, point) {
  const [id, pin] = point.split(':');
  const placed = b.placed.find((p) => p.id === id);
  if (!placed) return [];
  const pins = PARTS[placed.part].pins;
  const me = pins.find((p) => p.name === pin);
  if (!me) return [];
  return pins.filter((p) => p.y === me.y && Math.abs(p.x - me.x) === 1).map((p) => `${id}:${p.name}`);
}

/** @param {string | null} hole 'bb1:e20' → { half, col } */
function holeColumn(hole) {
  const m = hole && /^[^:]+:([a-j])(\d+)$/.exec(hole);
  return m ? { half: m[1] <= 'e' ? 'top' : 'bottom', col: Number(m[2]) } : null;
}

/** What each power-on fault means for the user and what to do about it. */
const FAULT_TEXT = {
  'unsupported-electrical-network': 'This power network is outside the simulator’s electrical model; simplify the wiring or check it with a suitable circuit tool.',
  'source-contention': 'Multiple power sources drive the same rail; separate their outputs or use a suitable power-sharing circuit.',
  'source-short': 'The independent source terminals are shorted; disconnect the source and separate its positive and negative connections.',
  'led-reversed': 'The LED is connected in reverse; connect its anode towards the positive supply and its cathode towards the negative return.',
  'led-overcurrent': 'The modeled LED current exceeds its rating and may damage it; disconnect power and use appropriate current limiting.',
  'led-burnt': 'This LED is marked as burnt; replace it and check the circuit and current limit before powering it again.',
  'led-current-limited': 'The DC supply is limiting current in this LED circuit; check the current limit and component ratings.',
  'gpio-overvoltage-risk': 'The external source is set above the board’s nominal GPIO logic voltage; the pin may be exposed to excessive voltage. Disconnect power and use a suitable level shifter or lower voltage.',
  'gpio-negative-voltage-risk': 'The external source may drive a GPIO below board ground. Disconnect power and correct the polarity or use suitable isolation.',
  'gpio-drive-unmodeled': 'GPIO direction and current contention are not modeled for this external source; verify the firmware pin configuration before connecting it.',
  'source-ground-missing': 'The external signal source has no common ground with the board; its logic level may be unreliable. Connect a suitable common reference or use appropriate isolation.',
  'reverse-polarity': 'Power and ground are reversed; disconnect power and correct the polarity before reconnecting.',
  'source-current-limit': 'The load requests more current than the supply can deliver; reduce the load or use a higher-current supply.',
  'regulator-dropout': 'The regulator input voltage is too low for its output; raise the input voltage within its ratings.',
  'rail-brownout': 'The supply voltage is too low for this device; check the supply, wiring, and current demand.',
  'device-unpowered': 'The device has no usable power; connect its supply and ground to a suitable source.',
  'device-overvoltage': 'The supply voltage exceeds the device rating and may have damaged it; replace the device and use a suitable voltage.',
  'device-overpower': 'The device dissipates more power than its rating and may have been damaged; replace it and reduce the load.',
  'firmware-unsupported': 'The selected firmware does not support this device; choose a supported device or firmware profile.',
  'floating-input': 'The GPIO input has no defined level; configure an appropriate pull-up or pull-down for the circuit.',
  'gpio-contention': 'GPIO outputs or a rail are driving opposite levels; disconnect power and separate the conflicting drivers.',
  'logic-level-incompatible': 'A connected signal may exceed the configured GPIO logic voltage; disconnect power and use suitable level shifting.',
  'i2c-address-conflict': 'Devices share an I2C address on the same bus; change an address or separate the buses.',
  'i2c-unpowered': 'The I2C device is not powered; check its supply and ground.',
  'i2c-controller-unpowered': 'The I2C controller is not confirmed powered; check the controller power before expecting communication.',
  'i2c-supply-invalid': 'The I2C device supply is unsafe or invalid; disconnect power and check its supply wiring and ratings.',
  'i2c-sda-scl-swapped': 'The I2C data and clock lines are swapped; connect SDA to SDA and SCL to SCL.',
  'i2c-lines-shorted': 'The I2C data and clock lines are shorted together; separate SDA and SCL.',
  'i2c-line-on-rail': 'An I2C line is directly connected to a supply rail or ground; remove the direct connection and check the pull-ups.',
  'i2c-wrong-bus': 'The I2C lines do not reach the configured controller bus; check SDA and SCL wiring.',
  'i2c-level-incompatible': 'The I2C pull-up supply may exceed the controller logic voltage; disconnect power and match the pull-up voltage or use suitable level shifting.',
  'spi-chip-select-conflict': 'Devices share a chip select on the same SPI bus; assign separate chip selects.',
  'resource-pin-conflict': 'Incompatible signals share a pin or net; separate the connections or assign different pins.',
  'short-rails': 'Two of 3V3, 5V and GND are joined, so the board keeps resetting; take away the wire or pin that joins them.',
  'mic-5v': 'The INMP441 is rated 3.6 V at most and its VDD was on 5V, so it burnt; replace it and power it from 3V3.',
  'mic-burnt': 'This mic already burnt and stays dead; replace it with a fresh one and wire its VDD to 3V3.',
  'mic-unpowered': 'The mic has no power, so it hears nothing; wire its VDD to 3V3 and its GND to GND.',
  'mic-right-slot': 'With L/R not on GND the mic talks in the right slot and the firmware reads the left; wire L/R to GND.',
  'clocks-swapped': 'The two clock lines are swapped, so the sound is noise; BCLK (SCK) goes to GPIO 12 and WS (LRC) to GPIO 13.',
  'clock-missing': 'A chip is not getting its clock, so it stays silent; SCK and BCLK go to GPIO 12, WS and LRC to GPIO 13.',
  'mic-data': 'The mic\'s SD is not on GPIO 15, so what it hears never reaches the ESP32; wire SD to GPIO 15.',
  'amp-unpowered': 'The amp has no power, so it is dead; wire its Vin to 5V and its GND to GND.',
  'amp-data': 'The amp\'s DIN is not on GPIO 14, so it never gets any sound to play; wire DIN to GPIO 14.',
  'amp-shutdown': 'The amp\'s SD pin is tied to GND, which shuts the amp down; leave SD unconnected.',
  speaker: 'The speaker is not joined to both screw terminals of the amp, or the terminals touch each other; one wire from each speaker pin to one terminal.',
  'pins-shorted': 'Two of GPIO 12 to 15 are joined, so the chips on them hear garbage; separate those wires.',
  'bus-on-rail': 'One of GPIO 12 to 15 is joined to 3V3, 5V or GND, so it is stuck and the chip on it hears nothing; wire that pin to its own signal only.',
  'mics-same-slot': 'Two mics are both wired for the left slot and share the data line, so what the ESP32 hears is noise; take one out, or wire one for the right slot.',
  'screen-burnt': 'This panel already burnt and stays dead; take it to the bin and wire a fresh one the same way.',
  'screen-5v': 'This module takes 3V3 at most and its VCC was on 5V, so it burnt; take it to the bin and wire VCC to 3V3.',
  'screen-unpowered': 'The panel has no power, so it stays black; wire its VCC to 3V3 or 5V, and its GND to GND.',
  'screen-needs-5v': 'This module has its own regulator and wants 5V on VCC; on 3V3 the panel stays dark.',
  'screen-backlight': 'The backlight is off, so the glass is dark; wire the backlight pin to 3V3.',
  'screen-spi-swapped': 'SCK and MOSI are swapped, so the panel is initialised with nonsense and stays white; swap those two wires.',
  'screen-signal': 'SCK, MOSI, DC or RST is not where the firmware sends it, so the panel never initialises and stays white; check those wires against the diagram.',
  'screen-cs': 'The panel is not selected: CS goes to GPIO 9, so the firmware never talks to it and the glass stays white.',
  'screens-mixed': 'Two different screen models are both selected, and the firmware drives one kind of screen at a time; take one off, or wire only one CS to GPIO 9.',
  'screen-pins-shorted': 'Two of GPIO 8 to 11 and 18 are joined, so the panel hears nonsense and stays white; separate those wires.',
  'screen-bus-on-rail': 'One of the panel\'s signal pins is held at 3V3, 5V or GND, so it never sees its signal and the glass stays white; give that pin its own wire.',
  'imu-burnt': 'This wand already burnt and stays dead; take it to the bin and wire a fresh one the same way.',
  'imu-5v': 'The wand\'s VCC was on 5V and it burnt, as the mic does; take it to the bin and wire VCC to 3V3.',
  'imu-unpowered': 'The wand has no power, so it feels nothing; wire its VCC to 3V3 and its GND to GND.',
  'imu-bus-swapped': 'SDA and SCL are swapped, so the ESP32 never hears the wand; SDA goes to GPIO 1 and SCL to GPIO 2.',
  'imu-bus': 'The wand\'s SDA or SCL is not where the firmware listens, so it never hears the wand; SDA goes to GPIO 1 and SCL to GPIO 2.',
  'imu-bus-short': 'The wand\'s SDA and SCL are joined to each other or held at 3V3, 5V or GND, so the bus is stuck; give each its own wire to its own GPIO.',
  'bl-on-gpio': 'The backlight is on a GPIO, which works but is not how the diagram wires it; the backlight pin belongs on 3V3.',
  'toy-burnt': 'This toy already burnt and stays dead; take it to the bin and wire a fresh one the same way.',
  'toy-ungrounded': "The toy and the ESP32 do not share a ground, so the ESP32's high and low mean nothing to it; wire the toy's GND to the ESP32's GND.",
  'toy-ground-raised': "The toy's ground is on a supply, so every signal it sees is at or below its own ground; both boards need the same ground, the ESP32's GND.",
  'toy-drive-missing': "One of the wheel driver's two inputs has no wire, so the toy can only drive one way; U3 input A goes to GPIO 4 and B to GPIO 5.",
  'toy-steer-missing': "One of the steering driver's two inputs has no wire, so the axle only swings one way; U5 input A goes to GPIO 6 and B to GPIO 7.",
  'toy-drive-swapped': 'The two wheel inputs look swapped: the toy will drive backwards when it is told forward. U3 A goes to GPIO 4 and B to GPIO 5.',
  'toy-steer-swapped': 'The two steering inputs look swapped: the toy will turn the other way. U5 A goes to GPIO 6 and B to GPIO 7.',
  'toy-input-held': 'An input is wired to a supply instead of a GPIO, so it is always high: that motion never switches off.',
  'toy-input-contended': "Two GPIOs are joined onto one of the toy's inputs, and they fight; give each input its own wire.",
  'toy-pair-tied': 'Both inputs of one driver are on the same wire, so the first command that pulls it high is a short across its bridge; give each input its own GPIO.',
  'toy-short': 'Both inputs of one driver were high together, which is a short across its bridge; the toy burnt. One GPIO per input.',
};

/**
 * @param {import('./bench.js').Bench} b
 * @param {import('./power.js').Outcome} o
 * @param {string} [lang]
 * @returns {Hint[]}
 */
export function diagnose(b, o, lang = 'en') {
  const n = nets(b);
  const unmet = unmetLinks(b);
  /** Is any wire in this point's net? Nothing reaches a pin otherwise. */
  const touched = (/** @type {string} */ p) => b.wires.some((w) => n.same(w.a, p));

  /** @type {Hint[]} */
  const swapped = [];
  /** @type {Hint[]} */
  const slips = [];
  /** @type {Hint[]} */
  const offs = [];
  /** @type {Hint[]} */
  const missing = [];
  const explained = new Set();

  for (const [i, l1] of unmet.entries()) {
    for (const l2 of unmet.slice(i + 1)) {
      if (explained.has(l1) || explained.has(l2)) continue;
      if (!(n.same(l1.a, l2.b) && n.same(l2.a, l1.b))) continue;
      explained.add(l1);
      explained.add(l2);
      swapped.push({
        kind: 'swapped',
        text: lang === 'zh' ? simText(lang, 'hint.swapped', { a: name(l1.a), b: name(l2.a), toA: name(l1.b), toB: name(l2.b) }) : `${name(l1.a)} and ${name(l2.a)} look swapped: ${name(l1.a)} goes to ${name(l2.b)} and ${name(l2.a)} to ${name(l1.b)}.`,
        points: [l1.a, l2.a, l1.b, l2.b],
      });
    }
  }

  for (const link of unmet) {
    if (explained.has(link)) continue;
    const ends = [[link.a, link.b], [link.b, link.a]];

    // A wire for this link sits on the pin beside the wanted one.
    const slip = ends.flatMap(([want, other]) => neighbours(b, want).filter((p) => n.same(p, other)).map((p) => ({ want, other, p })))[0];
    if (slip) {
      slips.push({
        kind: 'neighbour-pin',
        text: lang === 'zh' ? simText(lang, 'hint.neighbour', { other: name(slip.other), actual: name(slip.p), wanted: name(slip.want) }) : `${name(slip.other)} goes to ${name(slip.p)}, the pin next to ${name(slip.want)}.`,
        points: [slip.want, slip.p, slip.other],
      });
      continue;
    }

    // A wire for this link ends one column beside the strip the wanted pin is in.
    /** @type {Hint | null} */
    let off = null;
    for (const [want, other] of ends) {
      const placed = b.placed.find((p) => p.id === want.split(':')[0]);
      const at = placed && holeColumn(pinPoints(b, placed).find((q) => q.pin === want)?.hole ?? null);
      if (!at) continue;
      for (const w of b.wires) {
        if (!n.same(w.a, other)) continue;
        for (const end of [w.a, w.b]) {
          const h = holeColumn(end);
          if (h && h.half === at.half && Math.abs(h.col - at.col) === 1) {
            const text = lang === 'zh' ? simText(lang, 'hint.offColumn', { other: name(other), actual: h.col, wanted: name(want), expected: at.col }) : `A wire for ${name(other)} ends in column ${h.col}, but ${name(want)} is in column ${at.col}.`;
            off = { kind: 'off-by-one', text, points: [want, other, end] };
          }
        }
      }
    }
    if (off) {
      offs.push(off);
      continue;
    }

    // Nothing reaches one of the ends at all.
    if (!touched(link.a) || !touched(link.b)) {
      const text = lang === 'zh' ? simText(lang, 'hint.missing', { a: name(link.a), b: name(link.b) }) : `Nothing connects ${name(link.a)} to ${name(link.b)} yet.`;
      missing.push({ kind: 'missing', text, points: [link.a, link.b] });
    }
  }

  const faults = o.faults.map((f) => /** @type {Hint} */ ({
    kind: 'fault',
    text: (lang === 'zh' ? chineseFault(f.code) : undefined) ?? FAULT_TEXT[/** @type {keyof typeof FAULT_TEXT} */ (f.code)] ?? `Something is wrong here (${f.code}).`,
    points: f.points,
  }));
  return [...hanging(b, lang), ...swapped, ...slips, ...offs, ...faults, ...missing];
}

/** @param {string} id @returns {string} */
function partName(id) {
  const { stem, num } = split(id);
  const label = STEM[stem] ?? id;
  return `The ${label}${num ? ` ${num}` : ''}`;
}

/**
 * Pins of a part on the board that went into no hole and have no wire on them
 * either: they touch nothing. From above they look seated, and a wire in the
 * hole beside one looks connected, so this is said plainly and first.
 * @param {import('./bench.js').Bench} b
 * @param {string} [lang]
 * @returns {Hint[]}
 */
export function hanging(b, lang = 'en') {
  /** @type {Hint[]} */
  const out = [];
  for (const p of b.placed) {
    if (!p.seated) continue;
    const pins = PARTS[p.part].pins;
    const loose = pinPoints(b, p)
      .filter((s) => s.hole === null && !pins.find((q) => `${p.id}:${q.name}` === s.pin)?.wireOnly)
      .map((s) => s.pin)
      .filter((pin) => !b.wires.some((w) => w.a === pin || w.b === pin));
    if (!loose.length) continue;
    const names = loose.map((pin) => pin.slice(pin.indexOf(':') + 1));
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    out.push({
      kind: 'hanging',
      text: lang === 'zh' ? simText(lang, 'hint.hanging', { part: p.id, pins: names.join('、') }) : `${partName(p.id)}'s ${list} ${names.length === 1 ? 'pin is' : 'pins are'} in no hole and touch nothing: move it so every pin sits in a hole, or slip a jumper straight onto them.`,
      points: loose,
    });
  }
  return out;
}

/**
 * The links still to make, per instance. A speaker wired crossed counts as
 * made: the amp drives it bridged, so it plays the same either way round.
 * @param {import('./bench.js').Bench} b
 */
function unmetLinks(b) {
  const n = nets(b);
  /** @param {{ a: string, b: string }} l */
  const crossed = (l) => {
    const [id, pin] = l.a.split(':');
    const [ampId, ampPin] = l.b.split(':');
    if (!'+-'.includes(pin) || !'+-'.includes(ampPin)) return false;
    const other = pin === '+' ? '-' : '+';
    const ampOther = ampPin === '+' ? '-' : '+';
    return n.same(`${id}:${pin}`, `${ampId}:${ampOther}`) && n.same(`${id}:${other}`, `${ampId}:${ampPin}`);
  };
  return targetFor(b).filter((l) => !n.same(l.a, l.b) && !crossed(l));
}

/**
 * For the Hint button: the first link still to make, in TARGET order, with why.
 * @param {import('./bench.js').Bench} b
 * @param {string} [lang]
 * @returns {Hint | null}
 */
export function nextHint(b, lang = 'en') {
  const loose = hanging(b, lang)[0];
  if (loose) return loose;
  const link = unmetLinks(b)[0];
  if (!link) return null;
  const text = lang === 'zh' ? simText(lang, 'hint.next', { a: name(link.a), b: name(link.b), reason: projectReason(lang, link.why) ?? link.why }) : `Connect ${name(link.a)} to ${name(link.b)}. ${link.why}`;
  return { kind: 'missing', text, points: [link.a, link.b] };
}
