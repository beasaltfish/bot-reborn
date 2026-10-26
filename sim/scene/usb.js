// The USB-C cable on the table, the bench's power switch. Its far end runs
// off the table; its plug can be picked up and pushed into either of the
// ESP32's two USB-C ports (power on), or pulled out and left anywhere on the
// table (power off).
//
// It keeps its own hands rather than joining interact.js: the plug is
// grabbed before anything else sees the press (a capture listener on the
// window), so neither the wiring hands nor the orbit camera start a drag of
// their own underneath it, and it works in every view, the orbit view
// included, which is where the bench is when it is alive.

import * as THREE from 'three';
import { MM } from './meshes.js';

/** @typedef {ReturnType<typeof import('./world.js').createWorld>} World */

/** Where the cable comes onto the table from, off the front edge left of the ESP32. */
const FAR = new THREE.Vector3(-24, 0.3, 60);
/** Where the plug lies until it is first moved: in front of the ESP32's slot, pointing at its ports. */
const REST = { x: -19, z: 28, yaw: Math.atan2(28 - 23.2, -13.8 - -19) };
/** How close (world units) the plug's shoulder must come to a port's mouth to go in. */
const SNAP = 4;

const SHELL = { l: 6.6 * MM, h: 2.5 * MM, w: 8.3 * MM };
const BODY = { l: 15 * MM, h: 6 * MM, w: 11 * MM };
const BOOT = { l: 6 * MM, r: 2.1 * MM };
const CORD = 1.6 * MM;

/**
 * The plug, its tip along +x with its origin at the shoulder, where the
 * metal shell leaves the rubber: that point sits at a port's mouth when in.
 */
function buildPlug() {
  const g = new THREE.Group();
  const rubber = new THREE.MeshPhongMaterial({ color: 0xe8e6e1, shininess: 20, specular: 0x222222 });
  const steel = new THREE.MeshPhongMaterial({ color: 0xc4c7cb, shininess: 90, specular: 0xfff0c8 });
  const shell = new THREE.Mesh(new THREE.BoxGeometry(SHELL.l, SHELL.h, SHELL.w), steel);
  shell.position.x = SHELL.l / 2;
  const body = new THREE.Mesh(new THREE.BoxGeometry(BODY.l, BODY.h, BODY.w), rubber);
  body.position.x = -BODY.l / 2;
  const boot = new THREE.Mesh(new THREE.CylinderGeometry(BOOT.r * 0.8, BOOT.r, BOOT.l, 16).rotateZ(Math.PI / 2), rubber);
  boot.position.x = -BODY.l - BOOT.l / 2;
  g.add(shell, body, boot);
  return g;
}

/**
 * @param {World} world
 * @param {{ onPlug(on: boolean): void, locked(): boolean }} opts
 *   onPlug: the plug went into a port (true) or came out of one (false);
 *   locked: while true the plug cannot be picked up.
 */
export function attachUsb(world, opts) {
  const { canvas, scene } = world;
  const plug = buildPlug();
  plug.name = 'usb-plug';
  const cordMat = new THREE.MeshPhongMaterial({ color: 0xe8e6e1, shininess: 20, specular: 0x222222 });
  const cord = new THREE.Mesh(new THREE.BufferGeometry(), cordMat);
  cord.name = 'usb-cord';
  scene.add(plug, cord);

  /** Where the plug lies when not in a port; moved by the user, not saved. */
  const lying = { x: REST.x, z: REST.z, yaw: REST.yaw };
  let plugged = false;

  /** The ESP32's two port mouths in world space, with the direction into each. */
  function ports() {
    const esp = scene.getObjectByName('part:esp');
    if (!esp) return [];
    esp.updateMatrixWorld();
    /** @type {{ mouth: THREE.Vector3, inward: THREE.Vector3 }[]} */
    const out = [];
    esp.traverse((o) => {
      if (o.name !== 'usb' || !(o instanceof THREE.Mesh)) return;
      const len = /** @type {THREE.BoxGeometry} */ (o.geometry).parameters.width;
      const mouth = esp.localToWorld(o.position.clone().setX(o.position.x - len / 2));
      const inward = new THREE.Vector3(1, 0, 0).transformDirection(esp.matrixWorld);
      out.push({ mouth, inward });
    });
    return out;
  }

  /**
   * Put the plug at a shoulder position, pointing along yaw, and lay the
   * cord from its back to the far end: straight back out of the boot, down
   * to the table, then a lazy curve away.
   * @param {THREE.Vector3} at
   * @param {number} yaw
   */
  function pose(at, yaw) {
    plug.position.copy(at);
    plug.rotation.set(0, yaw, 0);
    const back = new THREE.Vector3(-1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const tail = at.clone().addScaledVector(back, BODY.l + BOOT.l);
    const out = tail.clone().addScaledVector(back, 2.5);
    // Then it bends down to the table and away towards the edge.
    const bend = out.clone().add(FAR.clone().sub(out).setY(0).normalize().multiplyScalar(6)).setY(FAR.y + CORD);
    const curve = new THREE.CatmullRomCurve3([tail, out, bend, FAR]);
    cord.geometry.dispose();
    cord.geometry = new THREE.TubeGeometry(curve, 80, CORD, 8);
    world.requestRender();
  }

  /** Lying on the table, its shell's underside on the wood. */
  function rest() {
    pose(new THREE.Vector3(lying.x, BODY.h / 2, lying.z), lying.yaw);
  }

  /** In the nearest port; false if the ESP32 is nowhere to be found. */
  function seat() {
    const p = ports().sort((a, b) => a.mouth.distanceTo(plug.position) - b.mouth.distanceTo(plug.position))[0];
    if (!p) return false;
    pose(p.mouth, Math.atan2(-p.inward.z, p.inward.x));
    return true;
  }

  // ---- The hand ---------------------------------------------------------

  const raycaster = new THREE.Raycaster();
  /** @type {{ plane: THREE.Plane, offset: THREE.Vector3, yaw: number, port: ReturnType<typeof ports>[number] | null } | null} */
  let drag = null;

  /** @param {{ clientX: number, clientY: number }} e */
  function aimAt(e) {
    const r = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), world.camera);
  }

  /** @param {{ clientX: number, clientY: number }} e */
  function over(e) {
    aimAt(e);
    return raycaster.intersectObjects([plug, cord], true).length > 0;
  }

  addEventListener('pointerdown', (e) => {
    if (e.target !== canvas || e.button !== 0 || !e.isPrimary || !over(e) || opts.locked()) return;
    // Ours: the wiring hands and the camera never hear of this press.
    e.stopImmediatePropagation();
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -plug.position.y);
    const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3()) ?? plug.position.clone();
    drag = { plane, offset: plug.position.clone().sub(hit), yaw: plug.rotation.y, port: null };
    canvas.style.cursor = 'grabbing';
  }, { capture: true });

  addEventListener('pointermove', (e) => {
    if (!drag) {
      // After the wiring hands have set the cursor for this move (they do it
      // in the next frame; this frame callback is queued after theirs).
      if (e.target === canvas && e.buttons === 0) requestAnimationFrame(() => { if (!drag && over(e)) canvas.style.cursor = 'grab'; });
      return;
    }
    aimAt(e);
    const hit = raycaster.ray.intersectPlane(drag.plane, new THREE.Vector3());
    if (!hit) return;
    const at = hit.add(drag.offset);
    const near = ports().filter((p) => Math.hypot(p.mouth.x - at.x, p.mouth.z - at.z) < SNAP)
      .sort((a, b) => a.mouth.distanceTo(at) - b.mouth.distanceTo(at))[0] ?? null;
    drag.port = near;
    if (near) pose(near.mouth, Math.atan2(-near.inward.z, near.inward.x));
    // Held a little above where it was picked up, so it is plainly in the hand.
    else pose(at.setY(at.y + 1), drag.yaw);
  });

  /** @param {PointerEvent} e */
  function release(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    canvas.style.cursor = '';
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    const was = plugged;
    if (d.port) {
      plugged = true;
      pose(d.port.mouth, Math.atan2(-d.port.inward.z, d.port.inward.x));
    } else {
      plugged = false;
      lying.x = plug.position.x;
      lying.z = plug.position.z;
      lying.yaw = d.yaw;
      rest();
    }
    if (plugged !== was) opts.onPlug(plugged);
  }
  addEventListener('pointerup', release);
  addEventListener('pointercancel', release);

  rest();

  return {
    get plugged() { return plugged; },
    /** The bench was redrawn: if the ESP32 moved, the plug goes with it. */
    refresh() {
      if (plugged && !drag && !seat()) {
        plugged = false;
        rest();
        opts.onPlug(false);
      }
    },
    /** Out of the port and back where it lay, without telling onPlug (the caller is the one asking). */
    pullOut() {
      plugged = false;
      drag = null;
      rest();
    },
  };
}
