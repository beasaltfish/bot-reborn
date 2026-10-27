// What the circuit does the moment USB goes in: the bench reduced to nets
// (netlist.js), then each rule of the spec's §7 table asked of those nets.
// Pure: it reports what burns but never marks anything burnt; the caller does
// that, so powering on twice from the same bench gives the same answer.
//
// Every rule is per instance now (multi-screen spec §5.6): two mics are judged
// one at a time, then summed, because a second mic on the same data line is a
// real mistake with a real consequence (noise), not a special case. Several
// rules can fire at once and all of them are reported (the hints rank them).
// The Path of each chip follows its most severe condition:
// silent beats noise beats quiet beats ok.

import { nets } from './netlist.js';

/**
 * @typedef {'ok' | 'silent' | 'noise'} Path
 * @typedef {{ kind: 'mic', path: Path }
 *   | { kind: 'amp', path: Path | 'quiet' }
 *   | { kind: 'speaker', playing: boolean }
 *   | { kind: 'screen', show: 'off' | 'dark' | 'white' | 'garbage' | 'ready' }
 * } PartState
 * @typedef {{
 *   esp: 'ok' | 'brownout' | 'off',
 *   mic: Path, amp: Path | 'quiet',
 *   burns: string[],
 *   faults: { code: string, points: string[] }[],
 *   parts: Record<string, PartState>,
 *   screenModel: string | null,
 * }} Outcome
 */

const RAILS = ['esp:3V3', 'esp:5V', 'esp:GND'];
const BUS = ['esp:GPIO12', 'esp:GPIO13', 'esp:GPIO14', 'esp:GPIO15'];

/** @type {Outcome['mic' | 'amp'][]} */
const SEVERITY = ['ok', 'quiet', 'noise', 'silent'];

/** @param {Outcome['mic' | 'amp'][]} list */
const worst = (list) => list.reduce((a, c) => (SEVERITY.indexOf(c) > SEVERITY.indexOf(a) ? c : a), /** @type {Outcome['mic' | 'amp']} */ ('ok'));
/** @param {Outcome['mic' | 'amp'][]} list */
const best = (list) => list.reduce((a, c) => (SEVERITY.indexOf(c) < SEVERITY.indexOf(a) ? c : a), /** @type {Outcome['mic' | 'amp']} */ ('silent'));

/**
 * @param {import('./bench.js').Bench} b
 * @returns {Outcome}
 */
export function powerOn(b) {
  const mics = b.placed.filter((p) => p.part === 'inmp441');
  const amps = b.placed.filter((p) => p.part === 'max98357a');
  const speakers = b.placed.filter((p) => p.part === 'speaker');

  /** @type {Record<string, PartState>} */
  const parts = {};
  for (const p of mics) parts[p.id] = { kind: 'mic', path: 'silent' };
  for (const p of amps) parts[p.id] = { kind: 'amp', path: 'silent' };
  for (const p of speakers) parts[p.id] = { kind: 'speaker', playing: false };

  /** No power at all: every instance is its resting state. */
  if (!b.usb) return { esp: 'off', mic: 'silent', amp: 'silent', burns: [], faults: [], parts, screenModel: null };
  const n = nets(b);

  // Two supply pins in one net: the board's own regulator is shorted and it
  // resets over and over; nothing downstream gets a clean supply. Nothing else
  // is meaningful then, so nothing else is reported.
  const shorted = RAILS.filter((p, i) => RAILS.some((q, j) => j > i && n.same(p, q)));
  if (shorted.length) {
    const points = RAILS.filter((p) => RAILS.some((q) => q !== p && n.same(p, q)));
    return { esp: 'brownout', mic: 'silent', amp: 'silent', burns: [], faults: [{ code: 'short-rails', points }], parts, screenModel: null };
  }

  /** @type {Outcome['faults']} */
  const faults = [];
  /** @type {string[]} */
  const burns = [];

  /**
   * The bus faults a chip sees through its own pins: a GPIO shared with
   * another GPIO garbles it, a GPIO held at a rail never changes.
   * @param {string[]} pins the chip's bus pins
   * @param {(path: Path, code: string, points: string[]) => void} add
   */
  const busFaults = (pins, add) => {
    for (const q of pins) {
      const group = BUS.filter((p) => n.same(p, q));
      if (group.length >= 2) add('noise', 'pins-shorted', [...group, q]);
      const rail = RAILS.find((r) => n.same(q, r));
      if (rail) add('silent', 'bus-on-rail', [q, rail]);
    }
  };

  /** @type {boolean} */
  let swappedAny = false;
  /**
   * The clock pair every chip needs: BCLK on GPIO 12, WS on GPIO 13.
   * @param {string} bclk @param {string} ws
   * @param {(path: Path, code: string, points: string[]) => void} add
   */
  const clocks = (bclk, ws, add) => {
    if (n.same(bclk, 'esp:GPIO12') && n.same(ws, 'esp:GPIO13')) return;
    if (n.same(bclk, 'esp:GPIO13') && n.same(ws, 'esp:GPIO12')) {
      swappedAny = true;
      add('noise', 'clocks-swapped', [bclk, ws]);
      return;
    }
    add('silent', 'clock-missing', [bclk, ws]);
  };

  for (const p of mics) {
    const id = p.id;
    /** @type {Path[]} */
    const states = [];
    /** @param {Path} path @param {string} code @param {string[]} points */
    const add = (path, code, points) => { states.push(path); faults.push({ code, points }); };

    // A part that already died stays dead whatever it is wired to now, so its
    // power wiring is not judged again.
    if (p.burnt) add('silent', 'mic-burnt', [`${id}:VDD`]);
    else if (n.same(`${id}:VDD`, 'esp:5V')) { burns.push(id); add('silent', 'mic-5v', [`${id}:VDD`, 'esp:5V']); }
    else if (!n.same(`${id}:VDD`, 'esp:3V3') || !n.same(`${id}:GND`, 'esp:GND')) add('silent', 'mic-unpowered', [`${id}:VDD`, `${id}:GND`]);
    // L/R high or floating picks the right slot, and the firmware reads the
    // left. Floating is a guess in real life too, so it counts as wrong.
    if (!n.same(`${id}:L/R`, 'esp:GND')) add('silent', 'mic-right-slot', [`${id}:L/R`]);

    clocks(`${id}:SCK`, `${id}:WS`, add);
    if (!n.same(`${id}:SD`, 'esp:GPIO15')) add('silent', 'mic-data', [`${id}:SD`]);
    busFaults([`${id}:SCK`, `${id}:WS`, `${id}:SD`], add);

    parts[id] = { kind: 'mic', path: /** @type {Path} */ (worst(states)) };
  }

  /** @param {string} id @returns {string[]} */
  const speakerFaultPoints = (id) => {
    const first = speakers[0];
    return [`${id}:+`, `${id}:-`, ...(first ? [`${first.id}:+`, `${first.id}:-`] : [])];
  };

  for (const p of amps) {
    const id = p.id;
    /** @type {Outcome['mic' | 'amp'][]} */
    const states = [];
    /** @param {Path} path @param {string} code @param {string[]} points */
    const add = (path, code, points) => { states.push(path); faults.push({ code, points }); };

    // Vin on 3V3 works, only softer; it also needs its own ground. Real
    // hardware: without a ground the amp is just as dead as without Vin.
    if (n.same(`${id}:Vin`, 'esp:3V3') && n.same(`${id}:GND`, 'esp:GND')) states.push('quiet');
    else if (!(n.same(`${id}:Vin`, 'esp:5V') && n.same(`${id}:GND`, 'esp:GND'))) add('silent', 'amp-unpowered', [`${id}:Vin`, `${id}:GND`]);
    if (!n.same(`${id}:DIN`, 'esp:GPIO14')) add('silent', 'amp-data', [`${id}:DIN`]);
    // SD low shuts the amp down; floating (or high) leaves it on.
    if (n.same(`${id}:SD`, 'esp:GND')) add('silent', 'amp-shutdown', [`${id}:SD`]);

    clocks(`${id}:BCLK`, `${id}:LRC`, add);
    busFaults([`${id}:BCLK`, `${id}:LRC`, `${id}:DIN`], add);

    // Real hardware: the output is bridged, so the speaker plays the same
    // either way round; it only needs one wire to each terminal, and the
    // terminals not shorted together.
    const onTerminals = speakers.some((s) => {
      const straight = n.same(`${s.id}:+`, `${id}:+`) && n.same(`${s.id}:-`, `${id}:-`);
      const crossed = n.same(`${s.id}:+`, `${id}:-`) && n.same(`${s.id}:-`, `${id}:+`);
      return straight || crossed;
    });
    if (!onTerminals || n.same(`${id}:+`, `${id}:-`)) add('silent', 'speaker', speakerFaultPoints(id));

    parts[id] = { kind: 'amp', path: /** @type {Path | 'quiet'} */ (worst(states)) };
  }

  // Real hardware: the bus is shared, so one chip clocked wrongly garbles the
  // line for the other chips too; a chip that was working hears noise now.
  if (swappedAny) {
    for (const p of [...mics, ...amps]) {
      const state = parts[p.id];
      if ('path' in state && (state.path === 'ok' || state.path === 'quiet')) state.path = 'noise';
    }
  }

  // A speaker plays when it is on an amp's terminals and that amp has power.
  for (const s of speakers) {
    const amp = amps.find((a) => {
      const straight = n.same(`${s.id}:+`, `${a.id}:+`) && n.same(`${s.id}:-`, `${a.id}:-`);
      const crossed = n.same(`${s.id}:+`, `${a.id}:-`) && n.same(`${s.id}:-`, `${a.id}:+`);
      return straight || crossed;
    });
    const path = amp ? /** @type {any} */ (parts[amp.id]).path : 'silent';
    parts[s.id] = { kind: 'speaker', playing: !!amp && (path === 'ok' || path === 'quiet') };
  }

  // Two mics in the left slot share one data line: each talks, the line is
  // noise. A right-slot mic is not in the group — it never drives the line.
  const leftSlot = mics.filter((p) => n.same(`${p.id}:SD`, 'esp:GPIO15') && n.same(`${p.id}:L/R`, 'esp:GND'));
  /** @type {Path} */
  let mic;
  if (leftSlot.length >= 2) {
    mic = 'noise';
    faults.push({ code: 'mics-same-slot', points: leftSlot.map((p) => `${p.id}:SD`) });
  } else if (leftSlot.length === 1) {
    mic = /** @type {Path} */ (/** @type {any} */ (parts[leftSlot[0].id]).path);
  } else {
    mic = 'silent';
  }

  // If any amp can play, the downlink has sound; the rest are judged on their own.
  const amp = amps.length
    ? /** @type {Outcome['amp']} */ (best(amps.map((p) => /** @type {any} */ (parts[p.id]).path)))
    : 'silent';

  return { esp: 'ok', mic, amp, burns, faults, parts, screenModel: null };
}
