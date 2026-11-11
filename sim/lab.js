// The laboratory shares the workbench's physical device definitions and meshes.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PARTS } from './parts.js';
import { catalogueEntry } from './ui/catalogue-model.js';
import { buildPart, dispose } from './scene/meshes.js';
import { pinDescription } from './pin-info.js';
import { ledGuide } from './led-guide.js';
import { evaluateLed } from './electrical/led.js';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('stage'));
const name = /** @type {HTMLElement} */ (document.getElementById('name'));
const summary = /** @type {HTMLElement} */ (document.getElementById('summary'));
const pins = /** @type {HTMLElement} */ (document.getElementById('pins'));
const status = /** @type {HTMLElement} */ (document.getElementById('status'));
const detail = /** @type {HTMLElement} */ (document.getElementById('pin-detail'));
const language = /** @type {HTMLSelectElement} */ (document.getElementById('language'));
const back = /** @type {HTMLAnchorElement} */ (document.querySelector('aside a'));
const instructions = /** @type {HTMLElement} */ (document.getElementById('instructions'));
const pinsTitle = /** @type {HTMLElement} */ (document.getElementById('pins-title'));
const guide = /** @type {HTMLElement} */ (document.getElementById('guide'));
const guideTitle = /** @type {HTMLElement} */ (document.getElementById('guide-title'));
const guideSteps = /** @type {HTMLElement} */ (document.getElementById('guide-steps'));
const experiment = /** @type {HTMLElement} */ (document.getElementById('led-experiment'));
const voltage = /** @type {HTMLInputElement} */ (document.getElementById('voltage'));
const resistance = /** @type {HTMLInputElement} */ (document.getElementById('resistance'));
const reversed = /** @type {HTMLInputElement} */ (document.getElementById('reversed'));
const experimentResult = /** @type {HTMLElement} */ (document.getElementById('experiment-result'));
let lang = 'en';
try { if (localStorage.getItem('botreborn.sim.language') === 'zh') lang = 'zh'; } catch { /* Storage is optional. */ }
language.value = lang;
const id = new URLSearchParams(location.search).get('part') ?? '';
const part = Object.hasOwn(PARTS, id) ? PARTS[id] : undefined;
const entry = catalogueEntry(id, lang);

/** @type {import('./parts.js').Pin | undefined} */ let selectedPin;
function updateCopy() {
  const zh = lang === 'zh';
  document.documentElement.lang = zh ? 'zh-CN' : 'en';
  document.title = zh ? '器件实验室' : 'Device laboratory';
  back.textContent = zh ? '← 返回工作台' : '← Back to workbench';
  instructions.textContent = zh ? '拖动旋转 · 滚动缩放' : 'Drag to rotate · scroll to zoom';
  pinsTitle.textContent = zh ? '引脚' : 'Pins';
  const translated = catalogueEntry(id, lang);
  name.textContent = translated?.name ?? (zh ? '器件实验室' : 'Device laboratory');
  summary.textContent = translated?.summary ?? '';
  status.textContent = part ? '' : (zh ? '找不到此器件，请返回工作台重新选择。' : 'This device is not available. Return to the workbench and choose a device.');
  detail.textContent = selectedPin ? `${selectedPin.name} — ${pinDescription(id, selectedPin, lang)}` : (zh ? '选择引脚，在模型上查看其位置。' : 'Select a pin to locate it on the model.');
  guide.hidden = id !== 'led-5mm';
  if (!guide.hidden) {
    guideTitle.textContent = zh ? '搭建 LED 回路' : 'Build an LED circuit';
    guideSteps.replaceChildren(...ledGuide(lang).map(text => {
      const item = document.createElement('li');
      item.textContent = text;
      return item;
    }));
  }
  experiment.hidden = id !== 'led-5mm';
  if (!experiment.hidden) {
    /** @type {HTMLElement} */ (document.getElementById('experiment-title')).textContent = zh ? '尝试电路' : 'Try the circuit';
    /** @type {HTMLElement} */ (document.getElementById('voltage-label')).textContent = zh ? '电源电压' : 'Supply voltage';
    /** @type {HTMLElement} */ (document.getElementById('resistance-label')).textContent = zh ? '串联电阻' : 'Series resistance';
    /** @type {HTMLElement} */ (document.getElementById('reversed-label')).textContent = zh ? '反接 LED' : 'Reverse LED';
    updateExperiment();
  }
}
function updateExperiment() {
  if (!voltage.checkValidity() || !resistance.checkValidity() || !Number.isFinite(voltage.valueAsNumber) || !Number.isFinite(resistance.valueAsNumber)) {
    experimentResult.textContent = lang === 'zh' ? '请输入有效的电压和电阻值。' : 'Enter a valid voltage and resistance.';
    return;
  }
  const result = evaluateLed({ voltage: voltage.valueAsNumber, resistance: resistance.valueAsNumber + 0.2, forwardVoltage: 2, maxCurrentMa: 20, maxPowerMw: 60, currentLimitMa: 500, reversed: reversed.checked });
  const messages = lang === 'zh'
    ? { off: 'LED 不亮', on: 'LED 发光', limited: '电源限流', overcurrent: '电流超过额定值，LED 可能损坏' }
    : { off: 'LED is off', on: 'LED is lit', limited: 'Supply is current-limited', overcurrent: 'Current exceeds the rating; the LED may be damaged' };
  experimentResult.textContent = `${messages[result.state]} · ${result.currentMa.toFixed(2)} mA`;
  const bulb = /** @type {THREE.Mesh | undefined} */ (sceneGroup?.getObjectByName('led-bulb'));
  if (bulb && bulb.material instanceof THREE.MeshPhongMaterial) {
    bulb.material.emissive.setHex(result.state === 'on' || result.state === 'limited' ? 0x9e0800 : 0);
    renderScene?.();
  }
}
/** @type {THREE.Group | undefined} */ let sceneGroup;
/** @type {(() => void) | undefined} */ let renderScene;
for (const input of [voltage, resistance, reversed]) input.addEventListener('input', updateExperiment);
language.addEventListener('change', () => {
  lang = language.value === 'zh' ? 'zh' : 'en';
  try { localStorage.setItem('botreborn.sim.language', lang); } catch { /* Storage is optional. */ }
  updateCopy();
});
updateCopy();

if (!part || !entry) {
  updateCopy();
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
  sceneGroup = group;
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
  renderScene = render;
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
      selectedPin = pin;
      updateCopy();
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
  if (id === 'led-5mm') updateExperiment();
}
