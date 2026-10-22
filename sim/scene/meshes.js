// The bench's things as three.js meshes, all built here from numbers: no model
// files to fetch, so the page opens as fast as the brain can send a few
// scripts, and a part's pins are exactly where parts.js says they are.
//
// One world unit is one breadboard pitch (2.54 mm); y is up, and a part's
// local x/z are parts.js's pin x/y, so a part's origin is its first pin. Text
// (pin names, column numbers) is drawn on canvases once and kept.

import * as THREE from 'three';
import { PARTS, holeAt } from '../parts.js';

/** @typedef {import('../parts.js').PartDef} PartDef */

/** Millimetres to pitch units: parts.js gives part sizes in mm. */
export const MM = 1 / 2.54;

/** Height of the breadboard's top above the table. */
export const BOARD_TOP = 8.5 * MM;

/** The board's outline in breadboard pitch coordinates (holes run 0–62 by 0–17). */
const BOARD = { x0: -1.6, x1: 63.6, y0: -1.8, y1: 18.8 };

/** Where the board's middle is, in pitch coordinates; the world's origin sits under it. */
const BOARD_MID = { x: (BOARD.x0 + BOARD.x1) / 2, y: (BOARD.y0 + BOARD.y1) / 2 };

/**
 * Breadboard pitch coordinates to world x/z, the board lying in the middle of
 * the table with its first column on the left and its top rail at the back.
 * @param {number} x
 * @param {number} y
 */
export function boardToWorld(x, y) {
  return { x: x - BOARD_MID.x, z: y - BOARD_MID.y };
}

/**
 * @param {number} x
 * @param {number} z
 */
export function worldToBoard(x, z) {
  return { x: x + BOARD_MID.x, y: z + BOARD_MID.y };
}

/** How far a male header's pins reach below the part: they stand the part off the table. */
const PIN_LEN = 8.5 * MM;
/** The black plastic collar of a header, one pitch tall. */
const COLLAR = 1;

/** @type {Map<string, THREE.Material>} */
const materials = new Map();
/** @type {Set<THREE.Material>} */
const shared = new Set();

/**
 * Materials are shared by colour so that rebuilding the bench creates no new
 * shader programs and nothing needs disposing but geometry.
 * @param {'matte' | 'gloss' | 'metal'} kind
 * @param {THREE.ColorRepresentation} color
 */
function mat(kind, color) {
  const key = `${kind}:${new THREE.Color(color).getHexString()}`;
  let m = materials.get(key);
  if (!m) {
    m = kind === 'matte'
      ? new THREE.MeshLambertMaterial({ color })
      : new THREE.MeshPhongMaterial({
        color,
        shininess: kind === 'metal' ? 90 : 40,
        specular: kind === 'metal' ? 0xfff0c8 : 0x333333,
      });
    materials.set(key, m);
    shared.add(m);
  }
  return m;
}

/**
 * What a part looks like after it has burnt: the same thing, charred.
 * @param {THREE.ColorRepresentation} color
 */
const charred = (color) => new THREE.Color(color).lerp(new THREE.Color(0x1c130d), 0.75);

const GOLD = 0xc9a13b;
const STEEL = 0xb8bcc0;
const HEADER_BLACK = 0x18181a;

/**
 * @param {number} w
 * @param {number} h
 * @param {number} d
 * @param {THREE.Material | THREE.Material[]} material
 * @param {number} x
 * @param {number} y  the box's bottom, which is how everything here is stacked
 * @param {number} z
 */
function box(w, h, d, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y + h / 2, z);
  return m;
}

/**
 * Many identical small boxes in one draw call: holes, pins, pads.
 * @param {number} w
 * @param {number} h
 * @param {number} d
 * @param {THREE.Material} material
 * @param {{ x: number, y: number, z: number }[]} at  each box's bottom centre
 */
function boxes(w, h, d, material, at) {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(0, h / 2, 0);
  const m = new THREE.InstancedMesh(geo, material, at.length);
  const t = new THREE.Matrix4();
  at.forEach((p, i) => m.setMatrixAt(i, t.makeTranslation(p.x, p.y, p.z)));
  m.instanceMatrix.needsUpdate = true;
  return m;
}

/**
 * A canvas laid flat as a texture, `ppu` pixels per world unit. The callback
 * draws in world units with the canvas's top edge at `z0` (the back).
 * @param {number} w
 * @param {number} d
 * @param {number} ppu
 * @param {(ctx: CanvasRenderingContext2D) => void} draw
 */
function canvasTexture(w, d, ppu, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * ppu);
  canvas.height = Math.ceil(d * ppu);
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  ctx.scale(canvas.width / w, canvas.height / d);
  draw(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {number} size  font size in world units
 * @param {number} [maxW]
 */
function label(ctx, text, x, y, size, maxW) {
  ctx.font = `600 ${size}px ui-sans-serif, "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y, maxW);
}

/** @type {Map<string, THREE.CanvasTexture>} */
const textures = new Map();

/**
 * @param {string} key
 * @param {() => THREE.CanvasTexture} make
 */
function texture(key, make) {
  let t = textures.get(key);
  if (!t) textures.set(key, (t = make()));
  return t;
}

/**
 * A soft dark blot that sits under a thing. Real shadows cost a render pass
 * per light per frame; a blot costs nothing and reads as "resting on the table".
 * @param {number} w
 * @param {number} d
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
function contactShadow(w, d, x, y, z) {
  const tex = texture('shadow', () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    const g = ctx.createRadialGradient(64, 64, 18, 64, 64, 64);
    g.addColorStop(0, 'rgba(40,24,10,0.55)');
    g.addColorStop(1, 'rgba(40,24,10,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(canvas);
  });
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.renderOrder = -1;
  // A blot reaches past its part's edge; it must not catch a click meant for the hole beside it.
  m.raycast = () => {};
  return m;
}

/**
 * Printed text on a board's top: transparent everywhere but the ink, laid just
 * above the surface so the board keeps its own colour and lighting.
 * @param {THREE.Texture} tex
 * @param {number} w
 * @param {number} d
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {boolean} burnt
 */
function decal(tex, w, d, x, y, z, burnt) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false, color: burnt ? 0x444444 : 0xffffff }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y + 0.01, z);
  return m;
}

/** The wooden table: a big plane with a grain drawn once on a canvas. */
export function buildTable() {
  const tex = texture('wood', () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1024;
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    ctx.fillStyle = '#d2ab7e';
    ctx.fillRect(0, 0, 1024, 1024);
    // A fixed seed, so the grain is the same on every load.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 260; i++) {
      const y0 = rnd() * 1024;
      const dark = rnd() < 0.7;
      ctx.strokeStyle = dark ? `rgba(120,78,40,${0.05 + rnd() * 0.12})` : `rgba(255,236,205,${0.05 + rnd() * 0.1})`;
      ctx.lineWidth = 0.6 + rnd() * 2.6;
      ctx.beginPath();
      const amp = 2 + rnd() * 6;
      // Whole waves across the canvas, so the tiles meet without a seam.
      const freq = (2 * Math.PI * (1 + Math.floor(rnd() * 4))) / 1024;
      const phase = rnd() * 6.28;
      for (let x = 0; x <= 1024; x += 16) {
        const y = y0 + Math.sin(x * freq + phase) * amp;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // Plank seams.
    ctx.fillStyle = 'rgba(90,58,30,0.35)';
    for (const y of [0, 256, 512, 768]) ctx.fillRect(0, y, 1024, 2);
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(4, 4);
    t.anisotropy = 8;
    return t;
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(480, 480), new THREE.MeshLambertMaterial({ map: tex }));
  m.rotation.x = -Math.PI / 2;
  m.name = 'table';
  return m;
}

/**
 * Every hole on the board, found by asking parts.js at each grid point, so the
 * board drawn is the board the netlist reasons about.
 */
function holePoints() {
  /** @type {{ x: number, y: number }[]} */
  const out = [];
  for (let y = 0; y <= 17; y++) {
    for (let x = 0; x <= 62; x++) if (holeAt(x, y)) out.push({ x, y });
  }
  return out;
}

/**
 * The breadboard. The board body is the pickable mesh (named 'breadboard');
 * the holes are one InstancedMesh, a few hundred squares in a single draw call.
 */
export function buildBreadboard() {
  const g = new THREE.Group();
  const w = BOARD.x1 - BOARD.x0;
  const d = BOARD.y1 - BOARD.y0;
  const mid = boardToWorld(BOARD_MID.x, BOARD_MID.y);
  const print = texture('breadboard', () => canvasTexture(w, d, 24, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, d);
    ctx.translate(-BOARD.x0, -BOARD.y0);
    // The centre channel and the grooves that set the rails apart.
    ctx.fillStyle = 'rgba(120,112,98,0.32)';
    ctx.fillRect(BOARD.x0, 8.1, w, 0.8);
    ctx.fillStyle = 'rgba(120,112,98,0.16)';
    ctx.fillRect(BOARD.x0, 1.85, w, 0.3);
    ctx.fillRect(BOARD.x0, 14.85, w, 0.3);
    // Red beside each + rail, blue beside each −, the way the real board is printed.
    for (const [y, color] of /** @type {const} */ ([[-0.75, '#d0453c'], [1.6, '#2f63c4'], [15.4, '#d0453c'], [17.75, '#2f63c4']])) {
      ctx.fillStyle = color;
      ctx.fillRect(0.5, y - 0.07, 61, 0.14);
    }
    ctx.fillStyle = 'rgba(80,76,70,0.75)';
    for (let c = 1; c <= 63; c++) {
      if (c === 1 || c % 5 === 0) {
        label(ctx, String(c), c - 1, 2.35, 0.55);
        label(ctx, String(c), c - 1, 14.65, 0.55);
      }
    }
    for (const [row, y] of Object.entries({ a: 3, b: 4, c: 5, d: 6, e: 7, f: 10, g: 11, h: 12, i: 13, j: 14 })) {
      label(ctx, row, -1, y, 0.55);
      label(ctx, row, 63, y, 0.55);
    }
    ctx.fillStyle = '#d0453c';
    label(ctx, '+', -0.9, 0, 0.8);
    label(ctx, '+', -0.9, 16, 0.8);
    ctx.fillStyle = '#2f63c4';
    label(ctx, '−', -0.9, 1, 0.8);
    label(ctx, '−', -0.9, 17, 0.8);
  }));
  const plastic = mat('matte', 0xf3f1ea);
  const top = new THREE.MeshLambertMaterial({ color: 0xf3f1ea, map: print });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, BOARD_TOP, d), [plastic, plastic, top, plastic, plastic, plastic]);
  body.position.set(mid.x, BOARD_TOP / 2, mid.z);
  body.name = 'breadboard';
  body.userData = { kind: 'board' };
  g.add(body);

  const holes = boxes(0.62, 0.02, 0.62, mat('matte', 0x3b3934), holePoints().map(({ x, y }) => {
    const p = boardToWorld(x, y);
    return { x: p.x, y: BOARD_TOP - 0.012, z: p.z };
  }));
  holes.name = 'holes';
  g.add(holes);
  g.add(contactShadow(w + 6, d + 6, mid.x, 0.02, mid.z + 0.6));
  return g;
}

/**
 * A pin's name as printed on the board: "GPIO12" → "12", "GND.2" → "GND".
 * @param {string} name
 */
const printed = (name) => name.replace(/^GPIO/, '').replace(/\.\d+$/, '');

/**
 * What differs between the boards with male headers.
 * @typedef {{
 *   color: number, w: number, d: number, cx: number, cz: number, t: number,
 *   round?: boolean,
 *   silk: (ctx: CanvasRenderingContext2D) => void,
 *   labelDz: (pinY: number) => number, labelSize: number,
 * }} BoardLook
 */

/** @type {Record<'esp32' | 'inmp441' | 'max98357a', BoardLook>} */
const LOOKS = {
  // The two rows are 10 pitches apart and the board 70 mm long, its USB end
  // (pins GND, 5V) at x = 0 and its module and antenna at the far end.
  esp32: {
    color: 0x16171a, w: 70 * MM, d: 28 * MM, cx: 10.5, cz: 5, t: 1.6 * MM,
    labelDz: (y) => (y === 0 ? 1.05 : -1.05), labelSize: 0.42,
    silk: (ctx) => {
      label(ctx, 'ESP32-S3', 7.5, 5, 1.25);
      ctx.font = '600 0.5px ui-sans-serif, Arial, sans-serif';
      label(ctx, 'USB-OTG', 1.6, 3.4, 0.45);
      label(ctx, 'COM', 1.6, 6.6, 0.45);
    },
  },
  max98357a: {
    color: 0x5b2a86, w: 19 * MM, d: 24 * MM, cx: 3, cz: 3.75, t: 1.6 * MM,
    labelDz: () => 1.0, labelSize: 0.38,
    silk: (ctx) => {
      label(ctx, 'MAX98357A', 3, 2.55, 0.55);
      label(ctx, 'I2S Amp', 3, 3.3, 0.45);
      label(ctx, '+', 2, 8.05, 0.55);
      label(ctx, '−', 4, 8.05, 0.55);
    },
  },
  // The module is a round board 14 mm across; three pins each side.
  inmp441: {
    color: 0x1d2a3a, w: 14 * MM, d: 14 * MM, cx: 1, cz: 1.5, t: 1.2 * MM, round: true,
    labelDz: (y) => (y === 0 ? 0.7 : -0.7), labelSize: 0.34,
    silk: (ctx) => label(ctx, 'INMP441', 1, 1.5, 0.38),
  },
};

/**
 * @typedef {{
 *   group: THREE.Group,
 *   anchors: Map<string, THREE.Vector3>,
 * }} PartMesh
 * `anchors`, in the group's frame: where a wire's end sits on each pin.
 */

/**
 * A part as a group whose origin is its first pin, at the height of whatever
 * it stands on (board top or table). On the table it stands on its header
 * pins; in the board the pins have gone into the holes, so it sits lower.
 * @param {PartDef} def
 * @param {{ onBoard: boolean, burnt: boolean }} state
 * @returns {PartMesh}
 */
export function buildPart(def, state) {
  if (def.id === 'speaker') return buildSpeaker(state.burnt);
  const look = LOOKS[def.id];
  const g = new THREE.Group();
  /** @type {Map<string, THREE.Vector3>} */
  const anchors = new Map();
  const lift = state.onBoard ? COLLAR : PIN_LEN;
  const top = lift + look.t;
  const pcb = mat('matte', state.burnt ? charred(look.color) : look.color);

  if (look.round) {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(look.w / 2, look.w / 2, look.t, 40), pcb);
    disc.position.set(look.cx, lift + look.t / 2, look.cz);
    g.add(disc);
  } else {
    g.add(box(look.w, look.t, look.d, pcb, look.cx, lift, look.cz));
  }

  const legs = def.pins.filter((p) => !p.wireOnly);
  // Pads on top, pins below, and the black collar each row of pins goes through.
  g.add(boxes(0.78, 0.03, 0.78, mat('metal', GOLD), legs.map((p) => ({ x: p.x, y: top, z: p.y }))));
  g.add(boxes(0.26, lift, 0.26, mat('metal', GOLD), legs.map((p) => ({ x: p.x, y: 0, z: p.y }))));
  for (const y of new Set(legs.map((p) => p.y))) {
    const xs = legs.filter((p) => p.y === y).map((p) => p.x);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    g.add(box(x1 - x0 + 1, COLLAR, 1, mat('matte', HEADER_BLACK), (x0 + x1) / 2, lift - COLLAR, y));
  }
  for (const p of legs) anchors.set(p.name, new THREE.Vector3(p.x, top + 0.03, p.y));

  const tex = texture(`silk:${def.id}`, () => canvasTexture(look.w, look.d, 64, (ctx) => {
    ctx.translate(look.w / 2 - look.cx, look.d / 2 - look.cz);
    ctx.fillStyle = 'rgba(245,245,240,0.92)';
    look.silk(ctx);
    for (const p of legs) label(ctx, printed(p.name), p.x, p.y + look.labelDz(p.y), look.labelSize, 0.96);
  }));
  g.add(decal(tex, look.w, look.d, look.cx, top, look.cz, state.burnt));

  if (def.id === 'esp32') addEspDetails(g, top, state.burnt);
  if (def.id === 'max98357a') addTerminal(g, top, state.burnt, anchors);
  g.add(contactShadow(look.w + 3, look.d + 3, look.cx, 0.03, look.cz + 0.4));
  return { group: g, anchors };
}

/**
 * The module can, the two USB-C ports, the buttons and the LED of the
 * DevKitC-style board in docs/media/esp32-s3-board.jpg.
 * @param {THREE.Group} g
 * @param {number} top
 * @param {boolean} burnt
 */
function addEspDetails(g, top, burnt) {
  const far = 10.5 + (70 * MM) / 2;
  // The module's own board, then its shield can, set back from the antenna end.
  g.add(box(25.5 * MM, 0.8 * MM, 18 * MM, mat('matte', burnt ? 0x15110e : 0x22252b), far - (25.5 * MM) / 2 - 0.05, top, 5));
  g.add(box(18 * MM, 2.6 * MM, 15.5 * MM, mat('metal', burnt ? 0x3a332c : STEEL), far - (18 * MM) / 2 - 0.25 - 6.5 * MM, top + 0.8 * MM, 5));
  const near = 10.5 - (70 * MM) / 2;
  for (const z of [5 - 2.2, 5 + 2.2]) {
    g.add(box(7.4 * MM, 3.2 * MM, 9 * MM, mat('metal', STEEL), near + (7.4 * MM) / 2 - 0.5, top, z));
  }
  for (const z of [5 - 3.4, 5 + 3.4]) {
    g.add(box(1.4, 0.5, 1.1, mat('matte', 0xd8d8d4), near + 4.2, top, z));
    g.add(box(0.7, 0.35, 0.7, mat('matte', HEADER_BLACK), near + 4.2, top + 0.5, z));
  }
  const led = box(0.55, 0.35, 0.55, mat('gloss', 0xf4f4f0), near + 6.2, top, 5);
  led.name = 'led';
  g.add(led);
}

/**
 * The green screw terminal the speaker is wired to; a wire's end sits on each screw.
 * @param {THREE.Group} g
 * @param {number} top
 * @param {boolean} burnt
 * @param {Map<string, THREE.Vector3>} anchors
 */
function addTerminal(g, top, burnt, anchors) {
  const h = 3.4;
  g.add(box(3.1, h, 2.8, mat('matte', burnt ? 0x1d2016 : 0x2f9a52), 3, top, 6.1));
  for (const [name, x] of /** @type {const} */ ([['+', 2], ['-', 4]])) {
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.2, 20), mat('metal', STEEL));
    screw.position.set(x, top + h + 0.1, 6.1);
    g.add(screw);
    g.add(box(0.95, 0.06, 0.16, mat('matte', 0x55595e), x, top + h + 0.2, 6.1));
    anchors.set(name, new THREE.Vector3(x, top + h + 0.25, 6.1));
  }
}

/**
 * The speaker, lying cone up. Its cone is a group named 'cone' so the
 * running bench can move it with the sound.
 * @param {boolean} burnt
 * @returns {PartMesh}
 */
function buildSpeaker(burnt) {
  const g = new THREE.Group();
  /** @type {Map<string, THREE.Vector3>} */
  const anchors = new Map();
  const { w, d, h } = PARTS.speaker.size;
  const W = w * MM;
  const D = d * MM;
  const H = h * MM;
  const cx = 1;
  const cz = D / 2 - 1.3;
  const shell = mat('matte', burnt ? 0x0d0b0a : 0x262628);
  const coneZ = cz + 0.6;
  // The front plate has a round hole the cone sits down in; a plain box top
  // would hide it.
  const PLATE = 1.2;
  g.add(box(W, H - PLATE, D, shell, cx, 0, cz));
  const outline = new THREE.Shape();
  outline.moveTo(-W / 2, -D / 2).lineTo(W / 2, -D / 2).lineTo(W / 2, D / 2).lineTo(-W / 2, D / 2).closePath();
  outline.holes.push(new THREE.Path().absarc(0, -(coneZ - cz), 6.4, 0, Math.PI * 2, false));
  const plate = new THREE.Mesh(new THREE.ExtrudeGeometry(outline, { depth: PLATE, bevelEnabled: false, curveSegments: 48 }), shell);
  plate.rotation.x = -Math.PI / 2;
  plate.position.set(cx, H - PLATE, cz);
  g.add(plate);
  // The cone as a lathe: a shallow dish from the dust cap out to the rubber surround.
  const profile = [
    new THREE.Vector2(0.01, -1.1), new THREE.Vector2(1.9, -1.1), new THREE.Vector2(3.2, -0.75),
    new THREE.Vector2(5.2, -0.15), new THREE.Vector2(5.6, 0.05), new THREE.Vector2(6.1, 0.1),
    new THREE.Vector2(6.3, 0),
  ];
  const cone = new THREE.Group();
  cone.name = 'cone';
  cone.position.set(cx, H, coneZ);
  cone.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 48), mat('matte', burnt ? 0x120f0d : 0x58534f)));
  const cap = new THREE.Mesh(new THREE.SphereGeometry(1.9, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat('gloss', 0x3a3734));
  cap.scale.y = 0.35;
  cap.position.y = -1.1;
  cone.add(cap);
  g.add(cone);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(6.6, 0.28, 8, 64), mat('gloss', 0x101011));
  ring.rotation.x = Math.PI / 2;
  ring.position.set(cx, H + 0.05, coneZ);
  g.add(ring);
  for (const p of PARTS.speaker.pins) {
    g.add(box(0.9, 0.3, 1.3, mat('metal', GOLD), p.x, H, p.y));
    anchors.set(p.name, new THREE.Vector3(p.x, H + 0.3, p.y));
  }
  g.add(contactShadow(W + 4, D + 4, cx, 0.03, cz + 0.5));
  return { group: g, anchors };
}

/** How tall a dupont connector's housing stands above whatever it plugs into. */
const HOUSING = 14 * MM * 0.75;

/**
 * A dupont jumper from a to b: a black housing standing on each end and the
 * wire arching between them, higher the further apart they are, as a real
 * one does when its two ends are pushed in.
 * @param {THREE.Vector3} a
 * @param {THREE.Vector3} b
 * @param {string} color  any CSS colour; the bench stores what the user picked
 */
export function buildWire(a, b, color) {
  const g = new THREE.Group();
  const housing = mat('gloss', 0x141414);
  /** @type {THREE.Color} */
  let c;
  try { c = new THREE.Color(color); } catch { c = new THREE.Color(0x888888); }
  for (const p of [a, b]) {
    g.add(box(1, HOUSING, 1, housing, p.x, p.y, p.z));
    g.add(box(0.6, 0.6, 0.6, mat('gloss', c), p.x, p.y + HOUSING, p.z));
  }
  const ta = a.clone().setY(a.y + HOUSING + 0.3);
  const tb = b.clone().setY(b.y + HOUSING + 0.3);
  const span = Math.hypot(a.x - b.x, a.z - b.z);
  const lift = Math.min(18, 2.5 + span * 0.32);
  const crest = Math.max(ta.y, tb.y) + lift;
  // The ends leave straight up out of the housings and bend over into one
  // soft arch; the bezier's flat-topped controls give it the slack look of a
  // real jumper rather than a semicircle.
  const curve = new THREE.CubicBezierCurve3(ta, ta.clone().setY(crest), tb.clone().setY(crest), tb);
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(24, Math.round(span * 1.2)), 0.3, 7), mat('gloss', c));
  g.add(tube);
  return g;
}

/**
 * Free a removed thing's geometry. Materials are shared and stay; decal
 * materials are per mesh but tiny, and go too.
 * @param {THREE.Object3D} root
 */
export function dispose(root) {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      // An InstancedMesh's per-instance matrices are a buffer of their own,
      // freed only by the mesh's dispose, not the geometry's.
      if (o instanceof THREE.InstancedMesh) o.dispose();
      const m = o.material;
      if (!Array.isArray(m) && !shared.has(m)) m.dispose();
    }
  });
}
