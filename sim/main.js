// The wiring simulator's boot: read the saved bench, draw it, give it hands
// (every change is saved as it is made), the three views side by side (hold
// Space to peek at the other flat view without changing the choice), the panels, and the
// USB cable that powers the bench up.
//
// Power-on is a moment (spec §7): nothing reacts while wiring. When the plug
// goes in, the circuit is judged once, what burns burns, and the bench either
// comes alive as a body or shows why not. Pulling the plug ends it.

import { emptyBench, load, serialize, addPart, addBoard, park, setWireColor, removeWire, setPartProperty } from './bench.js';
import { deviceByPart } from './devices/catalog.js';
import { applyLedDamage, evaluateLedBench } from './electrical/led-bench.js';
import { evaluateBench } from './devices/evaluate.js';
import { ownershipOf } from './firmware/ownership.js';
import { createRuntimePanel } from './ui/device-runtime-panel.js';
import { planById, planOptionsFor, planSteps } from './plan.js';
import { previewText } from './project-preview.js';
import { nextPlanHint } from './guidance.js';
import { defaultStimuli, setStimulus } from './stimuli.js';
import { motorLevels, toyAction } from './car.js';
import { createWandFeed } from './wand-feed.js';
import { createShakeDetector } from '../core/shake-detector.js';
import { PARTS } from './parts.js';
import { spotForNew } from './snap.js';
import { screenById } from '../core/screens.js';
import { diagnose } from './diagnose.js';
import { liveDiagnosis } from './live-diagnosis.js';
import { isViewPeekShortcut } from './view-shortcut.js';
import { faultText, adminLink, keepsFault } from './body.js';
import { createBoardRuntime, bootMode } from './firmware/runtime.js';
import { createBodyAudio } from './body.js';
import { createBodyAudioLink } from './firmware/audio-link.js';
import { demoSkips, lookupCharacter } from './capabilities.js';
import { isRemote, provisionSteps, screenMismatch, createProvisioning, tokenCandidates } from './provision.js';
import { firmwareById } from './firmware/index.js';
import { ledPattern } from './firmware/led.js';
import { createSerialPanel } from './ui/serial-panel.js';
import { runFlash, canFlash } from './firmware/flash.js';
import { deviceInitialized } from './firmware/parts-view.js';
import { createSketchContext } from './firmware/sketch-context.js';
import { createSketchRunner } from './firmware/sketch.js';
import { connectBody } from '../phone/body-link.js';
import { openScreenFeed } from './screen-feed.js';
import { keptBench, keepBench, dropKept, mergeKeptBench } from './keep.js';
import { RECIPES, startBench, recipeSteps, applyStep } from './recipes.js';
import { projectById } from './projects.js';
import { consumeLabHandoff } from './lab-handoff.js';
import { connectionProgress } from './project-progress.js';
import { rankedDiagnoses } from './ranked-diagnoses.js';
import { blockingBoardPowerFault, initialDriveActions } from './board-power-gate.js';
import { createPowerInterlock, createStartLock } from './power-interlock.js';
import { runRecipe, speedFactor } from './scene/autowire.js';
import { createPanels } from './panels.js';
import { createContextPanel } from './ui/context-panel.js';
import { SIM_LANGUAGE_KEY, simulatorLanguage, requestLanguageChange } from './ui/language.js';
import { simText } from './ui/strings.js';
import { describeSelection } from './selection.js';
import { createWorld } from './scene/world.js';
import { attachInteraction, beginCarry } from './scene/interact.js';
import { attachUsb } from './scene/usb.js';
import { createEffects } from './scene/effects.js';

/** @typedef {import('./scene/world.js').ViewMode} ViewMode */

const BENCH_KEY = 'botreborn.sim.bench';
const VIEW_KEY = 'botreborn.sim.view';
const SPEED_KEY = 'botreborn.sim.speed';

/** @type {ViewMode[]} */
const VIEWS = ['tilted', 'top', 'orbit'];
/** @type {Record<ViewMode, string>} */
const VIEW_NAMES = { tilted: 'Tilted', top: 'Top', orbit: 'Orbit' };

// Storage can be missing or refuse (private windows, blocked site data); the
// page then simply starts from an empty bench in the default view.
/** @param {string} key */
function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
/** @param {string} key @param {string} value */
function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* not saved; nothing else to do */ }
}

/** @param {unknown} v @returns {v is ViewMode} */
const isView = (v) => VIEWS.includes(/** @type {ViewMode} */ (v));

// Share the laboratory's saved language; invalid or unavailable storage falls back to English.
document.documentElement.lang = simulatorLanguage(read(SIM_LANGUAGE_KEY));

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('bench'));
const viewButtons = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('#views button')]);
const peekHint = /** @type {HTMLElement} */ (document.getElementById('peek'));
const world = createWorld(canvas);
const effects = createEffects(world);
// A page that was closed with the cable in is not powered when it opens again.
const savedBench = load(read(BENCH_KEY));
let bench = { ...savedBench, usb: false, placed: savedBench.placed.map(p => p.part === 'push-button' ? { ...p, properties: { ...p.properties, pressed: false } } : p) };
let environment = defaultStimuli();
/** Runtime device stimuli, keyed by part id. */
/** @type {{servo:Record<string, any>, motor:Record<string, any>, strip:Record<string, any>, display:Record<string, any>, buttons:Record<string, boolean>}} */
const runtime = { servo: {}, motor: {}, strip: {}, display: {}, buttons: {} };
/** GPIO levels the running sketch asked for; part of the next evaluation. */
/** @type {Record<string, 'high'|'low'|'high-z'>} */ let gpioOutputs = {};
/** A sonar measurement a sketch latched, until it turns it off or the board stops. */
/** @type {{ measure: boolean, distanceCm: number } | null} */ let sonar = null;
/** The board runtime: boot events, the brain link and the screen feed. */
/** @type {ReturnType<typeof createBoardRuntime> | null} */
let boardRuntime = null;
/** @type {import('./projects.js').Project | null} */
/** @type {import('./plan.js').Plan|import('./projects.js').Project|null} */
let activeProject = null;
const panels = createPanels({
  hint: (projectId, options) => (bench.placed.some((p) => p.burnt)
    ? document.documentElement.lang === 'zh' ? simText('zh', 'hint.burnt') : 'A part burnt out; drag it to the bin and take a new one from Parts.'
    : projectId
      ? nextPlanHint(bench, planById(projectId, options), document.documentElement.lang)?.text ?? (document.documentElement.lang === 'zh' ? simText('zh', 'hint.ready') : 'Looks complete — plug in USB.')
      : null),
  reset,
  follow: effects.follow,
  add: (part) => addFromBin(part),
  carry: (part, e) => beginCarry(/** @type {any} */ (part), e),
  changeLanguage: lang => {
    let storageFailed = false;
    const changed = requestLanguageChange(lang, {
      confirm: () => window.confirm(document.documentElement.lang === 'zh'
        ? '切换语言会保存接线、重新加载工作台并断开当前会话。当前项目选择不会保存。是否继续？'
        : 'Changing language saves the bench, reloads the workbench and disconnects the current session. The project selection is not saved. Continue?'),
      save: value => { try { localStorage.setItem(BENCH_KEY, serialize(bench)); localStorage.setItem(SIM_LANGUAGE_KEY, value); } catch (error) { storageFailed = true; throw error; } },
      reload: () => location.reload(),
    });
    if (storageFailed) panels.status(document.documentElement.lang === 'zh' ? '无法保存语言设置，请检查浏览器存储权限。' : 'Could not save the language preference; check browser storage permissions.');
    return changed;
  },
  learn: (part) => {
    if (!deviceByPart(part)) return panels.status(simText(document.documentElement.lang, 'board.unknownDevice'));
    location.href = `./lab.html?part=${encodeURIComponent(part)}`;
  },
  projectState: (id, options) => {
    const plan = planById(id, options);
    const selection = describeSelection(bench, hands.selection(), document.documentElement.lang);
    if (plan) return { mode: 'guided', evaluated: true, project: plan, progress: connectionProgress(bench, plan), selection, diagnoses: [] };
    // Independent DC supplies can energize an LED circuit without USB.
    const result = bench.usb || bench.placed.some(part => part.part === 'dc-source' && !part.burnt)
      ? evaluateBench(bench, { firmware: firmwareById(bench.board.firmware), ownership: ownershipOf(bench) })
      : null;
    const diagnoses = result ? rankedDiagnoses(bench, result, document.documentElement.lang) : [];
    return { mode: 'free', evaluated: Boolean(result), project: null, progress: [], selection, diagnoses };
  },
  focusProject: points => {
    hands.highlightGuidance(points);
    const panel = document.getElementById('project-panel');
    const left = panel && !panel.hidden ? Math.max(0, panel.getBoundingClientRect().right - canvas.getBoundingClientRect().left) : 0;
    void world.focusPoints(points, { left });
  },
  clearProjectFocus: () => hands.highlightGuidance([]),
  start: (id, mode, hooks, speed) => { unlockAudio(); return startPlan(id, planOptionsFor(bench), mode, hooks, speed); },
  build: (id, options) => { unlockAudio(); return startPlan(id, options); },
  planOptions: options => planOptionsFor(bench, options),
  leaveProject: () => { activeProject = null; },
  speed: speedFactor(Number(read(SPEED_KEY))),
  firmwareDrivers: () => firmwareById(bench.board.firmware)?.drivers ?? null,
  rememberSpeed: (/** @type {number} */ x) => write(SPEED_KEY, String(speedFactor(x))),
});

const context = createContextPanel({
  lang: document.documentElement.lang === 'zh' ? 'zh' : 'en',
  startWire: point => hands.startWire(point),
  recolorWire: (id, color) => setBench(setWireColor(bench, id, color)),
  removeWire: id => setBench(removeWire(bench, id)),
});
document.body.append(context.element);
const runtimePanel = createRuntimePanel({
  lang: document.documentElement.lang === 'zh' ? 'zh' : 'en',
  change: (target, values) => applyRuntime(target, values),
});
document.body.append(runtimePanel.element);
const serial = createSerialPanel({
  lang: document.documentElement.lang === 'zh' ? 'zh' : 'en',
  firmware: /** @type {any} */ (firmwareById(bench.board.firmware) ?? firmwareById('body')),
  settings: bench.board.settings,
  characters: [],
  onChange: (settings) => {
    bench = { ...bench, board: { ...bench.board, settings } };
    setBench(bench);
  },
  onReboot: () => rebootBoard(),
});
document.body.append(serial.element);
/** @param {import('./selection.js').Selection} selection */
function showContext(selection) {
  if (!selection || selection.kind === 'part') { context.hide(); return; }
  const info = describeSelection(bench, selection, document.documentElement.lang);
  const color = selection.kind === 'wire' ? bench.wires.find(w => w.id === selection.id)?.color : undefined;
  context.show({ selection, info, color });
}

/** The stimuli the bench and its runtime controls currently request. */
function simulationStimuli() {
  return {
    ...environment, ...(sonar ? { sonar } : {}),
    buttons: runtime.buttons, servo: runtime.servo, motor: runtime.motor, strip: runtime.strip, displays: runtime.display,
  };
}

/** Push evaluated device state (OLED frames, servo, motor, strip) into the scene. */
function refreshDeviceVisuals() {
  const stimuli = simulationStimuli();
  const engineering = evaluateBench(bench, {
    stimuli,
    ownership: ownershipOf(bench),
    deviceStates: boardRuntime?.deviceStates() ?? {},
    gpioOutputs,
    firmware: firmwareById(bench.board.firmware),
  }).engineering;
  world.devices(engineering);
}

/** @param {string} partId @param {string} instanceId @returns {import('./ui/device-runtime-panel.js').RuntimeTarget|null} */
function runtimeTarget(partId, instanceId) {
  const id = instanceId;
  if (partId === 'sg90') return { kind: 'servo', id };
  if (partId === 'tb6612fng') return { kind: 'driver', id };
  if (partId === 'dc-motor-small') return { kind: 'motor', id, driverId: bench.placed.find(other => other.part === 'tb6612fng')?.id ?? id };
  if (partId === 'ws2812-strip') return { kind: 'strip', id };
  if (partId === 'ssd1306') return { kind: 'display', id };
  if (partId === 'button-module') return { kind: 'button', id };
  return null;
}

/** @param {import('./ui/device-runtime-panel.js').RuntimeTarget} target @param {Record<string, any>} values */
function applyRuntime(target, values) {
  if (target.kind === 'servo') runtime.servo[target.id] = { angle: Number(values.angle) };
  else if (target.kind === 'driver' || target.kind === 'motor') runtime.motor[target.id] = { direction: values.direction, speed: Number(values.speed), load: values.load };
  else if (target.kind === 'strip') {
    /** @type {Record<string, [number, number, number]>} */
    const colors = { off: [0, 0, 0], red: [255, 0, 0], green: [0, 255, 0], blue: [0, 0, 255], white: [255, 255, 255] };
    const rgb = colors[values.color] ?? colors.off;
    runtime.strip[target.id] = { pixels: Array.from({ length: Math.max(1, Math.min(60, Number(values.pixels) || 1)) }, () => [...rgb]) };
  } else if (target.kind === 'display') {
    runtime.display[target.id] = { lines: [`T ${Number(values.temperature).toFixed(1)} C`, `H ${Math.round(Number(values.humidity))} %`, `P ${Math.round(Number(values.pressure))} HPA`] };
  } else if (target.kind === 'button') runtime.buttons[target.id] = Boolean(values.pressed);
  refreshDeviceVisuals();
}

/** @param {import('./bench.js').Bench} b */
function setBench(b) {
  const result = applyLedDamage(b);
  bench = result.bench;
  const openPart = panels.openPartId();
  if (openPart) {
    const selected = bench.placed.find(p => p.id === openPart);
    const sensor = selected?.part === 'bme280-i2c'
      ? evaluateBench(bench, { stimuli: environment, firmware: firmwareById(bench.board.firmware), ownership: ownershipOf(bench), deviceStates: boardRuntime?.deviceStates() ?? {} }).engineering.bme280[openPart]
      : undefined;
    panels.refreshPart(openPart, selected?.properties ?? null, sensor, environment);
  }
  hands.refreshSelection();
  if (!context.element.hidden) showContext(hands.selection());
  write(BENCH_KEY, serialize(bench));
  world.show(bench);
  refreshDeviceVisuals();
  // The body normally uses a power-on snapshot; unsafe board power changes
  // instead stop the session and latch until USB is cycled.
  if (bench.usb && powered) {
    const evaluated = evaluateBench(bench, { firmware: firmwareById(bench.board.firmware), ownership: ownershipOf(bench) });
    const fault = powerInterlock.observe(bench, evaluated);
    const hint = fault
      ? diagnose(bench, { ...evaluated.legacy, faults: [fault], burns: evaluated.burns }, document.documentElement.lang).find(item => item.kind === 'fault') ?? null
      : liveDiagnosis(bench, document.documentElement.lang, evaluated);
    hands.highlightPoints(hint?.points ?? []);
    const reconnect = powerInterlock.tripped() ? simText(document.documentElement.lang, 'power.reconnect') : '';
    line.fault = [hint?.text, reconnect].filter(Boolean).join(' ') || null;
    showLine();
  }
  hands.refreshHighlights();
  panels.refreshProject();
  for (const id of result.burns) effects.smoke(id);
  if (result.burns.length) panels.status(simText(document.documentElement.lang, 'led.burnt'));
  usb.refresh();
  effects.refresh();
}

/**
 * A click on a part in the bin: it lands in front of the bench, moved off
 * anything already there. Touch screens get the same place a drag would.
 * @param {string} part
 */
function addFromBin(part) {
  if (part !== 'breadboard' && !PARTS[part]) return;
  const kind = /** @type {Parameters<typeof spotForNew>[1]} */ (part);
  const at = spotForNew(bench, kind);
  setBench(kind === 'breadboard' ? addBoard(bench, at).bench : addPart(bench, kind, at).bench);
}

const hands = attachInteraction(world, () => bench, setBench, {
  say: (text) => panels.status(text),
  onSelect: (selection) => {
    context.element.style.left = '';
    context.element.style.top = '';
    context.element.style.right = '';
    showContext(selection);
    const selectedPart = selection?.kind === 'part' ? bench.placed.find(item => item.id === selection.id) : undefined;
    const target = selectedPart ? runtimeTarget(selectedPart.part, selectedPart.id) : null;
    if (target) runtimePanel.show(target); else runtimePanel.hide();
    panels.refreshProject();
  },
  selectWire: (id, x, y) => {
    showContext({ kind: 'wire', id });
    context.position(x, y);
  },
  selectPin: (_point, x, y) => context.position(x, y),
  selectPart: (id, x, y) => {
    const part = bench.placed.find(p => p.id === id);
    if (!part) return;
    const schema = deviceByPart(part.part)?.properties ?? {};
    const led = part.part === 'led-5mm' ? evaluateLedBench(bench, id) : null;
    const bme = part.part === 'bme280-i2c' ? {
      state: evaluateBench(bench, {
        stimuli: environment,
        firmware: firmwareById(bench.board.firmware),
        ownership: ownershipOf(bench),
        deviceStates: boardRuntime?.deviceStates() ?? {},
      }).engineering.bme280[id], environment,
      change: (/** @type {string} */ key, /** @type {number} */ value) => {
        environment = setStimulus(environment, key, value);
        const current = bench.placed.find(item => item.id === id);
        const state = evaluateBench(bench, {
          stimuli: environment,
          firmware: firmwareById(bench.board.firmware),
          ownership: ownershipOf(bench),
          deviceStates: boardRuntime?.deviceStates() ?? {},
        }).engineering.bme280[id];
        panels.refreshPart(id, current?.properties ?? null, state, environment);
        refreshDeviceVisuals();
      },
    } : undefined;
    if (Object.keys(schema).length || led || bme) panels.partMenu(id, x, y, schema, part.properties, led,
      (key, value) => setBench(setPartProperty(bench, id, key, value)), bme);
  },
});
const startLock = createStartLock();
const powerInterlock = createPowerInterlock(stopUnsafeSession);
const usb = attachUsb(world, {
  onPlug: (on, meta) => (on ? plugIn(meta) : unplug()),
  onRequest: () => unlockAudio(),
  locked: () => startLock.locked(),
  bench: () => bench,
});

// #view=top opens in that view without saving it: handy for a screenshot.
const asked = new URLSearchParams(location.hash.slice(1)).get('view');
const saved = read(VIEW_KEY);
/** @type {ViewMode} */
let view = isView(asked) ? asked : isView(saved) ? saved : 'tilted';
/** @type {ViewMode | null} */
let peeking = null;

/** The wiring view to go back to when the bench stops being a body. */
let wiringView = view;

/**
 * What holding Space shows from a view: the other flat view, whose holes are
 * the easy ones to aim at.
 * @param {ViewMode} v @returns {ViewMode}
 */
const peekOf = (v) => (v === 'top' ? 'tilted' : 'top');

/** @param {ViewMode} v */
function go(v) {
  world.view(v);
  // The button stays on the choice while peeking: the peek is not a choice.
  for (const b of viewButtons) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  peekHint.textContent = peeking ? `Release Space for ${VIEW_NAMES[view]}` : `Hold Space for ${VIEW_NAMES[peekOf(view)]}`;
}
setBench(bench);
go(view);

for (const b of viewButtons) {
  b.addEventListener('click', () => {
    const v = b.dataset.view;
    if (!isView(v)) return;
    view = v;
    write(VIEW_KEY, view);
    peeking = null;
    go(view);
  });
}

addEventListener('keydown', (e) => {
  if (!isViewPeekShortcut(e)) return;
  // Space would also press a focused button; this key belongs to the bench.
  e.preventDefault();
  if (e.repeat || peeking) return;
  peeking = peekOf(view);
  go(peeking);
});
const unpeek = () => {
  if (!peeking) return;
  peeking = null;
  go(view);
};
addEventListener('keyup', (e) => {
  if (e.code !== 'Space' || !peeking) return;
  e.preventDefault();
  unpeek();
});
// Letting go of Space in another window never reaches us.
addEventListener('blur', unpeek);

// ---- Power --------------------------------------------------------------

const bodyAudio = createBodyAudio();
/** The microphone uplink and speaker downlink over the board's own link. */
/** @type {ReturnType<typeof createBodyAudioLink> | null} */ let bodyAudioLink = null;
/** @type {ReturnType<typeof createSketchRunner> | null} */ let sketchRunner = null;
/** Reads the wand into the shake detector while a body is plugged in. @type {ReturnType<typeof createWandFeed> | null} */
let wandFeed = null;
/** @type {ReturnType<typeof setInterval> | undefined} */
let wandTimer;
/** Bumped by every plug and unplug, so an answer from an older plug-in is ignored. */
let plugs = 0;
/** The character whose layer failed, for the link on the api line. */
let apiFor = '';

/**
 * What the status line says while plugged in, most important first: why the
 * session ended, a dropped link, what is wrong with the wiring, the browser
 * keeping the microphone or the speaker away, what the robot is doing.
 * `ending` is what to say to try a bench the simulator built, kept after the state.
 * @type {{ end: string | null, lost: boolean, api: string | null, fault: string | null, mic: string | null, sound: boolean, state: string | null, who: string | null, ending: string | null }}
 */
let line = { end: null, lost: false, api: null, fault: null, mic: null, sound: false, state: null, who: null, ending: null };
function showLine() {
  // The user is answering a setup question; boot chatter must not take it away.
  if (offerLocked) return;
  if (line.end) return panels.status(line.end);
  if (line.lost) return panels.status(simText(document.documentElement.lang, 'status.reconnecting'));
  if (line.api) return panels.status(line.api, { href: adminLink(apiFor), label: 'open' });
  if (line.fault) return panels.status(line.fault);
  if (line.mic) return panels.status(line.mic);
  if (line.sound) {
    const lang = document.documentElement.lang;
    return panels.status(simText(lang, 'audio.enable'));
  }
  if (line.state) {
    const state = line.who ? `${line.who} · ${line.state}` : line.state;
    return panels.status(line.ending ? `${state} — ${line.ending}` : state);
  }
  if (!offerBack()) panels.status(null);
}

/** The page's storage, or one that refuses everything when the browser blocks it. */
function store() {
  try { return localStorage; } catch { return { getItem: () => null, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } }; }
}

/** Whether a recipe run is on the table. */
let running = false;
/** How the current run was started: Build types setup commands, Demo waits. */
/** @type {'build' | 'watch' | 'step'} */
let planMode = 'build';
/** The plan whose setup was already offered, so its own reboot does not ask again. */
/** @type {string | null} */
let provisionedFor = null;
/** @type {ReturnType<typeof createProvisioning> | null} */
let provisioning = null;
/** A setup prompt held back until a Demo's own steps stop writing the line. */
/** @type {(() => void) | null} */
let offerOnEnd = null;
/** A setup question owns the status line until it is answered. */
let offerLocked = false;
/**
 * What the recipe now being played needs of the character and what to say to
 * try the result. Read once by the plug-in the run itself causes, so a plug
 * the user pushes in later chooses a character by hand again.
 * @type {{ need: string[], ending: string } | null}
 */
let recipeOn = null;
/** The run's controls while one is on the table. */
/** @type {ReturnType<typeof runRecipe> | null} */
let runner = null;

/**
 * Shows the way back to the user's own bench, when one is kept and no run is
 * active. Returns whether it did.
 */
function offerBack() {
  if (running || !keptBench(store())) return false;
  const lang = document.documentElement.lang;
  panels.status(simText(lang, 'board.builtForYou'), {
    actions: [
      { label: simText(lang, 'board.backToMine'), run: backToMine },
      { label: simText(lang, 'board.keepThisOne'), run: keepThisOne },
    ],
  });
  return true;
}

function backToMine() {
  const mine = keptBench(store());
  if (!mine) return;
  if (usb.plugged) {
    usb.pullOut();
    unplug();
  }
  activeProject = null;
  panels.selectProject('');
  setBench(mergeKeptBench(mine, bench));
  dropKept(store());
  running = false;
  recipeOn = null;
  showLine();
}

/** Makes the bench on the table the user's own: the kept one is dropped, the line goes. */
function keepThisOne() {
  dropKept(store());
  showLine();
}

/** What power-on made of this bench; null when the plug is out. */
/** @type {import('./power.js').Outcome | null} */
let powered = null;
/** The last reason each toy stopped, so a repeated one is not re-announced. */
/** @type {Record<string, string | null>} */
const blocks = {};

/** The toys that are part of the circuit: wired, and not burnt. */
function movingToys() {
  return /** @type {[string, { wiring: import('./car.js').Wiring, action: import('./car.js').ToyAction }][]} */ (
    Object.entries(powered?.toys ?? {})
  ).filter(([id, t]) => t.wiring.linked && !bench.placed.find((p) => p.id === id)?.burnt);
}

/** A `move` from the brain: the four levels once, then each toy's own wiring. */
function driveMove(/** @type {{ drive: string, steer: string, ms: number }} */ msg) {
  if (!powered) return;
  const { drive, steer } = msg;
  if (!Object.keys(powered.toys).length) {
    return panels.status(simText(document.documentElement.lang, 'toy.none'));
  }
  const levels = motorLevels(drive, steer);
  for (const [id, t] of movingToys()) {
    const action = toyAction(t.wiring, levels);
    if (action.wheels === 'short' || action.steer === 'short') {
      setBench({ ...bench, placed: bench.placed.map((p) => (p.id === id ? { ...p, burnt: true } : p)) });
      effects.smoke(id);
      panels.status(simText(document.documentElement.lang, 'toy.driverBurnt'));
      continue;
    }
    delete blocks[id];
    world.drive(id, action, msg.ms);
  }
}

/** Stop every toy: the order ran out, the link dropped, or the plug came out. */
function driveStop() {
  for (const [id] of movingToys()) world.drive(id, { wheels: 'coast', steer: 'centred' });
}

/**
 * End the board's life: timers, socket, screen feed, sketch, wand and audio.
 * Every reboot/flash path goes through here, so no old generation keeps
 * writing into the new one.
 */
function stopBoard() {
  boardRuntime?.stop();
  boardRuntime = null;
  sketchRunner?.stop();
  sketchRunner = null;
  bodyAudioLink?.stop();
  bodyAudioLink = null;
  clearInterval(wandTimer);
  wandFeed = null;
  world.onWandLevel(null);
  // A reboot keeps its provisioning wait; powering off cancels it (below).
  serial.waiting(false);
}

/** Stop the board and boot it again, without moving the cable (spec §8.2 reboot). */
function rebootBoard() {
  if (!usb.plugged) return;
  stopBoard();
  void plugIn();
}

/** Invalidate pending starts before stopping so late callbacks cannot restart motion. */
function stopUnsafeSession() {
  plugs++;
  gpioOutputs = {};
  sonar = null;
  startLock.clear();
  driveStop();
  stopBoard();
  provisioning?.cancel();
  provisioning = null;
  offerOnEnd = null;
  offerLocked = false;
  bodyAudio.close();
  panels.closePicker();
  effects.setAlive(false);
  effects.playing([]);
  effects.led('off');
  line = { end: null, lost: false, api: null, fault: null, mic: null, sound: false, state: null, who: null, ending: null };
  const off = evaluateBench({ ...bench, usb: false }).parts;
  world.screens(/** @type {any} */ (off));
  world.imu(/** @type {any} */ (off));
  // A lit GPIO LED must go dark with the session.
  refreshDeviceVisuals();
}

/** A suspended context (no gesture at build time) resumes on the next one. */
let soundGestureArmed = false;
function armSoundGesture() {
  if (soundGestureArmed) return;
  soundGestureArmed = true;
  const once = () => {
    soundGestureArmed = false;
    removeEventListener('pointerdown', once);
    removeEventListener('keydown', once);
    unlockAudio();
  };
  addEventListener('pointerdown', once);
  addEventListener('keydown', once);
}

/** The output AudioContext is unlocked from a real gesture: a drag release or a Demo/Build click. */
function unlockAudio() {
  void bodyAudio.resume().then(() => {
    if (!line.sound) return;
    line.sound = false;
    showLine();
  });
}

/**
 * @param {{ ending?: string | null, pendingFlash?: string | null }} [meta]
 *   `pendingFlash` puts the board in the ROM bootloader instead of booting the
 *   firmware that is already there.
 */
async function plugIn(meta = {}) {
  stopBoard();
  recipeOn = null;
  gpioOutputs = {};
  sonar = null;
  const mine = ++plugs;
  bench = { ...bench, usb: true };
  const merged = evaluateBench(bench, { firmware: firmwareById(bench.board.firmware), ownership: ownershipOf(bench) });
  const outcome = merged.legacy;
  const blocked = blockingBoardPowerFault(bench, merged);
  // What burns is marked now, before anything else is shown, so a reload
  // remembers it; it stays burnt until the user drops it in the bin.
  if (merged.burns.length) {
    bench = { ...bench, placed: bench.placed.map((p) => (merged.burns.includes(p.id) ? { ...p, burnt: true } : p)) };
  }
  setBench(bench);
  powered = outcome;
  powerInterlock.arm(bench, merged);
  for (const key of Object.keys(blocks)) delete blocks[key];
  // When board power is indeterminate, do not present legacy devices as active.
  const visualParts = blocked ? evaluateBench({ ...bench, usb: false }).parts : merged.parts;
  world.screens(/** @type {any} */ (visualParts));
  world.imu(/** @type {any} */ (visualParts));
  world.onPark((id, pose, blocked) => {
    setBench(park(bench, id, { x: pose.x, z: pose.z }, pose.heading));
    if (!blocked || blocks[id] === blocked) return;
    blocks[id] = blocked;
    const key = /** @type {Record<string, string>} */ ({ hit: 'toy.hit', edge: 'toy.edge', taut: 'toy.taut', stuck: 'toy.stuck' })[blocked];
    panels.status(key ? simText(document.documentElement.lang, key) : null);
  });
  // A pad wired to a supply is already driving the moment USB goes in.
  for (const [id, t] of initialDriveActions(bench, merged)) world.drive(id, t.action);
  effects.playing(blocked ? [] : bench.placed
    .filter((p) => /** @type {any} */ (merged.parts[p.id])?.kind === 'speaker' && /** @type {any} */ (merged.parts[p.id]).playing)
    .map((p) => p.id));
  for (const id of merged.burns) effects.smoke(id);
  effects.led(blocked ? 'off' : outcome.esp === 'brownout' ? 'blink' : 'on');
  // After a brown-out the short is the news; a guess about some other wire would mislead.
  const hints = diagnose(bench, { ...outcome, faults: blocked ? [blocked] : merged.faults, burns: merged.burns }, document.documentElement.lang);
  const first = blocked || outcome.esp === 'brownout' ? hints.find((h) => h.kind === 'fault') : hints[0];
  hands.highlightPoints(first?.points ?? []);
  line = { end: null, lost: false, api: null, fault: first?.text ?? null, mic: null, sound: false, state: null, who: null, ending: null };
  showLine();
  if (outcome.esp !== 'ok' || blocked) return;

  // A bench that came alive is watched, not wired: the orbit view shows the
  // robot at an angle beside the bench.
  wiringView = view === 'orbit' ? wiringView : view;
  view = 'orbit';
  peeking = null;
  go(view);

  if (bootMode({ blocked: Boolean(blocked), pendingFlash: meta.pendingFlash }) === 'bootloader') {
    const target = firmwareById(meta.pendingFlash ?? '');
    serial.show(true);
    serial.setFirmware(/** @type {any} */ (target ?? firmwareById('body')));
    serial.append(`esptool: ${target?.image?.label ?? 'firmware'} ready for flashing`);
    return;
  }

  const firmware = firmwareById(bench.board.firmware);
  if (!firmware) {
    panels.status(simText(document.documentElement.lang, 'board.noFirmware'));
    return;
  }
  serial.setFirmware(firmware);
  serial.setSettings(bench.board.settings);
  serial.show(true);
  line.ending = meta.ending ?? null;
  bodyAudioLink?.stop();
  bodyAudioLink = firmware.link ? createBodyAudioLink({
    outcome: /** @type {any} */ (outcome),
    audio: bodyAudio,
    name: `sim-${(bench.board.settings.token || 'bench').slice(0, 8)}`,
    onLevel: (up, down) => effects.levels(up, down),
    onMicBlocked: () => {
      line.mic = simText(document.documentElement.lang, 'audio.micBlocked');
      showLine();
    },
    onMicReady: () => { line.mic = null; showLine(); },
    onNeedsGesture: () => {
      line.sound = true;
      showLine();
      armSoundGesture();
    },
  }) : null;
  boardRuntime = createBoardRuntime({
    board: bench.board,
    bench,
    outcome,
    ownership: ownershipOf(bench),
    initDevices: (ids) => {
      const engineering = evaluateBench(bench, { firmware, ownership: ownershipOf(bench), stimuli: simulationStimuli(), initializing: true }).engineering;
      /** @type {Record<string, 'active'|'init-failed'>} */
      const verdicts = {};
      for (const id of ids) {
        const part = bench.placed.find((p) => p.id === id);
        verdicts[id] = part && deviceInitialized(engineering, part) ? 'active' : 'init-failed';
      }
      return verdicts;
    },
    brainUrl: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/body`,
    audio: bodyAudioLink ?? undefined,
    connect: (opts) => {
      const link = connectBody({
        url: opts.url, token: opts.token, retryOnReject: opts.retryOnReject,
        onWelcome: opts.onWelcome, onMessage: opts.onMessage, onAudio: opts.onAudio,
        onLost: () => { driveStop(); bodyAudioLink?.hush(); opts.onLost?.(); }, onReject: opts.onReject,
      });
      return { close: () => link.close(), send: (msg) => link.send(msg), sendAudio: (pcm) => link.sendAudio(pcm) };
    },
    openScreen: (/** @type {any} */ opts) => openScreenFeed(/** @type {any} */ ({
      url: opts.url,
      token: opts.token,
      model: /** @type {any} */ (screenById(bench.board.settings.screen) ?? screenById('ili9341-ips')),
      onFrame: (/** @type {any} */ img) => world.paintScreens(img),
    })),
    onLine: (text) => {
      serial.append(text);
      if (text.startsWith('welcomed as ')) {
        provisioning?.welcomed();
        line.lost = false;
        line.mic = null;
        line.state = 'connected';
        const name = text.slice('welcomed as '.length);
        line.who = name;
        const needs = activeProject?.needs ?? [];
        if (needs.length) void fetch('/api/characters').then((r) => r.json()).then((list) => {
          const remote = isRemote(bench.board.settings.url, location.origin);
          const character = lookupCharacter(list, name, remote);
          const zh = document.documentElement.lang === 'zh';
          for (const skip of demoSkips(needs, character?.motion ?? 'none', zh ? 'zh' : 'en')) serial.append(skip.text);
        }).catch(() => {});
      } else if (text.startsWith('rejected:')) {
        provisioning?.gaveUp();
        // The brain said no for good; the status line says the same as the console.
        line.fault = text;
      } else if (text.startsWith('lost ')) {
        line.lost = true;
      }
      showLine();
    },
    onLed: (mode) => effects.led(ledPattern(mode)),
    onDevice: (msg) => {
      if (msg.type === 'move') driveMove(msg);
      else if (msg.type === 'stop') driveStop();
      else if (msg.type === 'state') {
        const state = String(msg.state).toUpperCase();
        if (!keepsFault(state)) line.api = null;
        line.state = state.toLowerCase();
        effects.led(ledPattern(state));
        showLine();
      }
      else if (msg.type === 'fault') { line.api = faultText(msg); showLine(); }
      else if (msg.type === 'hush') { bodyAudioLink?.hush(); }
    },
  });
  boardRuntime.start();
  if (firmware.link) void maybeProvision(mine);
  // The firmware's own IMU check is the gate: no MPU-6050 awake, no shake sent.
  const imu = bench.placed.find((part) => part.part === 'mpu6050');
  if (firmware.link && imu && /** @type {any} */ (outcome.parts)?.[imu.id]?.awake === true) {
    wandFeed = createWandFeed({ detector: createShakeDetector(), send: () => boardRuntime?.shake(), now: () => performance.now() });
    world.onWandLevel((_id, level) => wandFeed?.level(level));
    clearInterval(wandTimer);
    wandTimer = setInterval(() => wandFeed?.tick(), 50);
  }
  if (!firmware.link) {
    sketchRunner?.stop();
    sketchRunner = createSketchRunner({
      firmware,
      ctx: () => {
        const deviceStates = boardRuntime?.deviceStates() ?? {};
        const evaluation = evaluateBench(bench, { firmware, ownership: ownershipOf(bench), deviceStates, gpioOutputs, stimuli: simulationStimuli() }).engineering;
        return createSketchContext({
          bench, evaluation, deviceStates, runtime,
          onPin: (pin, level) => { gpioOutputs[pin] = level; },
          onMeasure: (_id, on) => { sonar = { measure: on, distanceCm: 100 }; },
        });
      },
      render: refreshDeviceVisuals,
    });
    sketchRunner.start();
  }
}

async function flashFirmwareNow(/** @type {string} */ id) {
  if (!canFlash(bench, bench.board).ok) { panels.status(simText(document.documentElement.lang, 'board.cannotFlash')); return; }
  const before = bench.board;
  const result = await runFlash(before, id, { isCurrent: () => bench.board === before && bench.usb });
  provisioning?.cancel();
  provisioning = null;
  if (!result.ok) {
    panels.status(simText(document.documentElement.lang, 'board.flashFailed', { firmware: id, reason: result.reason ?? 'unknown' }));
    return;
  }
  bench = { ...bench, board: result.board };
  setBench(bench);
  const firmware = firmwareById(id);
  if (firmware) serial.setFirmware(firmware);
  if (usb.plugged) plugIn({ ending: line.ending });
}

/**
 * The single ready character this brain could start, or a list to choose from
 * when more than one could be meant.
 * @returns {Promise<{ token?: string, list?: { id: string, name: string, ready?: boolean, online?: boolean }[] }>}
 */
async function tokenCandidate() {
  try {
    const ready = tokenCandidates(await (await fetch('/api/characters')).json());
    if (ready.length !== 1) return { list: ready };
    const detail = await (await fetch(`/api/characters/${encodeURIComponent(ready[0].id)}`)).json();
    return detail?.token ? { token: detail.token, list: ready } : { list: ready };
  } catch {
    return {};
  }
}

/**
 * A plan compares what it needs with the board and types the missing settings
 * into the serial console itself (spec §8.2). Build types them when one
 * character is unambiguous; Demo waits for the user. A remote brain gets no
 * local helper: its token can only be typed by hand.
 * @param {number} mine the plug this boot belongs to
 */
async function maybeProvision(mine) {
  const plan = /** @type {import('./plan.js').Plan | null} */ (activeProject);
  if (!plan || plan.connection !== 'body') return;
  if (provisionedFor === plan.id) return;
  provisionedFor = plan.id;
  const lang = document.documentElement.lang;
  const remote = isRemote(bench.board.settings.url, location.origin);
  serial.show(true);
  serial.setCharacterHelper(!remote);
  if (remote) {
    const steps = provisionSteps(plan, bench.board.settings);
    if (steps.commands.length) panels.status(simText(lang, 'board.provisionRemote'));
    return;
  }
  let token = bench.board.settings.token;
  /** @type {{ id: string, name: string }[] | null} */ let list = null;
  if (!token) {
    const candidate = await tokenCandidate();
    list = (candidate.list ?? []).map((c) => ({ id: c.id, name: c.name }));
    token = candidate.token ?? '';
  }
  if (mine !== plugs) return;
  if (list) serial.setCharacters(list);
  const mismatch = screenMismatch(plan, bench.board.settings);
  const missing = provisionSteps(plan, bench.board.settings, { token, replaceScreen: false }).missing;
  if (!missing.length && !mismatch) return;

  /** @param {boolean} replaceScreen */
  const begin = (replaceScreen) => {
    if (mine !== plugs) return;
    offerLocked = false;
    const steps = provisionSteps(plan, bench.board.settings, { token, replaceScreen });
    if (!steps.commands.length) {
      panels.status(simText(lang, 'board.provisionSkipped'));
      return;
    }
    provisioning = createProvisioning({
      commands: steps.commands,
      panel: serial,
      reboot: () => rebootBoard(),
      onDone: (result) => {
        serial.waiting(false);
        if (result === 'still-retrying') panels.status(simText(lang, 'board.provisionDone'));
        else if (result === 'skipped') panels.status(simText(lang, 'board.provisionSkipped'));
      },
    });
    provisioning.start();
    serial.waiting(true, () => provisioning?.cancel());
  };

  if (mismatch) {
    const screen = /** @type {string} */ (provisionSteps(plan, bench.board.settings, { token }).screen);
    const ask = () => {
      offerLocked = true;
      panels.status(simText(lang, 'board.provisionMismatch', { current: bench.board.settings.screen, wanted: screen }), {
        actions: [
          { label: simText(lang, 'board.screenReplace'), run: () => begin(true) },
          {
            label: simText(lang, 'board.screenKeep'),
            run: () => {
              offerLocked = false;
              if (!missing.length) panels.status(simText(lang, 'board.screenKept', { current: bench.board.settings.screen, wanted: screen }));
              else begin(false);
            },
          },
        ],
      });
    };
    if (activeProject && (planMode === 'watch' || planMode === 'step') && running) offerOnEnd = ask;
    else ask();
    return;
  }

  if (!token) {
    panels.status(simText(lang, 'board.provisionManual'));
    return;
  }

  const what = missing.map((need) => (need === 'token' ? 'token' : 'screen')).join(', ');
  if (planMode === 'build') {
    begin(true);
    return;
  }
  const offer = () => {
    offerLocked = true;
    panels.status(simText(lang, 'board.provisionNeeded', { what }), {
      actions: [
        { label: simText(lang, 'board.provisionType'), run: () => begin(true) },
        {
          label: simText(lang, 'board.provisionSkip'),
          run: () => { offerLocked = false; panels.status(simText(lang, 'board.provisionSkipped')); },
        },
      ],
    });
  };
  // Demo's own steps keep writing the status line; the offer waits its turn.
  if (activeProject && (planMode === 'watch' || planMode === 'step') && running) offerOnEnd = offer;
  else offer();
}

function unplug() {
  hands.highlightPoints([]);
  gpioOutputs = {};
  sonar = null;
  plugs++;
  startLock.clear();
  powerInterlock.reset();
  driveStop();
  powered = null;
  stopBoard();
  provisioning?.cancel();
  provisioning = null;
  offerOnEnd = null;
  offerLocked = false;
  bodyAudio.close();
  serial.show(false);
  panels.closePicker();
  effects.setAlive(false);
  effects.playing([]);
  effects.led('off');
  line = { end: null, lost: false, api: null, fault: null, mic: null, sound: false, state: null, who: null, ending: null };
  showLine();
  bench = { ...bench, usb: false };
  setBench(bench);
  // Pulling the plug turns the panels off; the last look is not kept.
  const { parts } = evaluateBench(bench);
  world.screens(/** @type {any} */ (parts));
  world.imu(/** @type {any} */ (parts));
  if (view === 'orbit' && wiringView !== 'orbit') {
    view = wiringView;
    go(view);
  }
}

function reset() {
  const zh = document.documentElement.lang === 'zh';
  const ok = window.confirm(zh
    ? '重置工作台会换一块新板：接线、固件、ssid/pass/token/url/屏幕、校准和损坏都会被清除。继续？'
    : 'Reset bench replaces the board: wiring, firmware, ssid/pass/token/url/screen, calibration and any damage are cleared. Continue?');
  if (!ok) return;
  activeProject = null;
  panels.selectProject('');
  hands.highlightGuidance([]);
  hands.clearSelection();
  runner?.stop();
  if (usb.plugged) {
    usb.pullOut();
    unplug();
  }
  setBench(emptyBench());
  try { localStorage.removeItem(BENCH_KEY); } catch { /* nothing saved to clear */ }
}

/**
 * Build a working bench on the table, by hand-off to the animated runner. The
 * user's own bench is kept first (unless it holds no work, or one is already
 * kept from an earlier run) so Back to my bench can bring it back. A live
 * session is ended first: the run starts from an unpowered table.
 * @param {string} recipeId
 * @param {string | undefined} screenId
 * @param {'watch' | 'step'} mode
 * @param {{ onSay?(text: string): void, onEnd?(): void }} [hooks] where the
 *   steps' words go instead of the status line, and when the run is over
 * @param {boolean} [wand] also wire the tarot wand
 * @returns {{ next(): void, finish(): void, skip(): void, stop(): void, speed(x: number): void } | null}
 */
export function startRun(recipeId, screenId, mode, hooks = {}, wand = false, speed = 1) {
  const recipe = RECIPES.find((r) => r.id === recipeId);
  if (!recipe || running) return null;
  // Remembered only when a run actually starts: opening the panel is not a preference.
  write(SPEED_KEY, String(speedFactor(speed)));
  // Before anything unplugs: the unplug redraws the status line, which must not offer the way back now.
  running = true;
  planMode = mode === 'step' ? 'step' : 'watch';
  provisionedFor = null;
  provisioning = null;
  offerLocked = false;
  panels.status(null);
  if (usb.plugged) {
    usb.pullOut();
    unplug();
  }
  const hasWork = bench.boards.length > 0 || bench.wires.length > 0 || bench.placed.length > 1;
  if (hasWork && !keptBench(store())) keepBench(store(), bench);
  recipeOn = { need: recipe.needs, ending: recipe.ending };
  activeProject = projectById(recipe.id, { screenId, wand });
  panels.selectProject(recipe.id);
  const steps = recipeSteps(recipe.id, screenId, wand);
  setBench(startBench(bench));
  // Frame the camera for the bench the run will end with, so nothing lands off screen.
  world.view(view, steps.reduce(applyStep, bench));
  const controls = runRecipe({
    steps,
    mode,
    speed,
    getBench: () => bench,
    setBench,
    world,
    usb,
    flash: flashFirmwareNow,
    hands,
    say: (text) => (hooks.onSay ? hooks.onSay(text) : panels.status(text)),
    onDone: () => {
      hooks.onEnd?.();
      running = false;
      recipeOn = null;
      runner = null;
      // Plugged in, the connection has its own news to show; do not talk over it.
      if (usb.plugged) offerOnEnd?.(); else showLine();
      offerOnEnd = null;
    },
  });
  runner = controls;
  return controls;
}
/**
 * Build a plan onto a fresh bench, keeping the previous one for Back to my bench.
 * Project plans have no body demo, so this returns inert run controls.
 * @param {string} planId
 * @param {'build'|'watch'|'step'} [mode]
 * @param {{ onSay?(text: string): void, onEnd?(): void }} [hooks]
 */
export function startPlan(planId, options = {}, mode = 'build', hooks = {}, speed = 1) {
  const plan = planById(planId, options);
  if (!plan || running) return null;
  running = true;
  planMode = mode === 'build' ? 'build' : mode === 'step' ? 'step' : 'watch';
  provisionedFor = null;
  provisioning = null;
  offerLocked = false;
  panels.status(null);
  if (usb.plugged) {
    usb.pullOut();
    unplug();
  }
  const hasWork = bench.boards.length > 0 || bench.wires.length > 0 || bench.placed.length > 1;
  if (hasWork && !keptBench(store())) keepBench(store(), bench);
  const steps = planSteps(plan);
  const demoSteps = plan.id === 'tarot'
    ? [...steps, /** @type {import('./recipes.js').Step} */ ({ kind: 'usb', say: 'Plug in USB and shake the wand.' })]
    : steps;
  recipeOn = plan.legacy
    ? { need: /** @type {any} */ (plan.needs), ending: /** @type {any} */ (plan.ending) }
    : plan.id === 'tarot' ? { need: 'tarot', ending: 'Shake the wand' } : null;
  activeProject = plan;
  panels.selectProject(plan.id);
  setBench(startBench(bench));
  world.view(view, steps.reduce(applyStep, bench));
  if (mode === 'build') {
    let built = startBench(bench);
    for (const step of steps) if (step.kind !== 'usb' && step.kind !== 'flash') built = applyStep(built, step);
    setBench(built);
    world.view(view, built);
    const firmwareId = plan.firmware;
    if (firmwareId) void (async () => {
      await usb.insert({ instant: true, pendingFlash: firmwareId });
      await flashFirmwareNow(firmwareId);
    })();
    running = false;
    runner = null;
    const lang = document.documentElement.lang === 'zh' ? 'zh' : 'en';
    const projectLabel = simText(lang, `project.${plan.id}`);
    if (!offerBack()) panels.status(simText(lang, 'project.built', { name: projectLabel === `project.${plan.id}` ? plan.name : projectLabel }));
    hooks.onEnd?.();
    return { next() {}, finish() {}, skip() {}, stop() {}, speed() {} };
  }
  const controls = runRecipe({
    steps: demoSteps,
    mode,
    speed,
    getBench: () => bench,
    setBench,
    world,
    usb,
    flash: flashFirmwareNow,
    hands,
    say: (text) => (hooks.onSay ? hooks.onSay(text) : panels.status(text)),
    onDone: () => {
      hooks.onEnd?.();
      running = false;
      recipeOn = null;
      runner = null;
      if (usb.plugged) {
        offerOnEnd?.();
      } else {
        const kept = offerBack();
        if (!kept) {
          const text = previewText(plan.id, document.documentElement.lang);
          if (text) panels.status(text);
        }
      }
      offerOnEnd = null;
    },
  });
  runner = controls;
  return controls;
}

// A bench kept before a reload is still there to go back to.
showLine();

// Lab requests are applied only after the workbench is fully initialized.
try {
  const handoff = consumeLabHandoff(localStorage, bench, () => window.confirm(simText(document.documentElement.lang, 'lab.replaceConfirm')));
  if (handoff.kind === 'applied') {
    activeProject = handoff.projectId ? projectById(handoff.projectId) : null;
    setBench(handoff.bench);
    if (activeProject) panels.openProject(activeProject.id);
  } else if (handoff.kind === 'error') panels.status(simText(document.documentElement.lang, 'lab.handoffError'));
} catch { /* Unavailable storage leaves the current bench unchanged. */ }
