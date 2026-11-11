// The laboratory shares the workbench's physical device definitions and meshes.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PARTS } from './parts.js';
import { catalogueEntry } from './ui/catalogue-model.js';
import { buildPart, dispose } from './scene/meshes.js';
import { pinDescription } from './pin-info.js';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('stage'));
const name = /** @type {HTMLElement} */ (document.getElementById('name'));
const summary = /** @type {HTMLElement} */ (document.getElementById('summary'));
const pins = /** @type {HTMLElement} */ (document.getElementById('pins'));
const status = /** @type {HTMLElement} */ (document.getElementById('status'));
const detail = /** @type {HTMLElement} */ (document.getElementById('pin-detail'));
const id = new URLSearchParams(location.search).get('part') ?? '';
const part = Object.hasOwn(PARTS, id) ? PARTS[id] : undefined;
const entry = catalogueEntry(id);

if (!part || !entry) {
  status.textContent = 'This device is not available. Return to the workbench and choose a device.';
} else {
  name.textContent = entry.name;
  summary.textContent = entry.summary;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x75878b);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x455057, 2));
  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(-20, 40, 30);
  scene.add(light);
  const { group, anchors } = buildPart(part, { onBoard: false, burnt: false });
  scene.add(group);
  const bounds = new THREE.Box3().setFromObject(group);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const distance = Math.max(size.x, size.y, size.z, 10) * 2;
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, distance * 20);
  camera.position.copy(center).add(new THREE.Vector3(distance, distance, distance));
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(center);
  controls.update();
  const render = () => renderer.render(scene, camera);
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffb547, depthTest: false }),
  );
  marker.visible = false;
  marker.renderOrder = 10;
  group.add(marker);
  /** @type {HTMLButtonElement[]} */
  const buttons = [];
  for (const pin of part.pins) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pin';
    button.textContent = pin.name;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      for (const other of buttons) other.setAttribute('aria-pressed', String(other === button));
      const anchor = anchors.get(pin.name);
      marker.visible = !!anchor;
      if (anchor) marker.position.copy(anchor);
      detail.textContent = `${pin.name} — ${pinDescription(id, pin)}`;
      render();
    });
    buttons.push(button);
    item.append(button);
    pins.append(item);
  }
  const resize = () => {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render();
  };
  controls.addEventListener('change', render);
  window.addEventListener('resize', resize);
  window.addEventListener('pagehide', () => { controls.dispose(); dispose(group); renderer.dispose(); }, { once: true });
  resize();
}
