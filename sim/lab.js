// The laboratory shares the workbench's physical device definitions and meshes.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PARTS } from './parts.js';
import { catalogueEntry } from './ui/catalogue-model.js';
import { buildPart, dispose, paintOled } from './scene/meshes.js';
import { pinDescription } from './pin-info.js';
import { ledGuide } from './led-guide.js';
import { evaluateLedLabExperiment } from './lessons/led-circuit.js';
import { lessonByPart } from './lessons/index.js';
import { queueLabHandoff } from './lab-handoff.js';
import { createLabActions } from './ui/lab-actions.js';
import { createLedLessonPanel } from './ui/led-lesson-panel.js';
import { createBme280Panel } from './ui/bme280-panel.js';
import { createBme280LessonPanel } from './ui/bme280-lesson-panel.js';
import { createLessonPanel } from './ui/lesson-panel.js';
import { createButtonLabPanel } from './ui/button-lab-panel.js';
import { createSonarLabPanel } from './ui/hc-sr04-panel.js';
import { createBme280LabExample } from './lessons/bme280-example.js';
import { defaultStimuli, setStimulus } from './stimuli.js';
import { formatReadings, textFrame } from './devices/ssd1306.js';
import { simText } from './ui/strings.js';

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
const actions = createLabActions({
  part: part && id !== 'esp32' ? id : null,
  projectId: lessonByPart(id)?.projectId ?? null,
  projectAddress: id === 'bme280-i2c' ? () => example?.address() ?? '0x77' : undefined,
  enqueue: request => { try { return queueLabHandoff(localStorage, request); } catch { return false; } },
  navigate: () => { location.href = './'; },
  onError: () => { status.textContent = simText(lang, 'lab.storageError'); },
});
summary.after(actions.element);
/** @type {Storage|null} */ let lessonStore = null;
try { lessonStore = localStorage; } catch { /* Lessons remain usable without storage. */ }
const lessonPanel = id === 'led-5mm' ? createLedLessonPanel({ store: lessonStore, lang }) : null;
if (lessonPanel) actions.element.after(lessonPanel.element);
const contentLesson = id === 'led-5mm' || id === 'bme280-i2c' ? null : lessonByPart(id);
/** @type {Record<string,string>} */ const deviceControls = { temperature: '25', humidity: '50', pressure: '1013', angle: '90', direction: 'coast', speed: '0.5', color: 'white', pixels: '8' };
const genericLesson = contentLesson ? createLessonPanel({ lesson: contentLesson, store: lessonStore, lang, onControl: (name, value) => applyDeviceVisual(name, value) }) : null;
if (genericLesson) actions.element.after(genericLesson.element);
let environment = defaultStimuli();
const example = id === 'bme280-i2c' ? createBme280LabExample() : null;
const exampleLabel = document.createElement('p');
const bmePanel = example ? createBme280Panel({ lang, change: (key, value) => {
  environment = setStimulus(environment, key, value);
  bmePanel?.update(example.evaluate(environment), environment);
  bmeLesson?.controlChanged(key);
} }) : null;
if (example && bmePanel) {
  bmePanel.update(example.evaluate(environment), environment);
  actions.element.after(exampleLabel, bmePanel.element);
}
const bmeLesson = example ? createBme280LessonPanel({ store: lessonStore, lang, example, changed: () => bmePanel?.update(example.evaluate(environment), environment) }) : null;
if (bmeLesson) actions.element.after(bmeLesson.element);
const buttonPanel = id === 'push-button' ? createButtonLabPanel(lang) : null;
if (buttonPanel) {
  actions.element.after(buttonPanel.element);
  window.addEventListener('pagehide', () => buttonPanel.dispose(), { once: true });
}
const sonarPanel = id === 'hc-sr04' ? createSonarLabPanel(lang) : null;
if (sonarPanel) actions.element.after(sonarPanel.element);

/** @type {import('./parts.js').Pin | undefined} */ let selectedPin;
let refreshCallout = () => {};
function updateCopy() {
  const zh = lang === 'zh';
  document.documentElement.lang = zh ? 'zh-CN' : 'en';
  actions.setLanguage(lang);
  lessonPanel?.setLanguage(lang);
  bmePanel?.setLanguage(lang);
  bmeLesson?.setLanguage(lang);
  genericLesson?.setLanguage(lang);
  buttonPanel?.setLanguage(lang);
  sonarPanel?.setLanguage(lang);
  exampleLabel.textContent = simText(lang, 'bme.example');
  document.title = zh ? '器件实验室' : 'Device laboratory';
  back.textContent = zh ? '← 返回工作台' : '← Back to workbench';
  instructions.textContent = zh ? '拖动旋转 · 滚动缩放' : 'Drag to rotate · scroll to zoom';
  pinsTitle.textContent = zh ? '引脚' : 'Pins';
  const translated = catalogueEntry(id, lang);
  name.textContent = translated?.name ?? (zh ? '器件实验室' : 'Device laboratory');
  summary.textContent = translated?.summary ?? '';
  status.textContent = part ? '' : (zh ? '找不到此器件，请返回工作台重新选择。' : 'This device is not available. Return to the workbench and choose a device.');
  detail.textContent = selectedPin ? `${selectedPin.name} — ${pinDescription(id, selectedPin, lang)}` : (zh ? '选择引脚，在模型上查看其位置。' : 'Select a pin to locate it on the model.');
  refreshCallout();
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
    /** @type {HTMLElement} */ (document.getElementById('resistance-label')).textContent = zh ? '串联电阻（0 表示无电阻）' : 'Series resistance (0 means no resistor)';
    /** @type {HTMLElement} */ (document.getElementById('reversed-label')).textContent = zh ? '反接 LED' : 'Reverse LED';
    updateExperiment();
  }
}
function updateExperiment() {
  if (!voltage.checkValidity() || !resistance.checkValidity() || !Number.isFinite(voltage.valueAsNumber) || !Number.isFinite(resistance.valueAsNumber)) {
    experimentResult.textContent = lang === 'zh' ? '请输入有效的电压和电阻值。' : 'Enter a valid voltage and resistance.';
    return;
  }
  const { outcome: result } = evaluateLedLabExperiment({ voltage: voltage.valueAsNumber, resistance: resistance.valueAsNumber, reversed: reversed.checked });
  /** @type {Record<string,string>} */
  const messages = lang === 'zh'
    ? { off: 'LED 不亮', on: 'LED 发光', limited: '电源限流', overcurrent: '电流超过额定值，LED 可能损坏', reversed: 'LED 极性接反', short: '电源短路', unsupported: '电路不在模拟范围内', burnt: 'LED 已损坏' }
    : { off: 'LED is off', on: 'LED is lit', limited: 'Supply is current-limited', overcurrent: 'Current exceeds the rating; the LED may be damaged', reversed: 'LED polarity is reversed', short: 'Supply is shorted', unsupported: 'Circuit is outside the modeled range', burnt: 'LED is burnt' };
  experimentResult.textContent = `${messages[result.state] ?? result.state} · ${result.currentMa.toFixed(2)} mA`;
  lessonPanel?.experiment({ reversed: reversed.checked, voltage: voltage.valueAsNumber, resistance: resistance.valueAsNumber, state: result.state });
  const bulb = /** @type {THREE.Mesh | undefined} */ (sceneGroup?.getObjectByName('led-bulb'));
  if (bulb && bulb.material instanceof THREE.MeshPhongMaterial) {
    bulb.material.emissive.setHex(result.state === 'on' || result.state === 'limited' ? 0x9e0800 : 0);
    bulb.material.emissiveIntensity = 'brightness' in result ? result.brightness : 0;
    renderScene?.();
  }
}
/** @type {THREE.Group | undefined} */ let sceneGroup;
/** @type {(() => void) | undefined} */ let renderScene;
let motorLoop = false;
const LED_COLORS = /** @type {Record<string,[number,number,number]>} */ ({ off: [0, 0, 0], red: [255, 0, 0], green: [0, 255, 0], blue: [0, 0, 255], white: [255, 255, 255] });
function paintInitialDevice() {
  if (!sceneGroup) return;
  if (id === 'ssd1306') {
    const screen = sceneGroup.getObjectByName('oled-screen');
    if (screen) paintOled(screen, formatReadings({ temperatureC: 25, humidityPct: 50, pressureHpa: 1013 }).frame);
  }
  if (id === 'sg90') {
    const horn = sceneGroup.getObjectByName('servo-horn');
    if (horn) horn.rotation.y = -THREE.MathUtils.degToRad(Number(deviceControls.angle));
  }
  if (id === 'ws2812-strip') paintStrip();
  renderScene?.();
}
function paintStrip() {
  if (!sceneGroup) return;
  const color = LED_COLORS[deviceControls.color] ?? LED_COLORS.off;
  const lit = Math.max(1, Math.min(8, Number(deviceControls.pixels) || 1));
  for (let i = 0; i < 8; i++) {
    const led = /** @type {any} */ (sceneGroup.getObjectByName(`strip-led-${i}`));
    if (!led?.material?.color) continue;
    const rgb = i < lit ? color : [0, 0, 0];
    led.material.color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
    led.material.emissive?.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
  }
}
function spinMotor() {
  if (motorLoop) return;
  motorLoop = true;
  const step = () => {
    const running = id === 'dc-motor-small' && !['coast', 'brake'].includes(deviceControls.direction) && Number(deviceControls.speed) > 0;
    if (!running || !sceneGroup) { motorLoop = false; return; }
    const rotor = sceneGroup.getObjectByName('motor-rotor');
    if (rotor) rotor.rotation.x += (deviceControls.direction === 'reverse' ? -1 : 1) * Math.max(0.03, Number(deviceControls.speed)) * 0.25;
    renderScene?.();
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function applyDeviceVisual(/** @type {string} */ name, /** @type {string} */ value) {
  deviceControls[name] = value;
  if (!sceneGroup) return;
  if (id === 'sg90' && name === 'angle') {
    const horn = sceneGroup.getObjectByName('servo-horn');
    if (horn) horn.rotation.y = -THREE.MathUtils.degToRad(Number(value));
    renderScene?.();
  } else if (id === 'button-module' && name === 'pressed') {
    const cap = sceneGroup.getObjectByName('button-cap');
    if (cap) cap.position.y = Number(cap.userData.baseY) - (value === 'true' ? 0.35 : 0);
    renderScene?.();
  } else if (id === 'dc-motor-small' && (name === 'direction' || name === 'speed')) {
    spinMotor();
  } else if (id === 'ws2812-strip' && (name === 'color' || name === 'pixels')) {
    paintStrip();
    renderScene?.();
  } else if (id === 'ssd1306' && ['temperature', 'humidity', 'pressure'].includes(name)) {
    const screen = sceneGroup.getObjectByName('oled-screen');
    if (screen) paintOled(screen, formatReadings({ temperatureC: Number(deviceControls.temperature), humidityPct: Number(deviceControls.humidity), pressureHpa: Number(deviceControls.pressure) }).frame);
    renderScene?.();
  }
}
for (const input of [voltage, resistance, reversed]) input.addEventListener('input', () => {
  updateExperiment();
  if (voltage.checkValidity() && resistance.checkValidity() && (input === voltage || input === resistance)) lessonPanel?.controlChanged(input.id);
});
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
  paintInitialDevice();
  const bounds = new THREE.Box3().setFromObject(group);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const distance = Math.max(size.x, size.y, size.z, 10) * 2;
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, distance * 20);
  camera.position.copy(center).add(new THREE.Vector3(distance, distance, distance));
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(center);
  controls.update();
  const callout = document.createElement('div');
  callout.id = 'pin-callout';
  callout.hidden = true;
  document.body.append(callout);
  const leader = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xffb547, depthTest: false, transparent: true }),
  );
  leader.visible = false;
  leader.renderOrder = 11;
  scene.add(leader);
  /** @type {THREE.Vector3|null} */ let calloutEnd = null;
  const updateCalloutPosition = () => {
    if (!calloutEnd) { callout.hidden = true; return; }
    const point = calloutEnd.clone().project(camera);
    callout.hidden = false;
    callout.style.left = `${(point.x * 0.5 + 0.5) * canvas.clientWidth}px`;
    callout.style.top = `${(-point.y * 0.5 + 0.5) * canvas.clientHeight}px`;
  };
  /** @param {import('./parts.js').Pin} pin */
  const showPinCallout = pin => {
    const anchor = anchors.get(pin.name);
    if (!anchor) { calloutEnd = null; leader.visible = false; callout.hidden = true; return; }
    const start = anchor.clone();
    group.localToWorld(start);
    const outward = start.clone().sub(center);
    if (outward.lengthSq() < 1e-6) outward.set(0, 1, 0);
    outward.normalize();
    calloutEnd = start.clone().addScaledVector(outward, Math.max(3, size.length() * 0.25));
    leader.geometry.setFromPoints([start, calloutEnd]);
    leader.visible = true;
    callout.textContent = `${pin.name} — ${pinDescription(id, pin, lang)}`;
    updateCalloutPosition();
  };
  const hidePinCallout = () => { calloutEnd = null; leader.visible = false; callout.hidden = true; };
  refreshCallout = () => { if (selectedPin) showPinCallout(selectedPin); };
  const render = () => { renderer.render(scene, camera); updateCalloutPosition(); };
  renderScene = render;
  const markerRadius = Math.max(0.22, Math.min(0.9, size.length() * 0.02));
  const marker = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(markerRadius * 0.65, markerRadius, 24),
    new THREE.MeshBasicMaterial({ color: 0xffb547, depthTest: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(markerRadius * 0.18, 16),
    new THREE.MeshBasicMaterial({ color: 0xffb547, depthTest: false }),
  );
  dot.rotation.x = -Math.PI / 2;
  marker.add(ring, dot);
  marker.visible = false;
  marker.renderOrder = 10;
  ring.renderOrder = 10;
  dot.renderOrder = 11;
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
      showPinCallout(pin);
      lessonPanel?.selectPin(pin.name);
      bmeLesson?.selectPin(pin.name);
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
  /** @type {{x:number,y:number}|null} */ let downAt = null;
  canvas.addEventListener('pointerdown', event => { downAt = { x: event.clientX, y: event.clientY }; });
  canvas.addEventListener('pointerup', event => {
    const moved = downAt ? Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) : 99;
    downAt = null;
    if (moved > 4) return;
    for (const other of buttons) other.setAttribute('aria-pressed', 'false');
    marker.visible = false;
    selectedPin = undefined;
    hidePinCallout();
    updateCopy();
    render();
  });
  controls.addEventListener('change', render);
  window.addEventListener('resize', resize);
  window.addEventListener('pagehide', () => { controls.dispose(); dispose(group); renderer.dispose(); callout.remove(); }, { once: true });
  resize();
  if (id === 'led-5mm') updateExperiment();
}
