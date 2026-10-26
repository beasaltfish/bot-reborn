// What the circuit does the moment USB goes in: the bench reduced to nets
// (netlist.js), then each rule of the spec's §7 table asked of those nets.
// Pure: it reports what burns but never marks anything burnt; the caller does
// that, so powering on twice from the same bench gives the same answer.
//
// Several rules can fire at once and all of them are reported (the hints rank
// them). The Path of each chip follows its most severe condition:
// silent beats noise beats quiet beats ok.

import { nets } from './netlist.js';

/**
 * @typedef {'ok' | 'silent' | 'noise'} Path
 * @typedef {{
 *   esp: 'ok' | 'brownout' | 'off',
 *   mic: Path, amp: Path | 'quiet',
 *   burns: string[],
 *   faults: { code: string, points: string[] }[],
 * }} Outcome
 */

const RAILS = ['esp:3V3', 'esp:5V', 'esp:GND'];
const BUS = ['esp:GPIO12', 'esp:GPIO13', 'esp:GPIO14', 'esp:GPIO15'];

/** @type {Outcome['mic' | 'amp'][]} */
const SEVERITY = ['ok', 'quiet', 'noise', 'silent'];

/**
 * @param {import('./bench.js').Bench} b
 * @returns {Outcome}
 */
export function powerOn(b) {
  if (!b.usb) return { esp: 'off', mic: 'silent', amp: 'silent', burns: [], faults: [] };
  const n = nets(b);

  // Two supply pins in one net: the board's own regulator is shorted and it
  // resets over and over; nothing downstream gets a clean supply. Nothing else
  // is meaningful then, so nothing else is reported.
  const shorted = RAILS.filter((p, i) => RAILS.some((q, j) => j > i && n.same(p, q)));
  if (shorted.length) {
    const points = RAILS.filter((p) => RAILS.some((q) => q !== p && n.same(p, q)));
    return { esp: 'brownout', mic: 'silent', amp: 'silent', burns: [], faults: [{ code: 'short-rails', points }] };
  }

  /** @type {Outcome['faults']} */
  const faults = [];
  /** @type {Record<'mic' | 'amp', Outcome['mic' | 'amp'][]>} */
  const states = { mic: [], amp: [] };
  /**
   * @param {'mic' | 'amp' | 'both'} who
   * @param {Outcome['mic' | 'amp']} path
   * @param {string} code
   * @param {string[]} points
   */
  const fault = (who, path, code, points) => {
    faults.push({ code, points });
    for (const w of /** @type {const} */ (['mic', 'amp'])) if (who === 'both' || who === w) states[w].push(path);
  };

  const micPart = b.placed.find((p) => p.id === 'mic' && !p.discarded);
  /** @type {string[]} */
  const burns = [];

  // Mic power. 5V on a 3.6 V part kills it. A part that already died stays
  // dead whatever it is wired to now, so its power wiring is not judged again.
  if (micPart?.burnt) {
    fault('mic', 'silent', 'mic-burnt', ['mic:VDD']);
  } else if (n.same('mic:VDD', 'esp:5V')) {
    burns.push('mic');
    fault('mic', 'silent', 'mic-5v', ['mic:VDD', 'esp:5V']);
  } else if (!n.same('mic:VDD', 'esp:3V3') || !n.same('mic:GND', 'esp:GND')) {
    fault('mic', 'silent', 'mic-unpowered', ['mic:VDD', 'mic:GND']);
  }
  // L/R high or floating picks the right slot, and the firmware reads the left.
  // Floating is a guess in real life too, so it counts as wrong.
  if (!n.same('mic:L/R', 'esp:GND')) fault('mic', 'silent', 'mic-right-slot', ['mic:L/R']);

  // The clock pair is shared: each chip must hear BCLK on GPIO12 and WS on GPIO13.
  const chips = /** @type {const} */ ([
    { who: 'mic', bclk: 'mic:SCK', ws: 'mic:WS' },
    { who: 'amp', bclk: 'amp:BCLK', ws: 'amp:LRC' },
  ]);
  let swapped = false;
  for (const { who, bclk, ws } of chips) {
    if (n.same(bclk, 'esp:GPIO12') && n.same(ws, 'esp:GPIO13')) continue;
    if (n.same(bclk, 'esp:GPIO13') && n.same(ws, 'esp:GPIO12')) {
      swapped = true;
      fault(who, 'noise', 'clocks-swapped', [bclk, ws]);
    } else {
      fault(who, 'silent', 'clock-missing', [bclk, ws]);
    }
  }
  // Real hardware: the bus is shared, so one chip clocked wrongly garbles the
  // line for the other too; a chip with its clocks right still hears noise.
  if (swapped) for (const who of /** @type {const} */ (['mic', 'amp'])) states[who].push('noise');

  if (!n.same('mic:SD', 'esp:GPIO15')) fault('mic', 'silent', 'mic-data', ['mic:SD']);

  // Amp power. Vin on 3V3 works, only softer; it also needs its own ground.
  // Real hardware: without a ground the amp is just as dead as without Vin.
  if (n.same('amp:Vin', 'esp:3V3') && n.same('amp:GND', 'esp:GND')) states.amp.push('quiet');
  else if (!(n.same('amp:Vin', 'esp:5V') && n.same('amp:GND', 'esp:GND'))) fault('amp', 'silent', 'amp-unpowered', ['amp:Vin', 'amp:GND']);
  if (!n.same('amp:DIN', 'esp:GPIO14')) fault('amp', 'silent', 'amp-data', ['amp:DIN']);
  // SD low shuts the amp down; floating (or high) leaves it on.
  if (n.same('amp:SD', 'esp:GND')) fault('amp', 'silent', 'amp-shutdown', ['amp:SD']);
  // Real hardware: the output is bridged, so the speaker plays the same either
  // way round; it only needs one wire to each terminal, and the terminals not
  // shorted together.
  const straight = n.same('spk:+', 'amp:+') && n.same('spk:-', 'amp:-');
  const crossed = n.same('spk:+', 'amp:-') && n.same('spk:-', 'amp:+');
  if (!(straight || crossed) || n.same('amp:+', 'amp:-')) fault('amp', 'silent', 'speaker', ['spk:+', 'spk:-', 'amp:+', 'amp:-']);

  // Two bus pins in one net fight each other: a chip touching that net gets garbage.
  const touching = { mic: ['mic:SCK', 'mic:WS', 'mic:SD'], amp: ['amp:BCLK', 'amp:LRC', 'amp:DIN'] };
  const seen = new Set();
  for (const p of BUS) {
    const net = n.netOf(p);
    const group = BUS.filter((q) => n.netOf(q) === net);
    if (group.length < 2 || seen.has(net)) continue;
    seen.add(net);
    for (const who of /** @type {const} */ (['mic', 'amp'])) {
      const hit = touching[who].filter((q) => n.same(q, p));
      if (hit.length) fault(who, 'noise', 'pins-shorted', [...group, ...hit]);
    }
  }

  // A bus pin tied to a rail is held at that level: the chip on it never sees
  // a clock or data, and the GPIO fights the rail.
  /** @type {Record<'mic' | 'amp', string[]>} */
  const onBus = { mic: ['mic:SCK', 'mic:WS', 'mic:SD'], amp: ['amp:BCLK', 'amp:LRC', 'amp:DIN'] };
  for (const p of BUS) {
    const rail = RAILS.find((r) => n.same(p, r));
    if (!rail) continue;
    for (const who of /** @type {const} */ (['mic', 'amp'])) {
      const hit = onBus[who].filter((q) => n.same(q, p));
      if (hit.length) fault(who, 'silent', 'bus-on-rail', [p, rail, ...hit]);
    }
  }

  /** @param {Outcome['mic' | 'amp'][]} list */
  const worst = (list) => list.reduce((a, c) => (SEVERITY.indexOf(c) > SEVERITY.indexOf(a) ? c : a), /** @type {Outcome['mic' | 'amp']} */ ('ok'));
  return {
    esp: 'ok',
    mic: /** @type {Path} */ (worst(states.mic)),
    amp: worst(states.amp),
    burns,
    faults,
  };
}

