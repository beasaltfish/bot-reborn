// The 3D bench: renderer, lights, cameras and the three views, and turning a
// Bench into meshes. It draws a frame only when something asks for one — a
// state change, the user moving the camera, a camera move in flight — so an
// idle bench costs the laptop nothing.
//
// Meshes are named so later code can find them without holding references:
// a part's group is "part:<id>", a wire's "wire:<id>", the board "breadboard".
// Each carries userData { kind: 'part' | 'wire' | 'board', id }.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PARTS, holeXY } from '../parts.js';
import { BOARD_TOP, boardToWorld, buildBreadboard, buildPart, buildTable, buildWire, dispose } from './meshes.js';

/** @typedef {import('../bench.js').Bench} Bench */
/** @typedef {import('../bench.js').Placed} Placed */
/** @typedef {'orbit' | 'tilted' | 'top'} ViewMode */

/**
 * Where each kind of part rests when it is not in the board: the origin pin's
 * world x/z. Not stored in the bench (bench.js says so), so moving these
 * moves nobody's saved work. In front of the board, the ESP32 in the middle
 * where the user's own sits, the speaker to its left.
 * @type {Record<import('../parts.js').PartDef['id'], { x: number, z: number }>}
 */
const TABLE_SLOT = {
  esp32: { x: -10.5, z: 16 },
  speaker: { x: -27, z: 15.5 },
  max98357a: { x: 18, z: 15.5 },
  inmp441: { x: 29, z: 17.5 },
};

/** Burnt parts that were swapped out go in a heap behind the board, one after another. */
const DISCARD = { x: 24, z: -19, step: 9 };

/** The stretch of table the views frame: the board and the slots in front of it. */
const FRAME = { cx: 0, cz: 5, w: 84, d: 54 };

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

  scene.add(buildTable());
  const board = buildBreadboard();
  scene.add(board);

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
  const pickables = [/** @type {THREE.Object3D} */ (board.getObjectByName('breadboard'))];
  const parts = new THREE.Group();
  const wires = new THREE.Group();
  scene.add(parts, wires);
  /**
   * Built part groups by the Placed they were built from. bench.js keeps an
   * unchanged part's object, so only parts that moved are rebuilt.
   * @type {Map<Placed, THREE.Group>}
   */
  let built = new Map();

  let pending = false;
  /** @type {{ from: Pose, to: Pose, start: number } | null} */
  let move = null;

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
    renderer.render(scene, camera);
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

  /** @param {ViewMode} m @returns {Pose} */
  function poseFor(m) {
    const fitW = (FRAME.w * 1.06) / aspect;
    const target = new THREE.Vector3(FRAME.cx, BOARD_TOP, FRAME.cz);
    if (m === 'top') return { target, polar: 0.0001, azimuth: 0, height: Math.max(FRAME.d * 1.1, fitW), fov: NEAR_ORTHO_FOV, ortho: true };
    const polar = THREE.MathUtils.degToRad(m === 'tilted' ? 35 : 55);
    const height = Math.max(FRAME.d * Math.cos(polar) * 1.25, fitW);
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
    if (id === 'bb') {
      // A saved bench may name a hole that no longer exists; skip that wire, don't fail the page.
      let xy;
      try { xy = holeXY(point); } catch { return null; }
      const p = boardToWorld(xy.x, xy.y);
      return new THREE.Vector3(p.x, BOARD_TOP, p.z);
    }
    const placed = b.placed.find((p) => p.id === id && !p.discarded);
    const g = placed && built.get(placed);
    const anchor = g?.userData.anchors.get(pin);
    if (!g || !anchor) return null;
    g.updateMatrixWorld();
    return g.localToWorld(anchor.clone());
  }

  /** @param {Bench} b */
  function show(b) {
    /** @type {Map<Placed, THREE.Group>} */
    const next = new Map();
    let heap = 0;
    for (const p of b.placed) {
      let g = built.get(p);
      if (!g) {
        const def = PARTS[p.part];
        const { group, anchors } = buildPart(def, { onBoard: p.at !== null, burnt: p.burnt });
        g = group;
        g.name = `part:${p.id}`;
        g.userData = { kind: 'part', id: p.id, anchors };
        const at = p.at ? boardToWorld(p.at.x, p.at.y) : p.discarded
          ? { x: DISCARD.x + DISCARD.step * heap, z: DISCARD.z }
          : TABLE_SLOT[p.part];
        g.position.set(at.x, p.at ? BOARD_TOP : 0, at.z);
        // Quarter turns clockwise seen from above, as bench.js turns the pins.
        g.rotation.y = -THREE.MathUtils.degToRad(p.rot);
      }
      if (p.discarded) heap++;
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
    pickables.push(/** @type {THREE.Object3D} */ (board.getObjectByName('breadboard')), ...parts.children, ...wires.children);
    requestRender();
  }

  new ResizeObserver(resize).observe(canvas);
  aspect = (canvas.clientWidth || 1) / (canvas.clientHeight || 1);
  renderer.setSize(canvas.clientWidth || 1, canvas.clientHeight || 1, false);
  apply(poseFor(mode));
  settleControls();

  return {
    show,
    view,
    requestRender,
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
