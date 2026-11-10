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
import { PARTS } from './parts.js';
import { screenById } from '../core/screens.js';
import { toyWiring, toyAction, TOY_INPUTS } from './car.js';

/**
 * @typedef {'ok' | 'silent' | 'noise'} Path
 * @typedef {'off' | 'dark' | 'white' | 'garbage' | 'ready'} ScreenShow
 * @typedef {{ kind: 'mic', path: Path }
 *   | { kind: 'amp', path: Path | 'quiet' }
 *   | { kind: 'speaker', playing: boolean }
 *   | { kind: 'screen', show: ScreenShow }
 *   | { kind: 'imu', awake: boolean }
 *   | { kind: 'toy', wheels: import('./car.js').ToyAction['wheels'], steer: import('./car.js').ToyAction['steer'] }
 * } PartState
 * @typedef {{
 *   esp: 'ok' | 'brownout' | 'off',
 *   mic: Path, amp: Path | 'quiet',
 *   burns: string[],
 *   faults: { code: string, points: string[] }[],
 *   parts: Record<string, PartState>,
 *   screenModel: string | null,
 *   toys: Record<string, { wiring: import('./car.js').Wiring, action: import('./car.js').ToyAction }>,
 * }} Outcome
 */

const RAILS = ['esp:3V3', 'esp:5V', 'esp:GND'];
const BUS = ['esp:GPIO12', 'esp:GPIO13', 'esp:GPIO14', 'esp:GPIO15'];
/** The panel's own signals, on the pins board.h gives them (multi-screen spec §5.5). */
const SCREEN_BUS = ['esp:GPIO8', 'esp:GPIO9', 'esp:GPIO10', 'esp:GPIO11', 'esp:GPIO18'];
/** The tarot wand's I2C pair (wand spec §5): the firmware will read it on these. */
const I2C = { sda: 'esp:GPIO1', scl: 'esp:GPIO2' };

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
  const screens = b.placed.filter((p) => p.part.startsWith('screen-'));
  const wands = b.placed.filter((p) => p.part === 'mpu6050');
  const toys = b.placed.filter((p) => p.part === 'toy');

  /** @type {Record<string, PartState>} */
  const parts = {};
  for (const p of mics) parts[p.id] = { kind: 'mic', path: 'silent' };
  for (const p of amps) parts[p.id] = { kind: 'amp', path: 'silent' };
  for (const p of speakers) parts[p.id] = { kind: 'speaker', playing: false };
  for (const p of screens) parts[p.id] = { kind: 'screen', show: 'off' };
  for (const p of wands) parts[p.id] = { kind: 'imu', awake: false };
  for (const p of toys) parts[p.id] = { kind: 'toy', wheels: 'dead', steer: 'dead' };

  /** No power at all: every instance is its resting state. */
  if (!b.usb) return { esp: 'off', mic: 'silent', amp: 'silent', burns: [], faults: [], parts, screenModel: null, toys: {} };
  const n = nets(b);

  // Two supply pins in one net: the board's own regulator is shorted and it
  // resets over and over; nothing downstream gets a clean supply. Nothing else
  // is meaningful then, so nothing else is reported.
  const shorted = RAILS.filter((p, i) => RAILS.some((q, j) => j > i && n.same(p, q)));
  if (shorted.length) {
    const points = RAILS.filter((p) => RAILS.some((q) => q !== p && n.same(p, q)));
    return { esp: 'brownout', mic: 'silent', amp: 'silent', burns: [], faults: [{ code: 'short-rails', points }], parts, screenModel: null, toys: {} };
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

  // The wand is judged like a mic: a burnt one stays dead, 5V burns it, no
  // supply silences it; then its two bus wires, which must be on GPIO 1 and 2.
  for (const p of wands) {
    const id = p.id;
    const [vcc, gnd, sda, scl] = ['VCC', 'GND', 'SDA', 'SCL'].map((pin) => `${id}:${pin}`);
    let ok = true;
    /** @param {string} code @param {string[]} points */
    const add = (code, points) => { ok = false; faults.push({ code, points }); };

    if (p.burnt) add('imu-burnt', [vcc]);
    else if (n.same(vcc, 'esp:5V')) { burns.push(id); add('imu-5v', [vcc, 'esp:5V']); }
    else if (!n.same(vcc, 'esp:3V3') || !n.same(gnd, 'esp:GND')) add('imu-unpowered', [vcc, gnd]);

    if (n.same(sda, scl) || [sda, scl].some((q) => RAILS.some((r) => n.same(q, r)))) add('imu-bus-short', [sda, scl]);
    else if (n.same(sda, I2C.scl) && n.same(scl, I2C.sda)) add('imu-bus-swapped', [sda, scl]);
    else if (!n.same(sda, I2C.sda) || !n.same(scl, I2C.scl)) add('imu-bus', [sda, scl]);

    parts[id] = { kind: 'imu', awake: ok };
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

  /** Screens that got through every rule but the mixed-model one. */
  /** @type {{ id: string, model: string }[]} */
  const candidates = [];
  for (const p of screens) {
    const id = p.id;
    const model = screenById(PARTS[p.part].model ?? '');
    if (!model) continue;

    /** @param {import('../core/screens.js').PinRole} role @returns {string | null} */
    const pointOf = (role) => {
      const pin = PARTS[p.part].pins.find((q) => q.role === role);
      return pin ? `${id}:${pin.name}` : null;
    };
    /** @param {import('../core/screens.js').PinRole} role @param {string} target */
    const on = (role, target) => {
      const point = pointOf(role);
      return !!point && n.same(point, target);
    };
    /** @param {string} code @param {string[]} points */
    const fault = (code, points) => faults.push({ code, points });

    /** @type {ScreenShow | null} */
    let show = null;

    // In order, first hit wins (spec §5.5): the panel cannot do better than
    // what stopped it here.
    if (p.burnt) {
      show = 'off';
      fault('screen-burnt', [pointOf('VCC') ?? `${id}:VCC`]);
    } else if (model.vcc === '3v3' && on('VCC', 'esp:5V')) {
      burns.push(id);
      show = 'off';
      fault('screen-5v', [pointOf('VCC') ?? `${id}:VCC`, 'esp:5V']);
    } else if (!(on('VCC', 'esp:3V3') || on('VCC', 'esp:5V')) || !on('GND', 'esp:GND')) {
      show = 'off';
      fault('screen-unpowered', [pointOf('VCC'), pointOf('GND')].filter(/** @returns {p is string} */ (p) => !!p));
    } else if (model.vcc === '5v' && on('VCC', 'esp:3V3')) {
      // The regulator on the module drops what is left below what the panel needs.
      show = 'off';
      fault('screen-needs-5v', [pointOf('VCC') ?? `${id}:VCC`, 'esp:3V3']);
    }

    if (show === null) {
      const bl = pointOf('BL');
      let lit = true;
      if (bl) {
        if (n.same(bl, 'esp:3V3') || n.same(bl, 'esp:5V')) lit = true;
        else if (n.same(bl, 'esp:GND')) lit = false;
        else if (n.members(bl).some((q) => /^esp:GPIO\d/.test(q))) {
          // It works, but nothing in the diagram drives a backlight from a GPIO.
          lit = true;
          fault('bl-on-gpio', [bl]);
        } else {
          // In a hole on its own, or on the table with no wire: the module's
          // own pull-up (or lack of one) decides.
          const floating = !b.wires.some((w) => n.same(w.a, bl))
            && !n.members(bl).some((q) => q !== bl && !/^bb\d+:/.test(q) && !q.startsWith(`${id}:`));
          lit = floating && model.blDefault === 'on';
        }
      }
      if (!lit) {
        show = 'dark';
        fault('screen-backlight', bl ? [bl] : []);
      }
    }

    // A GPIO shared with another GPIO, or held at a rail, never carries the
    // panel's signal. Being on 3V3 is RST's alternative and GND is CS's, so
    // those two are not faults.
    if (show === null) {
      for (const role of /** @type {const} */ (['SCK', 'MOSI', 'DC', 'RST', 'CS'])) {
        const point = pointOf(role);
        if (!point) continue;
        const group = SCREEN_BUS.filter((g) => n.same(g, point));
        if (group.length >= 2) {
          show = 'white';
          fault('screen-pins-shorted', [...group, point]);
          break;
        }
        const rail = RAILS.find((r) => n.same(point, r));
        if (rail && !((role === 'RST' && rail === 'esp:3V3') || (role === 'CS' && rail === 'esp:GND'))) {
          show = 'white';
          fault('screen-bus-on-rail', [point, rail]);
          break;
        }
      }
    }

    if (show === null) {
      if (on('SCK', 'esp:GPIO10') && on('MOSI', 'esp:GPIO11')) {
        show = 'white';
        fault('screen-spi-swapped', [pointOf('SCK'), pointOf('MOSI')].filter(/** @returns {p is string} */ (p) => !!p));
      } else {
        /** @type {string[]} */
        const wrong = [];
        for (const [role, target] of /** @type {const} */ ([
          ['SCK', 'esp:GPIO11'], ['MOSI', 'esp:GPIO10'], ['DC', 'esp:GPIO8'],
        ])) {
          const point = pointOf(role);
          if (point && !on(role, target)) wrong.push(point);
        }
        const rst = pointOf('RST');
        if (rst && !(on('RST', 'esp:GPIO18') || on('RST', 'esp:3V3'))) wrong.push(rst);
        if (wrong.length) {
          show = 'white';
          fault('screen-signal', wrong);
        }
      }
    }

    if (show === null && pointOf('CS') && !(on('CS', 'esp:GPIO9') || on('CS', 'esp:GND'))) {
      show = 'white';
      fault('screen-cs', [pointOf('CS') ?? `${id}:CS`]);
    }

    if (show === null) candidates.push({ id, model: model.id });
    else parts[id] = { kind: 'screen', show };
  }

  // The firmware initialises one kind of panel. Two models on chip select 9
  // both get orders for a panel they are not, which is a garbled glass.
  const models = new Set(candidates.map((c) => c.model));
  /** @type {string | null} */
  let screenModel = null;
  if (models.size > 1) {
    for (const c of candidates) parts[c.id] = { kind: 'screen', show: 'garbage' };
    const points = candidates.map((c) => {
      const pin = PARTS[`screen-${c.model}`].pins.find((q) => q.role === 'CS') ?? PARTS[`screen-${c.model}`].pins.find((q) => q.role === 'VCC');
      return pin ? `${c.id}:${pin.name}` : c.id;
    });
    faults.push({ code: 'screens-mixed', points });
  } else {
    for (const c of candidates) parts[c.id] = { kind: 'screen', show: 'ready' };
    if (candidates.length) screenModel = candidates[0].model;
  }

  // The toy robot. Its own battery keeps its drivers alive, so the only things
  // that matter are what each pad reaches and whether the two boards share a
  // ground. A toy with no wire on it is a toy on the table, not a circuit.
  /** @type {Outcome['toys']} */
  const toyStates = {};
  /** @type {import('./car.js').ToyAction} */
  const DEAD_TOY = { wheels: 'dead', steer: 'dead', contended: [] };
  for (const p of toys) {
    const id = p.id;
    const wiring = toyWiring(b, id);
    // The firmware sets its four pins low at boot, so this is what the toy sees
    // the moment USB goes in.
    const action = toyAction(wiring, [false, false, false, false]);
    toyStates[id] = { wiring, action };
    parts[id] = { kind: 'toy', wheels: action.wheels, steer: action.steer };
    if (!wiring.linked) continue;

    /** @param {string} name */
    const pad = (name) => `${id}:${name}`;
    /**
     * @param {import('./car.js').InputName} name
     * @param {string} gpio
     */
    const reaches = (name, gpio) => {
      const src = wiring.inputs[name];
      return src.kind === 'gpio' && src.pins.includes(gpio);
    };

    if (p.burnt) {
      faults.push({ code: 'toy-burnt', points: [pad('U3A')] });
    } else {
      if (wiring.ground === 'floating') faults.push({ code: 'toy-ungrounded', points: [pad('GND'), 'esp:GND'] });
      if (wiring.ground === 'raised') {
        const rail = RAILS.find((r) => r !== 'esp:GND' && n.same(pad('GND'), r)) ?? 'esp:5V';
        faults.push({ code: 'toy-ground-raised', points: [pad('GND'), rail] });
      }

      const missing = TOY_INPUTS.filter((name) => wiring.inputs[name].kind === 'none');
      const missingDrive = missing.filter((m) => m.startsWith('U3'));
      const missingSteer = missing.filter((m) => m.startsWith('U5'));
      if (missingDrive.length) faults.push({ code: 'toy-drive-missing', points: missingDrive.map(pad) });
      if (missingSteer.length) faults.push({ code: 'toy-steer-missing', points: missingSteer.map(pad) });

      if (reaches('U3A', 'esp:GPIO5') && reaches('U3B', 'esp:GPIO4')) {
        faults.push({ code: 'toy-drive-swapped', points: [pad('U3A'), pad('U3B')] });
      }
      if (reaches('U5A', 'esp:GPIO7') && reaches('U5B', 'esp:GPIO6')) {
        faults.push({ code: 'toy-steer-swapped', points: [pad('U5A'), pad('U5B')] });
      }

      const held = TOY_INPUTS.filter((name) => {
        const src = wiring.inputs[name];
        return src.kind === 'rail' && src.level === 'high';
      });
      if (held.length) faults.push({ code: 'toy-input-held', points: held.map(pad) });

      /** @type {import('./car.js').InputName[]} */
      const tied = [];
      if (n.same(pad('U3A'), pad('U3B'))) tied.push('U3A', 'U3B');
      if (n.same(pad('U5A'), pad('U5B'))) tied.push('U5A', 'U5B');
      if (tied.length) faults.push({ code: 'toy-pair-tied', points: tied.map(pad) });

      if (action.contended.length) faults.push({ code: 'toy-input-contended', points: action.contended.map(pad) });

      if (action.wheels === 'short' || action.steer === 'short') {
        burns.push(id);
        faults.push({ code: 'toy-short', points: TOY_INPUTS.map(pad) });
      }
    }

    if (p.burnt || action.wheels === 'short' || action.steer === 'short') {
      parts[id] = { kind: 'toy', wheels: 'dead', steer: 'dead' };
      toyStates[id] = { wiring, action: DEAD_TOY };
    }
  }

  return { esp: 'ok', mic, amp, burns, faults, parts, screenModel, toys: toyStates };
}
