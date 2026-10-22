// What the bench does when it has power: smoke off a part that burnt, the
// ESP32's power LED (steady, or blinking while it browns out), and, while it
// is a body, a waveform of the user's voice above the mic and the speaker
// cone moving with the robot's. Also keeps page elements (the Replace
// button) pinned above a part as the camera moves.
//
// Frames are drawn only while something moves: smoke still rising, a level
// not yet settled. Then drawing stops until the next sound.

import * as THREE from 'three';

/** @typedef {ReturnType<typeof import('./world.js').createWorld>} World */

const SMOKE = { emitMs: 2200, lifeMs: 2000, every: 45, rise: 18, from: 2.5, to: 13 };
const BLINK_MS = 260;
/** Without new downlink audio for this long, the cone's level falls away. */
const DOWN_STALE_MS = 200;
/** Points in the waveform; one is added per frame, so this is about a second of voice. */
const WAVE_N = 72;
const WAVE = { w: 12, h: 3, lift: 9 };
/** Below this a level is silence: the loop may stop. */
const QUIET = 0.004;

/** A soft grey puff, drawn once. */
function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  // Dark: the smoke of burnt silicon, and it has to read against light wood.
  g.addColorStop(0, 'rgba(70,64,60,0.95)');
  g.addColorStop(0.5, 'rgba(90,84,80,0.5)');
  g.addColorStop(1, 'rgba(110,104,100,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/**
 * The top middle of a part as it stands now, in world space.
 * @param {THREE.Object3D} g
 */
function topOf(g) {
  const box = new THREE.Box3().setFromObject(g);
  return new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
}

/** @param {World} world */
export function createEffects(world) {
  const { scene, canvas } = world;
  /** @param {string} id */
  const part = (id) => scene.getObjectByName(`part:${id}`) ?? null;

  // ---- Smoke ------------------------------------------------------------

  const puff = puffTexture();
  /** @type {{ sprite: THREE.Sprite, born: number, from: THREE.Vector3, drift: THREE.Vector3 }[]} */
  const puffs = [];
  /** @type {{ at: THREE.Vector3, start: number, last: number }[]} */
  const sources = [];

  /** @param {string} id  the part that burnt */
  function smoke(id) {
    const g = part(id);
    if (!g) return;
    const now = performance.now();
    sources.push({ at: topOf(g), start: now, last: now - SMOKE.every });
    world.requestRender();
  }

  /** @param {number} now @returns {boolean} still smoking */
  function tickSmoke(now) {
    for (let i = sources.length - 1; i >= 0; i--) {
      const s = sources[i];
      while (now - s.last >= SMOKE.every && s.last - s.start < SMOKE.emitMs) {
        s.last += SMOKE.every;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, transparent: true, depthWrite: false }));
        sprite.position.copy(s.at).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, 0, (Math.random() - 0.5) * 1.5));
        sprite.renderOrder = 10;
        scene.add(sprite);
        puffs.push({ sprite, born: s.last, from: sprite.position.clone(), drift: new THREE.Vector3((Math.random() - 0.5) * 3, SMOKE.rise, (Math.random() - 0.5) * 3 - 2) });
      }
      if (s.last - s.start >= SMOKE.emitMs) sources.splice(i, 1);
    }
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i];
      const t = (now - p.born) / SMOKE.lifeMs;
      if (t >= 1) {
        scene.remove(p.sprite);
        p.sprite.material.dispose();
        puffs.splice(i, 1);
        continue;
      }
      // Rising fast at first and slowing, as warm smoke does: the integral of (1 - t).
      p.sprite.position.copy(p.from).addScaledVector(p.drift, t - (t * t) / 2);
      p.sprite.scale.setScalar(SMOKE.from + (SMOKE.to - SMOKE.from) * t);
      p.sprite.material.opacity = 0.95 * (1 - t) * Math.min(1, t * 8);
    }
    return sources.length > 0 || puffs.length > 0;
  }

  // ---- The power LED ----------------------------------------------------

  const ledOn = new THREE.MeshBasicMaterial({ color: 0xff3a2a });
  /** @type {'off' | 'on' | 'blink'} */
  let ledMode = 'off';
  /** @type {ReturnType<typeof setInterval> | null} */
  let blinker = null;
  let blinkLit = true;

  /** Apply the LED's look to whatever ESP32 mesh is in the scene now (it is rebuilt when moved). */
  function paintLed() {
    const led = part('esp')?.getObjectByName('led');
    if (!(led instanceof THREE.Mesh)) return;
    if (!led.userData.dark) led.userData.dark = led.material;
    led.material = ledMode === 'on' || (ledMode === 'blink' && blinkLit) ? ledOn : led.userData.dark;
    world.requestRender();
  }

  /** @param {'off' | 'on' | 'blink'} mode */
  function led(mode) {
    ledMode = mode;
    if (blinker) clearInterval(blinker);
    blinker = null;
    blinkLit = true;
    // A brown-out: the board resets, its LED dips with the supply, over and over.
    if (mode === 'blink') blinker = setInterval(() => { blinkLit = !blinkLit; paintLed(); }, BLINK_MS);
    paintLed();
  }

  // ---- Levels: the voice in, the voice out ------------------------------

  const wavePos = new Float32Array(WAVE_N * 3);
  const waveGeo = new THREE.BufferGeometry();
  waveGeo.setAttribute('position', new THREE.BufferAttribute(wavePos, 3));
  const wave = new THREE.Line(waveGeo, new THREE.LineBasicMaterial({ color: 0xffc46b }));
  wave.frustumCulled = false;
  wave.visible = false;
  scene.add(wave);
  const history = new Float32Array(WAVE_N);

  let alive = false;
  const raw = { up: 0, down: 0, downAt: 0 };
  const shown = { up: 0, down: 0 };
  let phase = 0;
  let lastTick = 0;

  /**
   * The robot is (or is no longer) a body: the waveform shows and the cone
   * listens to the levels.
   * @param {boolean} on
   */
  function setAlive(on) {
    alive = on;
    wave.visible = on;
    raw.up = raw.down = 0;
    if (!on) {
      history.fill(0);
      shown.up = shown.down = 0;
      placeCone(0);
    }
    world.requestRender();
  }

  /**
   * From startBody's onLevel. `down` is repeated with every uplink frame
   * whether new audio came or not, so only a changed value counts as fresh;
   * a stale one fades, and the cone settles once the robot stops talking.
   * @param {number} up
   * @param {number} down
   */
  function levels(up, down) {
    if (!alive) return;
    raw.up = up;
    if (down !== raw.down) raw.downAt = performance.now();
    raw.down = down;
    if (up > QUIET || down > QUIET || shown.up > QUIET || shown.down > QUIET) world.requestRender();
  }

  /** @param {number} d  0..1 */
  function placeCone(d) {
    const cone = part('spk')?.getObjectByName('cone');
    if (!cone) return;
    if (cone.userData.baseY === undefined) cone.userData.baseY = cone.position.y;
    cone.position.y = cone.userData.baseY + d * 0.9;
    cone.scale.set(1, 1 + d * 0.6, 1);
  }

  /** @param {number} now @returns {boolean} still moving */
  function tickLevels(now) {
    if (!alive) {
      lastTick = 0;
      return false;
    }
    const down = now - raw.downAt > DOWN_STALE_MS ? 0 : raw.down;
    // Voice levels are small numbers; this makes ordinary speech fill the trace.
    const up = Math.min(1, raw.up * 5);
    const target = Math.min(1, down * 4);
    // Eased by elapsed time, not per frame, so the cone settles about 200 ms
    // after the robot goes quiet whatever the frame rate.
    const dt = Math.min(100, lastTick ? now - lastTick : 16);
    lastTick = now;
    const ease = (/** @type {number} */ tau) => 1 - Math.exp(-dt / tau);
    shown.up += (up - shown.up) * ease(25);
    shown.down += (target - shown.down) * ease(target > shown.down ? 18 : 60);
    placeCone(shown.down);

    history.copyWithin(0, 1);
    history[WAVE_N - 1] = shown.up;
    phase += 1;
    const mic = part('mic');
    if (mic) {
      // Above the mic rather than beside it: the mic's table slot is at the
      // frame's right edge, and the wires come in from the left.
      const at = topOf(mic);
      const x0 = at.x - WAVE.w / 2;
      for (let i = 0; i < WAVE_N; i++) {
        // A zigzag under the level's envelope, scrolling left: reads as a voice trace.
        const s = ((i + phase) % 2 ? 1 : -1) * (0.15 + 0.85 * Math.abs(Math.sin((i + phase) * 0.9)));
        wavePos[i * 3] = x0 + (i / (WAVE_N - 1)) * WAVE.w;
        wavePos[i * 3 + 1] = at.y + WAVE.lift + s * history[i] * WAVE.h;
        wavePos[i * 3 + 2] = at.z;
      }
      waveGeo.attributes.position.needsUpdate = true;
    }
    let loud = shown.up > QUIET || shown.down > QUIET;
    for (let i = 0; i < WAVE_N && !loud; i++) loud = history[i] > QUIET;
    return loud;
  }

  // ---- Page elements that follow a part ---------------------------------

  /** @type {Map<HTMLElement, string>} */
  const followers = new Map();

  /**
   * Keep `el` (position: fixed) centred just above part `id` on screen, until
   * it is removed from the page.
   * @param {HTMLElement} el
   * @param {string} id
   */
  function follow(el, id) {
    followers.set(el, id);
    world.requestRender();
  }

  function tickFollowers() {
    // The camera may have moved this frame; project with where it is now.
    world.camera.updateMatrixWorld();
    const r = canvas.getBoundingClientRect();
    for (const [el, id] of followers) {
      if (!el.isConnected) {
        followers.delete(el);
        continue;
      }
      const g = part(id);
      const p = g && topOf(g).project(world.camera);
      const visible = p && p.z < 1;
      el.style.visibility = visible ? 'visible' : 'hidden';
      if (!visible) continue;
      const x = r.left + ((p.x + 1) / 2) * r.width;
      const y = r.top + ((1 - p.y) / 2) * r.height;
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -130%)`;
    }
    return false;
  }

  world.onFrame((now) => {
    const a = tickSmoke(now);
    const b = tickLevels(now);
    tickFollowers();
    return a || b;
  });

  return {
    smoke,
    led,
    setAlive,
    levels,
    follow,
    /** The bench was redrawn: a rebuilt ESP32 needs its LED lit again. */
    refresh() { paintLed(); },
  };
}
