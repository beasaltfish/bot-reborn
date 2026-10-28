// The 3D bench: renderer, lights, cameras and the three views, and turning a
// Bench into meshes. It draws a frame only when something asks for one — a
// state change, the user moving the camera, a camera move in flight — so an
// idle bench costs the laptop nothing.
//
// Meshes are named so later code can find them without holding references:
// a part's group is "part:<id>", a wire's "wire:<id>", a board's "board:<id>".
// Each carries userData { kind: 'part' | 'wire' | 'board', id }.
//
// Any number of boards and parts, anywhere on the table (multi-screen spec
// §5.2-5.3): every board is its own mesh at its own place and turn, every part
// stands at the table position bench.js gives it, and a screen's glass is a
// canvas the brain's frames are painted onto.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PARTS, BOARD_OUTLINE, holeXY } from '../parts.js';
import { pinPoints, isHole } from '../bench.js';
import { boardToTable } from '../parts.js';
import {
  BOARD_TOP, MM, MAT_THICK, buildBreadboard, buildBin, buildMat, buildPart, buildTable, buildWire, drawScreen, dispose,
} from './meshes.js';

/** @typedef {import('../bench.js').Bench} Bench */
/** @typedef {import('../bench.js').Placed} Placed */
/** @typedef {'orbit' | 'tilted' | 'top'} ViewMode */

/** Where the bin stands: the table's right-front corner, out of the way. */
const BIN = { x: 98, z: 52, size: 14 };

/** Where things may be put. Big enough for several boards and a lot of parts. */
const TABLE_BOUNDS = { x0: -120, x1: 120, z0: -70, z1: 70 };

/** The opening picture's frame: never smaller than this, whatever is on the table. */
const FRAME_MIN = { cx: 0, cz: 5, w: 84, d: 54 };

/** How much table to leave around the outermost thing when framing a view. */
const FRAME_MARGIN = 8;

/**
 * A camera pose the views and the moves between them are described in:
 * looking at `target` from `polar` radians off vertical and `azimuth` around
 * it, `height` world units visible top to bottom at the target, through a
 * lens of `fov` degrees, or orthographic.
 * @typedef {{ target: THREE.Vector3, polar: number, azimuth: number, height: number, fov: number, ortho: boolean }} Pose
 */

/** The narrow lens an orthographic view is approached through, so the swap to it doesn't jump. */
const NEAR_ORTHO_FOV = 1;
const MOVE_MS = 650;
const ORTHO_DISTANCE = 400;

/** @param {number} t */
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * @param {HTMLCanvasElement} canvas
 */
export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2b241e);
  // Baked-looking light: a warm sky over a wooden floor, and one sun from the
  // back left so the boards' edges and the wires' tops catch it. No shadows.
  scene.add(new THREE.HemisphereLight(0xfff4e2, 0x7a5a3c, 2.2));
  const sun = new THREE.DirectionalLight(0xfff0dc, 1.5);
  sun.position.set(-40, 90, 30);
  scene.add(sun);

  // A cutting mat on the wooden table, as big as the stretch things may be
  // put on: its edge is where the bench ends. Its top is y = 0, where parts
  // stand, so the wood lies a mat's thickness lower.
  const table = buildTable();
  table.position.y = -MAT_THICK;
  scene.add(table, buildMat(TABLE_BOUNDS));
  /** Every board instance's mesh, grouped so a rebuild can prune them. */
  const boards = new THREE.Group();
  const bin = buildBin();
  bin.position.set(BIN.x, 0, BIN.z);
  scene.add(boards, bin);

  const persp = new THREE.PerspectiveCamera(40, 1, 1, 1000);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, ORTHO_DISTANCE * 2);
  /** @type {THREE.PerspectiveCamera | THREE.OrthographicCamera} */
  let camera = ortho;
  let aspect = 1;

  /** @type {OrbitControls<THREE.PerspectiveCamera | THREE.OrthographicCamera>} */
  const controls = new OrbitControls(camera, canvas);
  controls.addEventListener('change', () => requestRender());
  let touched = false;
  controls.addEventListener('start', () => { touched = true; });

  /** @type {THREE.Object3D[]} */
  const pickables = [];
  const parts = new THREE.Group();
  const wires = new THREE.Group();
  scene.add(parts, wires);
  /**
   * Built part groups by the Placed they were built from. bench.js keeps an
   * unchanged part's object, so only parts that moved are rebuilt.
   * @type {Map<Placed, THREE.Group>}
   */
  let built = new Map();
  /** @type {Map<string, THREE.Group>} */
  let builtBoards = new Map();
  /** The bench as it stands, for framing a view and painting screens. */
  /** @type {Bench | null} */
  let current = null;
  /**
   * Each screen's look, kept outside the mesh map so a moved part does not
   * lose the picture it was showing: instance id → look and last frame.
   * @type {Map<string, { show: import('../power.js').ScreenShow, image: ImageBitmap | null }>}
   */
  const screenLook = new Map();

  let pending = false;
  /** @type {{ from: Pose, to: Pose, start: number } | null} */
  let move = null;
  /**
   * Called before each frame is drawn, with the camera already where it will
   * be: things that animate (or follow the camera) update here, and say
   * whether they want another frame. When none does, drawing stops.
   * @type {Set<(now: number) => boolean>}
   */
  const tickers = new Set();

  function requestRender() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(frame);
  }

  /** @param {number} now */
  function frame(now) {
    pending = false;
    if (move) {
      const t = Math.min(1, (now - move.start) / MOVE_MS);
      if (t >= 1) {
        apply(move.to);
        move = null;
        settleControls();
      } else {
        apply(blend(move.from, move.to, ease(t)));
        requestRender();
      }
    }
    let again = false;
    for (const t of tickers) if (t(now)) again = true;
    renderer.render(scene, camera);
    if (again) requestRender();
  }

  /** The pose the camera is in now, whatever the user has done to it. */
  function currentPose() {
    const offset = camera.position.clone().sub(controls.target);
    const s = new THREE.Spherical().setFromVector3(offset);
    const height = camera instanceof THREE.OrthographicCamera
      ? (camera.top - camera.bottom) / camera.zoom
      : 2 * s.radius * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    return {
      target: controls.target.clone(), polar: s.phi, azimuth: s.theta, height,
      fov: camera instanceof THREE.PerspectiveCamera ? camera.fov : NEAR_ORTHO_FOV,
      ortho: camera instanceof THREE.OrthographicCamera,
    };
  }

  /**
   * Between two poses. Any move that involves the perspective camera is
   * flown with it, the lens narrowing towards an orthographic end until the
   * picture is flat enough that switching cameras at the end shows nothing.
   * @param {Pose} a
   * @param {Pose} b
   * @param {number} t
   * @returns {Pose}
   */
  function blend(a, b, t) {
    let dAz = b.azimuth - a.azimuth;
    dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz));
    const fovA = a.ortho ? NEAR_ORTHO_FOV : a.fov;
    const fovB = b.ortho ? NEAR_ORTHO_FOV : b.fov;
    return {
      target: a.target.clone().lerp(b.target, t),
      polar: a.polar + (b.polar - a.polar) * t,
      azimuth: a.azimuth + dAz * t,
      height: a.height + (b.height - a.height) * t,
      // Lens angles change evenly to the eye on a log scale.
      fov: Math.exp(Math.log(fovA) + (Math.log(fovB) - Math.log(fovA)) * t),
      ortho: a.ortho && b.ortho,
    };
  }

  /** @param {Pose} p */
  function apply(p) {
    const next = p.ortho ? ortho : persp;
    if (next !== camera) {
      camera = next;
      controls.object = camera;
    }
    const dir = new THREE.Vector3().setFromSpherical(new THREE.Spherical(1, p.polar, p.azimuth));
    if (camera instanceof THREE.OrthographicCamera) {
      camera.top = p.height / 2;
      camera.bottom = -p.height / 2;
      camera.left = (-p.height * aspect) / 2;
      camera.right = (p.height * aspect) / 2;
      camera.zoom = 1;
      camera.position.copy(p.target).addScaledVector(dir, ORTHO_DISTANCE);
    } else {
      const dist = p.height / 2 / Math.tan(THREE.MathUtils.degToRad(p.fov) / 2);
      camera.fov = p.fov;
      camera.aspect = aspect;
      camera.near = Math.max(0.5, dist - 250);
      camera.far = dist + 600;
      camera.position.copy(p.target).addScaledVector(dir, dist);
    }
    camera.lookAt(p.target);
    camera.updateProjectionMatrix();
    controls.target.copy(p.target);
  }

  /** @type {ViewMode} */
  let mode = 'tilted';

  /**
   * In the wiring views the left button is left free for picking things up
   * (rotating there would only lose the flat, even grid), so only pan and
   * zoom; the orbit view is for looking around.
   */
  function settleControls() {
    controls.enabled = true;
    controls.enableRotate = mode === 'orbit';
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = THREE.MathUtils.degToRad(82);
    controls.minDistance = 12;
    controls.maxDistance = 260;
    controls.minZoom = 0.6;
    controls.maxZoom = 8;
    controls.update();
  }

  /**
   * The stretch of table the views frame: everything on it, with a margin,
   * and never smaller than the opening picture. Recomputed when a view is
   * chosen, not while something is being dragged — a camera that chases the
   * hand is what makes people seasick.
   * @param {Bench | null} b
   */
  function frameOf(b) {
    let x0 = FRAME_MIN.cx - FRAME_MIN.w / 2;
    let x1 = FRAME_MIN.cx + FRAME_MIN.w / 2;
    let z0 = FRAME_MIN.cz - FRAME_MIN.d / 2;
    let z1 = FRAME_MIN.cz + FRAME_MIN.d / 2;
    for (const bd of b?.boards ?? []) {
      const cx = bd.x + (BOARD_OUTLINE.x0 + BOARD_OUTLINE.x1) / 2;
      const cz = bd.z + (BOARD_OUTLINE.y0 + BOARD_OUTLINE.y1) / 2;
      let w = BOARD_OUTLINE.x1 - BOARD_OUTLINE.x0;
      let d = BOARD_OUTLINE.y1 - BOARD_OUTLINE.y0;
      if (bd.rot === 90 || bd.rot === 270) [w, d] = [d, w];
      x0 = Math.min(x0, cx - w / 2 - FRAME_MARGIN);
      x1 = Math.max(x1, cx + w / 2 + FRAME_MARGIN);
      z0 = Math.min(z0, cz - d / 2 - FRAME_MARGIN);
      z1 = Math.max(z1, cz + d / 2 + FRAME_MARGIN);
    }
    for (const p of b?.placed ?? []) {
      // A part's footprint runs right and down from its origin pin.
      const { w, d } = PARTS[p.part].size;
      x0 = Math.min(x0, p.at.x - FRAME_MARGIN);
      x1 = Math.max(x1, p.at.x + w * MM + FRAME_MARGIN);
      z0 = Math.min(z0, p.at.z - FRAME_MARGIN);
      z1 = Math.max(z1, p.at.z + d * MM + FRAME_MARGIN);
    }
    return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 };
  }

  /** @param {ViewMode} m @returns {Pose} */
  function poseFor(m) {
    const frame = frameOf(current);
    const fitW = (frame.w * 1.06) / aspect;
    const target = new THREE.Vector3(frame.cx, BOARD_TOP, frame.cz);
    if (m === 'top') return { target, polar: 0.0001, azimuth: 0, height: Math.max(frame.d * 1.1, fitW), fov: NEAR_ORTHO_FOV, ortho: true };
    const polar = THREE.MathUtils.degToRad(m === 'tilted' ? 35 : 55);
    const height = Math.max(frame.d * Math.cos(polar) * 1.25, fitW);
    if (m === 'tilted') return { target, polar, azimuth: 0, height, fov: NEAR_ORTHO_FOV, ortho: true };
    return { target, polar, azimuth: THREE.MathUtils.degToRad(-12), height: height * 1.25, fov: 38, ortho: false };
  }

  /** @param {ViewMode} m */
  function view(m) {
    mode = m;
    touched = false;
    controls.enabled = false;
    move = { from: currentPose(), to: poseFor(m), start: performance.now() };
    requestRender();
  }

  function resize() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    const pose = currentPose();
    aspect = w / h;
    // Until the user has moved the camera the view is refitted to the new
    // shape; after, what they were looking at stays. A move in flight sets its own.
    if (!move) apply(touched ? pose : poseFor(mode));
    requestRender();
  }

  /**
   * Where the end of a wire goes for a point id: on top of a part's pin, or
   * in a hole of the board.
   * @param {Bench} b
   * @param {string} point
   */
  function pointPosition(b, point) {
    const [id, pin] = splitPoint(point);
    const bd = b.boards.find((x) => x.id === id);
    if (bd && isHole(b, point)) {
      // A saved bench may name a hole that no longer exists; skip that wire, don't fail the page.
      let xy;
      try { xy = holeXY(pin); } catch { return null; }
      const p = boardToTable(bd, xy.x, xy.y);
      return new THREE.Vector3(p.x, BOARD_TOP, p.z);
    }
    const placed = b.placed.find((p) => p.id === id);
    const g = placed && built.get(placed);
    const anchor = g?.userData.anchors.get(pin);
    if (!g || !anchor) return null;
    g.updateMatrixWorld();
    return g.localToWorld(anchor.clone());
  }

  /**
   * A red ring on each pin of a placed part that went into no hole. On a real
   * bench it would be plain to see, hanging in the air; seen from above it
   * looks the same as a seated pin, and a wire beside it looks connected.
   * @param {THREE.Group} g
   * @param {Map<string, THREE.Vector3>} anchors
   * @param {{ pin: string, hole: string | null }[]} seats
   * @param {import('../parts.js').PartDef} def
   */
  function markHanging(g, anchors, seats, def) {
    for (const s of seats) {
      if (s.hole) continue;
      const name = s.pin.slice(s.pin.indexOf(':') + 1);
      if (def.pins.find((q) => q.name === name)?.wireOnly) continue;
      const a = anchors.get(name);
      if (!a) continue;
      // Its own geometry and material: dispose() frees them with the part.
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.42, 0.6, 24),
        new THREE.MeshBasicMaterial({ color: 0xe5483a, depthTest: false }),
      );
      ring.renderOrder = 2;
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(a.x, a.y + 0.02, a.z);
      ring.name = `hanging:${name}`;
      // A marker, not a part of the part: clicks go through it.
      ring.raycast = () => {};
      g.add(ring);
    }
  }

  /** @param {Bench} b */
  function show(b) {
    current = b;

    // Boards: one mesh each, standing at its place and turned with its instance.
    /** @type {Map<string, THREE.Group>} */
    const nextBoards = new Map();
    for (const bd of b.boards) {
      let g = builtBoards.get(bd.id);
      if (!g) {
        g = buildBreadboard();
        g.name = `board:${bd.id}`;
        const body = g.getObjectByName('breadboard');
        if (body) body.userData = { kind: 'board', id: bd.id };
        boards.add(g);
      }
      g.position.set(bd.x, 0, bd.z);
      // Quarter turns clockwise seen from above, as parts.js turns holes.
      g.rotation.y = -THREE.MathUtils.degToRad(bd.rot);
      nextBoards.set(bd.id, g);
    }
    for (const [id, g] of builtBoards) {
      if (!nextBoards.has(id)) {
        boards.remove(g);
        dispose(g);
      }
    }
    builtBoards = nextBoards;

    /** @type {Map<Placed, THREE.Group>} */
    const next = new Map();
    for (const p of b.placed) {
      let g = built.get(p);
      if (!g) {
        const def = PARTS[p.part];
        const made = buildPart(def, { onBoard: p.seated, burnt: p.burnt });
        g = made.group;
        g.name = `part:${p.id}`;
        g.userData = { kind: 'part', id: p.id, anchors: made.anchors, screen: made.screen ?? null };
        if (p.seated) markHanging(g, made.anchors, pinPoints(b, p), def);
        g.rotation.y = -THREE.MathUtils.degToRad(p.rot);
        if (made.screen) {
          const look = screenLook.get(p.id);
          drawScreen(made.screen, look?.show ?? 'off', look?.image ?? null);
        }
      }
      // Seated parts sit on the board's top; loose ones on the table.
      g.position.set(p.at.x, p.seated ? BOARD_TOP : 0, p.at.z);
      next.set(p, g);
    }
    for (const [p, g] of built) {
      if (!next.has(p)) {
        parts.remove(g);
        dispose(g);
      }
    }
    for (const g of next.values()) if (g.parent !== parts) parts.add(g);
    built = next;

    for (const w of [...wires.children]) {
      wires.remove(w);
      dispose(w);
    }
    for (const w of b.wires) {
      const a = pointPosition(b, w.a);
      const z = pointPosition(b, w.b);
      if (!a || !z) continue;
      const g = buildWire(a, z, w.color);
      g.name = `wire:${w.id}`;
      g.userData = { kind: 'wire', id: w.id };
      wires.add(g);
    }

    pickables.length = 0;
    pickables.push(...boards.children, ...parts.children, ...wires.children);
    requestRender();
  }

  /**
   * What each screen's glass looks like after power-on: off, dark, white,
   * garbage or ready for a picture. The look outlives a rebuild of the mesh.
   * @param {Record<string, import('../power.js').PartState>} states
   */
  function screens(states) {
    for (const p of current?.placed ?? []) {
      const state = states[p.id];
      if (!state || state.kind !== 'screen') continue;
      const look = screenLook.get(p.id) ?? { show: /** @type {const} */ ('off'), image: null };
      look.show = state.show;
      screenLook.set(p.id, look);
      const scr = built.get(p)?.userData.screen;
      if (scr) drawScreen(scr, look.show, look.image);
    }
    requestRender();
  }

  /**
   * The brain sent a frame: every screen that is ready shows it. They all get
   * the same picture, because the firmware drives one panel.
   * @param {ImageBitmap} img
   */
  function paintScreens(img) {
    let painted = false;
    for (const [p, g] of built) {
      const scr = g.userData.screen;
      const look = screenLook.get(p.id);
      if (!scr || !look || (look.show !== 'ready' && look.show !== 'dark')) continue;
      look.image = img;
      drawScreen(scr, look.show, img);
      painted = true;
    }
    if (painted) requestRender();
  }

  /** Is this table point over the bin? @param {number} x @param {number} z */
  function trashAt(x, z) {
    return Math.abs(x - BIN.x) <= BIN.size / 2 && Math.abs(z - BIN.z) <= BIN.size / 2;
  }

  // A garbled panel is snow, and snow moves: keep drawing while one exists.
  tickers.add(() => {
    let any = false;
    for (const [p, g] of built) {
      if (screenLook.get(p.id)?.show !== 'garbage') continue;
      any = true;
      const scr = g.userData.screen;
      if (scr) drawScreen(scr, 'garbage', null);
    }
    return any;
  });

  new ResizeObserver(resize).observe(canvas);
  aspect = (canvas.clientWidth || 1) / (canvas.clientHeight || 1);
  renderer.setSize(canvas.clientWidth || 1, canvas.clientHeight || 1, false);
  apply(poseFor(mode));
  settleControls();

  return {
    show,
    screens,
    paintScreens,
    trashAt,
    tableBounds: TABLE_BOUNDS,
    view,
    requestRender,
    /**
     * @param {(now: number) => boolean} fn  true while it wants more frames
     * @returns {() => void}  stops calling it
     */
    onFrame(fn) {
      tickers.add(fn);
      return () => { tickers.delete(fn); };
    },
    canvas,
    scene,
    // The views swap between a perspective and an orthographic camera, so
    // this is read fresh each time rather than handed out once.
    get camera() { return camera; },
    pickables,
  };
}

/**
 * "esp:GPIO12" → ['esp', 'GPIO12'], "bb:a12" → ['bb', 'a12']. Pin names hold
 * no colon ("L/R", "GND.2"), so the first one splits.
 * @param {string} point
 * @returns {[string, string]}
 */
function splitPoint(point) {
  const i = point.indexOf(':');
  return [point.slice(0, i), point.slice(i + 1)];
}
