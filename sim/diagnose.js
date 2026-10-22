// Guesses what the user meant. After power-on, diagnose() turns the unmet links
// of TARGET and the power-on faults into hints; nextHint() is the Hint button,
// which just names the first link still missing.
//
// Order, most specific first: swapped > neighbour-pin > off-by-one > fault >
// missing. A guess about a particular wire beats a general consequence, and a
// consequence beats "nothing is there". Each unmet link gets at most one guess
// (the first that fits), so one mistake is not reported three ways.

import { PARTS } from './parts.js';
import { pinPoints } from './bench.js';
import { nets } from './netlist.js';
import { TARGET } from './target.js';

/**
 * @typedef {{ kind: 'swapped' | 'neighbour-pin' | 'off-by-one' | 'missing' | 'fault', text: string, points: string[] }} Hint
 */

/**
 * A point the way the board's silk prints it: "GPIO 12", "mic SCK".
 * @param {string} point
 */
function name(point) {
  const [id, pin] = point.split(':');
  const base = pin.replace(/\.\d+$/, '');
  if (id === 'esp') return base.replace(/^GPIO(\d+)$/, 'GPIO $1');
  return `${id === 'spk' ? 'speaker' : id} ${base}`;
}

/**
 * The pins of the same part next to this one in its row: the ones a hand slips onto.
 * @param {import('./bench.js').Bench} b
 * @param {string} point
 */
function neighbours(b, point) {
  const [id, pin] = point.split(':');
  const placed = b.placed.find((p) => p.id === id && !p.discarded);
  if (!placed) return [];
  const pins = PARTS[placed.part].pins;
  const me = pins.find((p) => p.name === pin);
  if (!me) return [];
  return pins.filter((p) => p.y === me.y && Math.abs(p.x - me.x) === 1).map((p) => `${id}:${p.name}`);
}

/** @param {string | null} hole 'bb:e20' → { half, col } */
function holeColumn(hole) {
  const m = hole && /^bb:([a-j])(\d+)$/.exec(hole);
  return m ? { half: m[1] <= 'e' ? 'top' : 'bottom', col: Number(m[2]) } : null;
}

/** What each power-on fault means for the user and what to do about it. */
const FAULT_TEXT = {
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
};

/**
 * @param {import('./bench.js').Bench} b
 * @param {import('./power.js').Outcome} o
 * @returns {Hint[]}
 */
export function diagnose(b, o) {
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
        text: `${name(l1.a)} and ${name(l2.a)} look swapped: ${name(l1.a)} goes to ${name(l2.b)} and ${name(l2.a)} to ${name(l1.b)}.`,
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
        text: `${name(slip.other)} goes to ${name(slip.p)}, the pin next to ${name(slip.want)}.`,
        points: [slip.want, slip.p, slip.other],
      });
      continue;
    }

    // A wire for this link ends one column beside the strip the wanted pin is in.
    /** @type {Hint | null} */
    let off = null;
    for (const [want, other] of ends) {
      const placed = b.placed.find((p) => p.id === want.split(':')[0] && !p.discarded);
      const at = placed && holeColumn(pinPoints(b, placed).find((q) => q.pin === want)?.hole ?? null);
      if (!at) continue;
      for (const w of b.wires) {
        if (!n.same(w.a, other)) continue;
        for (const end of [w.a, w.b]) {
          const h = holeColumn(end);
          if (h && h.half === at.half && Math.abs(h.col - at.col) === 1) {
            off = { kind: 'off-by-one', text: `A wire for ${name(other)} ends in column ${h.col}, but ${name(want)} is in column ${at.col}.`, points: [want, other, end] };
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
      missing.push({ kind: 'missing', text: `Nothing connects ${name(link.a)} to ${name(link.b)} yet.`, points: [link.a, link.b] });
    }
  }

  const faults = o.faults.map((f) => /** @type {Hint} */ ({
    kind: 'fault',
    text: FAULT_TEXT[/** @type {keyof typeof FAULT_TEXT} */ (f.code)] ?? `Something is wrong here (${f.code}).`,
    points: f.points,
  }));
  return [...swapped, ...slips, ...offs, ...faults, ...missing];
}

/**
 * TARGET links not yet made. The speaker wired crossed counts as made: the amp
 * drives it bridged, so it plays the same either way round.
 * @param {import('./bench.js').Bench} b
 */
function unmetLinks(b) {
  const n = nets(b);
  const crossed = n.same('spk:+', 'amp:-') && n.same('spk:-', 'amp:+');
  return TARGET.filter((l) => !n.same(l.a, l.b) && !(crossed && l.a.startsWith('spk:')));
}

/**
 * For the Hint button: the first link still to make, in TARGET order, with why.
 * @param {import('./bench.js').Bench} b
 * @returns {Hint | null}
 */
export function nextHint(b) {
  const link = unmetLinks(b)[0];
  if (!link) return null;
  return { kind: 'missing', text: `Connect ${name(link.a)} to ${name(link.b)}. ${link.why}`, points: [link.a, link.b] };
}
