import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyBench, pinPoints } from '../../sim/bench.js';
import { targetFor } from '../../sim/target.js';
import { powerOn } from '../../sim/power.js';
import { PARTS, BOARD_OUTLINE, boardToTable, holeStrip, holeXY } from '../../sim/parts.js';
import { partFootprint, under } from '../../sim/snap.js';
import { nets } from '../../sim/netlist.js';
import { BIN } from '../../sim/layout.js';
import { SCREENS } from '../../core/screens.js';
import { RECIPES, DEFAULT_SCREEN, startBench, recipeSteps, applyStep } from '../../sim/recipes.js';
import { obstacles, overlaps, stepCar } from '../../sim/car.js';

/** @typedef {import('../../sim/bench.js').Bench} Bench */

/** @param {string} recipe @param {string} [screen] */
const build = (recipe, screen) =>
  recipeSteps(/** @type {any} */ (recipe), screen).reduce(applyStep, startBench(emptyBench()));

/** Every recipe the user can pick: audio, and screen with each model.
 * @type {{ name: string, recipe: string, screen?: string }[]} */
const CASES = [
  { name: 'audio', recipe: 'audio', screen: undefined },
  { name: 'toy', recipe: 'toy', screen: undefined },
  ...SCREENS.map((/** @type {{ id: string }} */ s) => ({ name: `screen ${s.id}`, recipe: 'screen', screen: s.id })),
];

test('every recipe builds a bench that works', () => {
  for (const { name, recipe, screen } of CASES) {
    const b = build(recipe, screen);
    const out = powerOn(b);
    assert.equal(out.esp, 'ok', name);
    assert.equal(out.mic, 'ok', name);
    assert.equal(out.amp, 'ok', name);
    assert.deepEqual(out.burns, [], name);
    assert.deepEqual(out.faults, [], name);
    if (recipe === 'screen') {
      const scr = b.placed.find((p) => p.id === 'scr');
      assert.ok(scr, name);
      assert.deepEqual(out.parts.scr, { kind: 'screen', show: 'ready' }, name);
    }
  }
});

test('each target wire appears exactly once', () => {
  for (const { name, recipe, screen } of CASES) {
    const b = build(recipe, screen);
    const steps = recipeSteps(/** @type {any} */ (recipe), screen);
    const wires = steps.filter((s) => s.kind === 'wire');
    const want = targetFor(b);
    assert.equal(wires.length, want.length, name);
    // Each recipe wire is one target link: the pair of pins it names.
    const named = wires.map((w) => (w.named ?? []).join(' '));
    assert.deepEqual(named, want.map((l) => `${l.a} ${l.b}`), name);
    assert.equal(new Set(named).size, named.length, name);
    // And the wire really joins them: its ends are on the pins' nets.
    const n = nets(b);
    for (const [i, w] of wires.entries()) {
      assert.ok(n.same(w.a, want[i].a), `${name} ${w.a}`);
      assert.ok(n.same(w.b, want[i].b), `${name} ${w.b}`);
      assert.ok(n.same(want[i].a, want[i].b), `${name} ${want[i].a} is joined to ${want[i].b}`);
    }
  }
});

test('every wire end is a place a hand could reach', () => {
  for (const { name, recipe, screen } of CASES) {
    const b = build(recipe, screen);
    const seated = b.placed.filter((p) => p.seated);
    const filled = new Set(seated.flatMap((p) => pinPoints(b, p).map((q) => q.hole)));
    const used = new Set();
    for (const w of recipeSteps(/** @type {any} */ (recipe), screen).filter((s) => s.kind === 'wire')) {
      for (const [end, pin] of /** @type {[string, string | undefined][]} */ ([[w.a, w.named?.[0]], [w.b, w.named?.[1]]])) {
        assert.ok(pin, name);
        const placed = b.placed.find((p) => pin.startsWith(`${p.id}:`));
        const home = placed && pinPoints(b, placed).find((q) => q.pin === pin)?.hole;
        if (!home) {
          assert.equal(end, pin, `${name} ${pin} is loose, so the wire takes it directly`);
          continue;
        }
        const [boardId, local] = home.split(':');
        const [eb, el] = end.split(':');
        assert.equal(eb, boardId, `${name} ${end}`);
        assert.equal(holeStrip(el), holeStrip(local), `${name} ${end} shares ${pin}'s strip`);
        assert.ok(!filled.has(end), `${name} ${end} holds a pin`);
        const bd = /** @type {NonNullable<typeof b.boards[0]>} */ (b.boards.find((x) => x.id === eb));
        const h = holeXY(el);
        const t = boardToTable(bd, h.x, h.y);
        assert.ok(!under(b, t.x, t.z).parts.some((p) => p.seated), `${name} ${end} is under a part`);
        assert.ok(!used.has(end), `${name} ${end} takes two wires`);
        used.add(end);
      }
    }
  }
});

test('the order is boards, parts, wires, usb', () => {
  const rank = { board: 0, part: 1, wire: 2, usb: 3 };
  for (const { name, recipe, screen } of CASES) {
    const steps = recipeSteps(/** @type {any} */ (recipe), screen);
    const ranks = steps.map((s) => rank[s.kind]);
    assert.deepEqual(ranks, [...ranks].sort((x, y) => x - y), name);
    assert.equal(steps.at(-1)?.kind, 'usb', name);
    assert.deepEqual(steps.filter((s) => s.kind === 'board').map((s) => s.id), ['bb1', 'bb2'], name);
    for (const s of steps) assert.ok(s.say.length > 0, name);
  }
});

test('the ESP32 sits across both boards', () => {
  const b = build('audio');
  const esp = b.placed.find((p) => p.id === 'esp');
  assert.ok(esp && esp.seated);
  const holes = pinPoints(b, esp).map((p) => p.hole);
  assert.ok(holes.some((h) => h?.startsWith('bb1:')));
  assert.ok(holes.some((h) => h?.startsWith('bb2:')));
  assert.ok(holes.every((h) => h && !/:(tp|tn|bp|bn)\d+$/.test(h)), 'no pin in a rail');
});

test('the mic and amp are seated, the speaker and screen are not', () => {
  for (const { name, recipe, screen } of CASES) {
    const b = build(recipe, screen);
    for (const p of b.placed) {
      const want = p.id === 'mic' || p.id === 'amp' || p.id === 'esp';
      assert.equal(p.seated, want, `${name} ${p.id}`);
      if (p.id !== 'mic' && p.id !== 'amp') continue;
      for (const q of pinPoints(b, p).filter((q) => !PARTS[p.part].pins.find((x) => `${p.id}:${x.name}` === q.pin)?.wireOnly)) {
        assert.ok(q.hole && !/:(tp|tn|bp|bn)\d+$/.test(q.hole), `${name} ${q.pin}`);
      }
    }
  }
});

test('no recipe layout touches the bin', () => {
  const bin = { x0: BIN.x - BIN.size / 2, x1: BIN.x + BIN.size / 2, z0: BIN.z - BIN.size / 2, z1: BIN.z + BIN.size / 2 };
  const miss = (/** @type {{ x0: number, x1: number, z0: number, z1: number }} */ t) =>
    t.x1 <= bin.x0 || bin.x1 <= t.x0 || t.z1 <= bin.z0 || bin.z1 <= t.z0;
  for (const { name, recipe, screen } of CASES) {
    const b = build(recipe, screen);
    for (const bd of b.boards) {
      const a = boardToTable(bd, BOARD_OUTLINE.x0, BOARD_OUTLINE.y0);
      const c = boardToTable(bd, BOARD_OUTLINE.x1, BOARD_OUTLINE.y1);
      assert.ok(miss({ x0: Math.min(a.x, c.x), x1: Math.max(a.x, c.x), z0: Math.min(a.z, c.z), z1: Math.max(a.z, c.z) }), `${name} ${bd.id}`);
    }
    for (const p of b.placed) {
      const fp = partFootprint(PARTS[p.part], p.rot);
      const cx = p.at.x + fp.dx;
      const cz = p.at.z + fp.dz;
      assert.ok(miss({ x0: cx - fp.w / 2, x1: cx + fp.w / 2, z0: cz - fp.d / 2, z1: cz + fp.d / 2 }), `${name} ${p.id}`);
    }
  }
});

test('startBench keeps only the ESP32', () => {
  const messy = { ...emptyBench(), usb: true, wires: [{ id: 'w1', a: 'mic:VDD', b: 'esp:3V3', color: 'red' }] };
  const b = startBench(messy);
  assert.deepEqual(b.placed.map((p) => p.id), ['esp']);
  assert.deepEqual(b.placed[0].at, { x: -10.5, z: 16 });
  assert.equal(b.placed[0].seated, false);
  assert.deepEqual(b.wires, []);
  assert.equal(b.usb, false);
});

test('the recipes are listed', () => {
  assert.deepEqual(RECIPES.map((r) => r.id), ['audio', 'screen', 'toy']);
  assert.equal(RECIPES[0].ending, 'Say hello');
  assert.equal(RECIPES[1].ending, 'Say "Sit"');
  assert.equal(RECIPES[2].ending, 'Say "go forward"');
  assert.ok(SCREENS.some((/** @type {{ id: string }} */ s) => s.id === DEFAULT_SCREEN));
});

test('with the wand option, every recipe also wires a wand that wakes', () => {
  for (const { name, recipe, screen } of CASES) {
    const steps = recipeSteps(/** @type {any} */ (recipe), screen, true);
    const b = steps.reduce(applyStep, startBench(emptyBench()));
    const wand = b.placed.find((p) => p.part === 'mpu6050');
    assert.ok(wand, name);
    assert.deepEqual(powerOn(b).parts[wand.id], { kind: 'imu', awake: true }, name);
    assert.deepEqual(powerOn(b).burns, [], name);
    const named = steps.filter((s) => s.kind === 'wire').map((w) => (w.named ?? []).join(' '));
    assert.deepEqual(named, targetFor(b).map((l) => `${l.a} ${l.b}`), name);
    // Without the option there is no wand.
    assert.equal(build(recipe, screen).placed.some((p) => p.part === 'mpu6050'), false, name);
  }
});

test('the toy recipe parks it facing the viewer, with room to drive', () => {
  const b = build('toy');
  const toy = b.placed.find((p) => p.id === 'toy');
  assert.deepEqual(toy?.at, { x: -55, z: -55 });
  assert.equal(toy?.heading, 90, 'its face is what you see when the bench comes alive');
  assert.equal(/** @type {any} */ (powerOn(b).parts.toy).wheels, 'coast');
  const g = {
    bounds: { x0: -120, x1: 120, z0: -70, z1: 70 },
    obstacles: obstacles(b, 'toy'),
    leash: null,
  };
  const parked = { x: -55, z: -55, heading: 90 };
  assert.equal(overlaps(parked, g), false, 'parked clear of the bench, the bin and the loose parts');
  // Forward walks it towards the viewer: it gets at least 15 cm before anything stops it.
  const run = stepCar(parked, { wheels: 'forward', steer: 'straight' }, 4000, g);
  const travelled = Math.hypot(run.pose.x - parked.x, run.pose.z - parked.z);
  assert.ok(travelled > 40, `only got ${travelled}`);
});
