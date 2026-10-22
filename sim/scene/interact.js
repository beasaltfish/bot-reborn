// Hands on the bench: picking parts up and pushing them into the breadboard,
// drawing wires between pins and holes, pulling wires out, and lighting up
// everything joined to the point under the cursor. Only in the wiring views;
// the orbit view is for looking.
//
// Nothing here keeps the bench. Each change is a new bench handed to
// `setBench`, which saves it and redraws; what the hands hold meanwhile (a
// lifted part, a wire being drawn) is moved about in the scene directly and
// put back if the drop changes nothing.

import * as THREE from 'three';
import { PARTS, holeAt, holeStrip, holeXY, stripHoles } from '../parts.js';
import { place, addWire, removeWire, pinPoints } from '../bench.js';
import { nets } from '../netlist.js';
import { snapPart } from '../snap.js';
import { BOARD_TOP, boardToWorld, buildWire, dispose, worldToBoard } from './meshes.js';

export { snapPart };

/** @typedef {import('../bench.js').Bench} Bench */
/** @typedef {import('../bench.js').Placed} Placed */
/** @typedef {ReturnType<typeof import('./world.js').createWorld>} World */
/**
 * What is under the cursor: a point a wire can end on (a pin or a hole), a
 * part to pick up, or a wire to pull out.
 * @typedef {{ kind: 'point', point: string, pos: THREE.Vector3 } | { kind: 'part', id: string } | { kind: 'wire', id: string }} Pick
 */

/** How far a press may wander, in CSS pixels, and still be a click. */
const CLICK_SLOP = 5;
/** How high a held part floats over the board, so it is plainly not in yet. */
const HOVER = 1.6;
/** The drop: how long it takes, and how far the far end starts tipped up so the pins go in one after another. */
const DROP_MS = 300;
const DROP_TILT = 0.2;
const MAX_MARKERS = 512;

/** Wires that are not power or ground take these in turn, like a bundle of jumpers. */
const PALETTE = ['#f2c230', '#2e9e57', '#2f6fd0', '#e9782b', '#8b54c9', '#f2f0ea'];
const RED = '#d23a2e';
const BLACK = '#1d1d1f';

/**
 * What a point carries, by its name: the 3V3/5V pins and the + rails are
 * power, GND and the − rails are ground.
 * @param {string} point
 * @returns {'power' | 'ground' | null}
 */
function role(point) {
  const rail = /^bb:(tp|tn|bp|bn)\d+$/.exec(point);
  if (rail) return rail[1].endsWith('p') ? 'power' : 'ground';
  const pin = point.slice(point.indexOf(':') + 1).replace(/\.\d+$/, '');
  if (pin === '3V3' || pin === '5V' || pin === 'VDD' || pin === 'Vin') return 'power';
  if (pin === 'GND') return 'ground';
  return null;
}

/**
 * The colour a new wire gets: red to power, black to ground, as on the real
 * bench, otherwise the next in the bundle.
 * @param {Bench} b
 * @param {string} a
 * @param {string} z
 */
function wireColor(b, a, z) {
  const roles = [role(a), role(z)];
  if (roles.includes('power')) return RED;
  if (roles.includes('ground')) return BLACK;
  const signals = b.wires.filter((w) => w.color !== RED && w.color !== BLACK).length;
  return PALETTE[signals % PALETTE.length];
}

/** @param {number} t */
const easeOut = (t) => 1 - (1 - t) ** 3;

/**
 * A ring per point, drawn over everything so a lit hole under a part or a
 * wire's housing still shows. One InstancedMesh: a whole rail lights in one draw call.
 * @param {THREE.ColorRepresentation} color
 * @param {number} size
 */
function markers(color, size) {
  const geo = new THREE.RingGeometry(size * 0.62, size, 24).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX_MARKERS);
  mesh.renderOrder = 20;
  // The instances move every time; bounds computed once would cull them wrongly.
  mesh.frustumCulled = false;
  mesh.count = 0;
  const m = new THREE.Matrix4();
  return {
    mesh,
    /** @param {THREE.Vector3[]} at */
    set(at) {
      mesh.count = Math.min(at.length, MAX_MARKERS);
      for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, m.makeTranslation(at[i].x, at[i].y + 0.04, at[i].z));
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

/**
 * @param {World} world
 * @param {() => Bench} getBench
 * @param {(b: Bench) => void} setBench  saves and redraws
 * @returns {{ enable(on: boolean): void }}
 */
export function attachInteraction(world, getBench, setBench) {
  const { canvas, scene } = world;
  const raycaster = new THREE.Raycaster();
  const boardTop = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BOARD_TOP);

  const lit = markers(0xffb547, 0.5);
  const aim = markers(0xfffbe8, 0.62);
  scene.add(lit.mesh, aim.mesh);

  const tip = document.createElement('div');
  tip.style.cssText = [
    'position:fixed', 'left:50%', 'bottom:56px', 'transform:translateX(-50%)', 'pointer-events:none',
    'font:500 12px/1 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif', 'letter-spacing:0.02em',
    'color:#f6eee3', 'background:rgba(36,28,21,0.62)', 'padding:6px 12px', 'border-radius:999px',
    'opacity:0', 'transition:opacity 120ms',
  ].join(';');
  // Above the page's status line, which has the bottom edge.
  document.body.append(tip);
  /** @param {string | null} text */
  function say(text) {
    if (text) tip.textContent = text;
    tip.style.opacity = text ? '1' : '0';
  }

  let enabled = true;

  /**
   * @typedef {{
   *   kind: 'part', id: string, def: import('../parts.js').PartDef, group: THREE.Object3D,
   *   rot: Placed['rot'], home: { pos: THREE.Vector3, rotY: number },
   *   offset: THREE.Vector3, x: number, y: number, lifted: boolean,
   *   at: { x: number, y: number } | null, last: PointerEvent,
   * }} PartDrag
   * @typedef {{
   *   kind: 'wire', from: string, fromPos: THREE.Vector3, x: number, y: number,
   *   moved: boolean, armed: boolean, target: string | null, preview: THREE.Object3D | null,
   * }} WireDrag
   * @typedef {{ kind: 'pull', id: string, x: number, y: number }} WirePull
   */
  /** @type {PartDrag | WireDrag | WirePull | null} */
  let drag = null;

  // ---- Where things are -------------------------------------------------

  /** @param {{ clientX: number, clientY: number }} e */
  function aimAt(e) {
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, world.camera);
  }

  /** Where the ray meets the board's top plane (also over the table). */
  function onPlane() {
    return raycaster.ray.intersectPlane(boardTop, new THREE.Vector3());
  }

  /** @param {THREE.Vector3} v */
  function toScreen(v) {
    const r = canvas.getBoundingClientRect();
    const p = v.clone().project(world.camera);
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }

  /** @param {string} id */
  const groupOf = (id) => scene.getObjectByName(`part:${id}`) ?? null;

  /**
   * Every pin a wire can end on, with where on screen its wire end sits.
   * Discarded parts are in the bin; the part in the hand is not a target.
   * @param {Bench} b
   */
  function pins(b) {
    /** @type {{ point: string, pos: THREE.Vector3 }[]} */
    const out = [];
    for (const p of b.placed) {
      if (p.discarded || (drag?.kind === 'part' && drag.id === p.id)) continue;
      const g = groupOf(p.id);
      if (!g) continue;
      g.updateMatrixWorld();
      /** @type {Map<string, THREE.Vector3>} */
      const anchors = g.userData.anchors;
      for (const [name, a] of anchors) out.push({ point: `${p.id}:${name}`, pos: g.localToWorld(a.clone()) });
    }
    return out;
  }

  /**
   * The pin nearest the cursor on screen, if within half a pitch of it.
   * @param {{ clientX: number, clientY: number }} e
   * @returns {Pick | null}
   */
  function nearestPin(e) {
    let best = null;
    let bestD = Infinity;
    for (const p of pins(getBench())) {
      const s = toScreen(p.pos);
      const next = toScreen(p.pos.clone().setX(p.pos.x + 1));
      const pitch = Math.hypot(next.x - s.x, next.y - s.y);
      const d = Math.hypot(s.x - e.clientX, s.y - e.clientY);
      if (d <= pitch / 2 && d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best && { kind: 'point', point: best.point, pos: best.pos };
  }

  /**
   * The hole at a point of the board top. A hole with a pin in it is that
   * pin: a wire pushed there would be on the pin's strip anyway, and the
   * pin is what the user sees.
   * @param {THREE.Vector3} at
   * @returns {Pick | null}
   */
  function holeUnder(at) {
    const { x, y } = worldToBoard(at.x, at.z);
    const hole = holeAt(x, y);
    if (!hole) return null;
    const b = getBench();
    for (const p of b.placed) {
      if (p.discarded || !p.at) continue;
      const taken = pinPoints(b, p).find((q) => q.hole === hole);
      if (taken) {
        const pin = pins(b).find((q) => q.point === taken.pin);
        if (pin) return jumperFor(b, pin, at);
      }
    }
    const h = holeXY(hole);
    const w = boardToWorld(h.x, h.y);
    // A hole under a part's board cannot take a wire on a real bench: the part
    // is in the way. Aiming there means the part's nearest pin, and jumperFor()
    // says where a jumper for that pin really goes.
    const cover = coverOf(b, w.x, w.z);
    if (cover) {
      const own = pins(b).filter((q) => q.point.startsWith(`${cover}:`));
      own.sort((p, q) => p.pos.distanceToSquared(at) - q.pos.distanceToSquared(at));
      return own[0] ? jumperFor(b, own[0], at) : null;
    }
    return { kind: 'point', point: hole, pos: new THREE.Vector3(w.x, BOARD_TOP, w.z) };
  }

  /**
   * Where a wire meant for a pin really ends, the way it would on a bench.
   * A pin seated in the board is under its part: the jumper goes in the free
   * hole of the same strip nearest the aim, which joins it all the same. A
   * pin in no hole (hanging off the board, or a part on the table) takes the
   * jumper itself, a female end slipped over it. A strip with no free hole
   * left takes nothing.
   * @param {Bench} b
   * @param {{ point: string, pos: THREE.Vector3 }} pin
   * @param {THREE.Vector3} at
   * @returns {Pick | null}
   */
  function jumperFor(b, pin, at) {
    full = null;
    const id = pin.point.slice(0, pin.point.indexOf(':'));
    const placed = b.placed.find((p) => p.id === id && !p.discarded);
    const home = placed?.at ? pinPoints(b, placed).find((q) => q.pin === pin.point)?.hole : null;
    if (!placed || !home) return { kind: 'point', point: pin.point, pos: pin.pos };
    const used = new Set();
    for (const p of b.placed) {
      if (p.discarded || !p.at || (drag?.kind === 'part' && drag.id === p.id)) continue;
      for (const q of pinPoints(b, p)) if (q.hole) used.add(q.hole);
    }
    let best = null;
    let bestD = Infinity;
    for (const hole of stripHoles(holeStrip(home))) {
      if (used.has(hole)) continue;
      const h = holeXY(hole);
      const w = boardToWorld(h.x, h.y);
      if (coverOf(b, w.x, w.z)) continue;
      const pos = new THREE.Vector3(w.x, BOARD_TOP, w.z);
      const d = pos.distanceToSquared(at);
      if (d < bestD) {
        best = { kind: /** @type {const} */ ('point'), point: hole, pos };
        bestD = d;
      }
    }
    if (!best) full = pin.point;
    return best;
  }

  /** The pin the last aim meant but could not reach: its strip had no free hole. */
  /** @type {string | null} */
  let full = null;

  /**
   * The part whose board lies over a point of the board top, if any. Shrunk
   * by a fifth of a pitch so a hole beside a part's edge stays free.
   * World units are pitches (meshes.js).
   * @param {Bench} b @param {number} x @param {number} z
   * @returns {string | null}
   */
  function coverOf(b, x, z) {
    for (const p of b.placed) {
      if (p.discarded || !p.at || (drag?.kind === 'part' && drag.id === p.id)) continue;
      const g = groupOf(p.id);
      if (!g) continue;
      const box = new THREE.Box3();
      g.updateMatrixWorld();
      g.traverse((o) => {
        if (o instanceof THREE.Mesh && !o.userData.blot) box.expandByObject(o);
      });
      box.expandByScalar(-0.2);
      if (x > box.min.x && x < box.max.x && z > box.min.z && z < box.max.z) return p.id;
    }
    return null;
  }

  /**
   * @param {THREE.Object3D} o
   * @returns {THREE.Object3D | null}  the part, wire or board the mesh belongs to
   */
  function ownerOf(o) {
    /** @type {THREE.Object3D | null} */
    let q = o;
    while (q && !q.userData.kind) q = q.parent;
    return q;
  }

  /**
   * What the cursor is on. `forWire`: only places a wire can end, reaching
   * through parts and wires to the board (the parts in the way are faded).
   * @param {{ clientX: number, clientY: number }} e
   * @param {boolean} forWire
   * @returns {Pick | null}
   */
  function pick(e, forWire) {
    aimAt(e);
    full = null;
    // A seated pin with no free hole left on its strip takes no wire; the
    // press then falls through to the part, which can still be picked up.
    const pin = nearestPin(e);
    const seated = pin && pin.kind === 'point' ? jumperFor(getBench(), pin, pin.pos) : null;
    if (seated) return seated;
    for (const hit of raycaster.intersectObjects(world.pickables, true)) {
      const owner = ownerOf(hit.object);
      if (!owner) continue;
      const { kind, id } = owner.userData;
      if (kind === 'board') return holeUnder(hit.point);
      if (forWire) continue;
      if (kind === 'wire') return { kind: 'wire', id };
      if (kind === 'part') {
        const placed = getBench().placed.find((p) => p.id === id);
        // A discarded part stays in the bin, and the speaker only lives on the table.
        return placed && !placed.discarded && PARTS[placed.part].onBoard ? { kind: 'part', id } : null;
      }
    }
    return null;
  }

  // ---- Lighting up a net ------------------------------------------------

  /**
   * Where a point is in the world, for a ring around it.
   * @param {Bench} b
   * @param {string} point
   */
  function position(b, point) {
    if (point.startsWith('bb:')) {
      const h = holeXY(point);
      const w = boardToWorld(h.x, h.y);
      return new THREE.Vector3(w.x, BOARD_TOP, w.z);
    }
    return pins(b).find((p) => p.point === point)?.pos ?? null;
  }

  /** @type {{ bench: Bench, point: string | null }} */
  let shown = { bench: getBench(), point: null };

  /**
   * Light every point joined to `point`. The netlist is walked once per
   * point, not per mouse move: it costs a pass over every hole.
   * @param {string | null} point
   */
  function light(point) {
    const b = getBench();
    if (shown.point === point && shown.bench === b) return;
    shown = { bench: b, point };
    if (!point) {
      lit.set([]);
    } else {
      /** @type {THREE.Vector3[]} */
      const at = [];
      for (const m of nets(b).members(point)) {
        const p = position(b, m);
        if (p) at.push(p);
      }
      lit.set(at);
    }
    world.requestRender();
  }

  // ---- Fading what is in the way ---------------------------------------

  /** @type {WeakMap<THREE.Material, THREE.Material>} */
  const ghosts = new WeakMap();
  /** @param {THREE.Material} m */
  function ghostOf(m) {
    let g = ghosts.get(m);
    if (!g) {
      g = m.clone();
      g.transparent = true;
      g.opacity = m.opacity * 0.5;
      g.depthWrite = false;
      ghosts.set(m, g);
    }
    return g;
  }
  /** @type {Set<THREE.Object3D>} */
  let faded = new Set();

  /**
   * Fade these parts and bring back the rest. The materials are shared
   * between parts, so a faded part gets see-through copies rather than
   * changing what every part of that colour looks like.
   * @param {Set<THREE.Object3D>} next
   */
  function fade(next) {
    for (const g of faded) {
      if (next.has(g)) continue;
      g.traverse((o) => {
        if (o instanceof THREE.Mesh && o.userData.solid) {
          o.material = o.userData.solid;
          delete o.userData.solid;
        }
      });
    }
    for (const g of next) {
      if (faded.has(g)) continue;
      g.traverse((o) => {
        if (!(o instanceof THREE.Mesh) || o.userData.solid) return;
        o.userData.solid = o.material;
        o.material = Array.isArray(o.material) ? o.material.map(ghostOf) : ghostOf(o.material);
      });
    }
    faded = next;
  }

  /** The parts the ray from the eye to the cursor passes through (aimAt first). */
  function inTheWay() {
    /** @type {Set<THREE.Object3D>} */
    const out = new Set();
    const parts = world.pickables.filter((o) => o.userData.kind === 'part');
    for (const hit of raycaster.intersectObjects(parts, true)) {
      const owner = ownerOf(hit.object);
      if (owner) out.add(owner);
    }
    return out;
  }

  // ---- Parts ------------------------------------------------------------

  /** @param {PartDrag} d */
  function lift(d) {
    d.lifted = true;
    light(null);
    canvas.style.cursor = 'grabbing';
    say('R to rotate · drop it off the board to put it back');
  }

  /** @param {PartDrag} d */
  function carry(d) {
    aimAt(d.last);
    const p = onPlane();
    if (!p) return;
    const origin = p.add(d.offset);
    const { x, y } = worldToBoard(origin.x, origin.z);
    d.at = snapPart(d.def, x, y, d.rot);
    if (d.at) {
      const w = boardToWorld(d.at.x, d.at.y);
      d.group.position.set(w.x, BOARD_TOP + HOVER, w.z);
      // Ring the holes the pins would go into, so the user sees which strips before letting go.
      /** @type {Placed} */
      const trial = { id: d.id, part: d.def.id, at: d.at, rot: d.rot, onBoard: true, burnt: false, discarded: false };
      aim.set(pinPoints(getBench(), trial).flatMap((q) => (q.hole ? [/** @type {THREE.Vector3} */ (position(getBench(), q.hole))] : [])));
    } else {
      d.group.position.set(origin.x, BOARD_TOP + HOVER, origin.z);
      aim.set([]);
    }
    d.group.rotation.y = -THREE.MathUtils.degToRad(d.rot);
    world.requestRender();
  }

  /** @param {PartDrag} d */
  function turn(d) {
    d.rot = /** @type {Placed['rot']} */ ((d.rot + 90) % 360);
    // Turn about the point held, not the origin pin, so the part stays under the hand.
    d.offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
    carry(d);
  }

  /** @param {PartDrag} d */
  function putBack(d) {
    d.group.position.copy(d.home.pos);
    d.group.rotation.y = d.home.rotY;
  }

  /** @param {PartDrag} d */
  function drop(d) {
    const b = getBench();
    const was = b.placed.find((p) => p.id === d.id && !p.discarded);
    // Back on the table a part lies the way its slot was laid out for:
    // turned, the amp would lie across the ESP32 beside it.
    const rot = d.at ? d.rot : 0;
    const same = was && was.rot === rot && (was.at === null ? d.at === null : d.at !== null && was.at.x === d.at.x && was.at.y === d.at.y);
    if (!was || same) {
      putBack(d);
      world.requestRender();
      return;
    }
    setBench(place(b, d.id, d.at, rot));
    if (d.at) seat(d.id);
  }

  /**
   * The part just pushed in: it comes down from where it was held, tipped
   * so its origin pin goes in first and the rest follow along the row.
   * Runs frames only until it lands.
   * @param {string} id
   */
  function seat(id) {
    const g = groupOf(id);
    if (!g) return;
    const y = g.position.y;
    const start = performance.now();
    /** @param {number} now */
    const tick = (now) => {
      if (!g.parent) return;
      const t = Math.min(1, (now - start) / DROP_MS);
      g.position.y = y + HOVER * (1 - easeOut(Math.min(1, t / 0.45)));
      // Euler XYZ applies z first, in the part's own frame: the far end of the row tips up.
      g.rotation.z = DROP_TILT * (1 - easeOut(t));
      world.requestRender();
      if (t < 1) requestAnimationFrame(tick);
    };
    tick(start);
  }

  // ---- Wires ------------------------------------------------------------

  /**
   * Where the wire's free end would go in: a pin or hole other than its start.
   * @param {WireDrag} d
   * @param {{ clientX: number, clientY: number }} e
   */
  function endAt(d, e) {
    const t = pick(e, true);
    d.target = t?.kind === 'point' && t.point !== d.from ? t.point : null;
    return t;
  }

  /**
   * Draw the wire as it would be if let go here, fading the parts in the way.
   * @param {WireDrag} d
   * @param {{ clientX: number, clientY: number }} e
   */
  function stretch(d, e) {
    const t = endAt(d, e);
    // Said while it holds, so a wire that will not go in is never a silent no.
    if (!t && full) say(`No free hole left beside ${full.replace(':', ' ')}: the part covers its column`);
    else if (d.moved || d.armed) say(d.armed ? 'Click a pin or a hole to end the wire · Esc to cancel' : 'Let go on a pin or a hole · Esc to cancel');
    aim.set(t?.kind === 'point' ? [d.fromPos, t.pos] : [d.fromPos]);
    fade(inTheWay());
    const end = t?.kind === 'point' ? t.pos : onPlane();
    if (d.preview) {
      scene.remove(d.preview);
      dispose(d.preview);
      d.preview = null;
    }
    if (end && end.distanceTo(d.fromPos) > 0.5) {
      d.preview = buildWire(d.fromPos, end, wireColor(getBench(), d.from, d.target ?? d.from));
      scene.add(d.preview);
    }
    world.requestRender();
  }

  /** @param {WireDrag} d */
  function connect(d) {
    const b = getBench();
    const to = d.target;
    if (!to) return;
    const dup = b.wires.some((w) => (w.a === d.from && w.b === to) || (w.a === to && w.b === d.from));
    if (!dup) setBench(addWire(b, d.from, to, wireColor(b, d.from, to)));
  }

  // ---- The hand ---------------------------------------------------------

  /** Let go of whatever is held, changing nothing. */
  function cancel() {
    if (drag?.kind === 'part' && drag.lifted) putBack(drag);
    if (drag?.kind === 'wire' && drag.preview) {
      scene.remove(drag.preview);
      dispose(drag.preview);
    }
    drag = null;
    fade(new Set());
    aim.set([]);
    light(null);
    say(null);
    canvas.style.cursor = '';
    world.requestRender();
  }

  /** @param {PointerEvent} e @param {{ x: number, y: number }} from */
  const wandered = (e, from) => Math.hypot(e.clientX - from.x, e.clientY - from.y) > CLICK_SLOP;

  // Captured, so it runs before OrbitControls' own listener on the canvas: a
  // press on a part, pin, hole or wire is ours and must not also turn the
  // camera; a press on empty space is left to the controls.
  canvas.addEventListener('pointerdown', (e) => {
    if (!enabled || e.button !== 0 || !e.isPrimary) return;
    // The second click (or tap) of a wire drawn click-to-click: where it ends is settled on release.
    if (drag?.kind === 'wire' && drag.armed) {
      e.stopImmediatePropagation();
      stretch(drag, e);
      return;
    }
    const t = pick(e, false);
    if (!t) return;
    e.stopImmediatePropagation();
    canvas.setPointerCapture(e.pointerId);
    if (t.kind === 'point') {
      drag = { kind: 'wire', from: t.point, fromPos: t.pos, x: e.clientX, y: e.clientY, moved: false, armed: false, target: null, preview: null };
      light(t.point);
      aim.set([t.pos]);
      world.requestRender();
    } else if (t.kind === 'wire') {
      drag = { kind: 'pull', id: t.id, x: e.clientX, y: e.clientY };
    } else {
      const placed = /** @type {Placed} */ (getBench().placed.find((p) => p.id === t.id && !p.discarded));
      const group = groupOf(t.id);
      const p = onPlane();
      if (!group || !p) return;
      drag = {
        kind: 'part', id: t.id, def: PARTS[placed.part], group, rot: placed.rot,
        home: { pos: group.position.clone(), rotY: group.rotation.y },
        offset: group.position.clone().sub(p).setY(0),
        x: e.clientX, y: e.clientY, lifted: false, at: placed.at, last: e,
      };
    }
  }, { capture: true });

  /** @type {PointerEvent | null} */
  let moved = null;
  canvas.addEventListener('pointermove', (e) => {
    if (!enabled || !e.isPrimary) return;
    // Handled once a frame: a mouse reports moves faster than the screen redraws.
    if (!moved) requestAnimationFrame(() => {
      const ev = /** @type {PointerEvent} */ (moved);
      moved = null;
      onMove(ev);
    });
    moved = e;
  });

  /** @param {PointerEvent} e */
  function onMove(e) {
    if (!enabled) return;
    if (!drag) {
      if (e.buttons !== 0) return;
      const t = pick(e, false);
      light(t?.kind === 'point' ? t.point : null);
      canvas.style.cursor = t?.kind === 'part' ? 'grab' : t?.kind === 'wire' ? 'pointer' : t ? 'crosshair' : '';
      return;
    }
    if (drag.kind === 'part') {
      drag.last = e;
      if (!drag.lifted && wandered(e, drag)) lift(drag);
      if (drag.lifted) carry(drag);
    } else if (drag.kind === 'wire') {
      if (!drag.moved && wandered(e, drag)) {
        drag.moved = true;
        if (!drag.armed) say('Let go on a pin or a hole · Esc to cancel');
      }
      if (drag.moved || drag.armed) stretch(drag, e);
    } else if (wandered(e, drag)) {
      drag = null;
    }
  }

  canvas.addEventListener('pointerup', (e) => {
    if (!enabled || !drag || !e.isPrimary) return;
    const d = drag;
    if (d.kind === 'wire') {
      if (!d.armed && !d.moved && !wandered(e, d)) {
        // A click (or a tap) on a pin starts a wire whose end is the next click.
        d.armed = true;
        say('Click a pin or a hole to end the wire · Esc to cancel');
        return;
      }
      endAt(d, e);
      const done = { ...d };
      cancel();
      connect(done);
      return;
    }
    if (d.kind === 'part') {
      d.last = e;
      const wasLifted = d.lifted;
      if (wasLifted) carry(d);
      // drop() needs the part's home pose, which cancel() would put it back to.
      drag = null;
      say(null);
      aim.set([]);
      canvas.style.cursor = '';
      if (wasLifted) drop(d);
      world.requestRender();
      return;
    }
    drag = null;
    if (wandered(e, d)) return;
    setBench(removeWire(getBench(), d.id));
    // What was lit was the net with that wire in it.
    light(null);
  });

  canvas.addEventListener('pointercancel', () => cancel());

  addEventListener('keydown', (e) => {
    if (!drag || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.code === 'Escape') cancel();
    else if (e.code === 'KeyR' && !e.repeat && !e.metaKey && !e.ctrlKey && drag.kind === 'part' && drag.lifted) turn(drag);
  });
  addEventListener('blur', () => cancel());

  return {
    /** Hands work in every view; this only pauses them (nothing calls it off today). */
    enable(on) {
      if (!on) cancel();
      enabled = on;
    },
  };
}
