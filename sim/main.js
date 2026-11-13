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
import { formatReadings } from './devices/ssd1306.js';
import { createRuntimePanel } from './ui/device-runtime-panel.js';
import { planById, planFromProject } from './plan.js';
import { nextPlanHint } from './guidance.js';
import { defaultStimuli, setStimulus } from './stimuli.js';
import { motorLevels, toyAction } from './car.js';
import { createWandFeed } from './wand-feed.js';
import { createShakeDetector } from '../core/shake-detector.js';
import { PARTS } from './parts.js';
import { spotForNew } from './snap.js';
import { targetFor } from './target.js';
import { screenById } from '../core/screens.js';
import { diagnose } from './diagnose.js';
import { liveDiagnosis } from './live-diagnosis.js';
import { isViewPeekShortcut } from './view-shortcut.js';
import { characterChoices, chooseCharacter, chooseLine, startBody, faultText, adminLink, keepsFault } from './body.js';
import { keptBench, keepBench, dropKept } from './keep.js';
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
/** @type {import('./projects.js').Project | null} */
let activeProject = null;
const panels = createPanels({
  hint: (projectId) => (bench.placed.some((p) => p.burnt)
    ? document.documentElement.lang === 'zh' ? simText('zh', 'hint.burnt') : 'A part burnt out; drag it to the bin and take a new one from Parts.'
    : projectId
      ? nextPlanHint(bench, planById(projectId), document.documentElement.lang)?.text ?? (document.documentElement.lang === 'zh' ? simText('zh', 'hint.ready') : 'Looks complete — plug in USB.')
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
    if (!deviceByPart(part)) return panels.status('Unknown device; select one from the catalogue.');
    location.href = `./lab.html?part=${encodeURIComponent(part)}`;
  },
  projectState: id => {
    const plan = activeProject?.id === id ? planFromProject(activeProject) : planById(id);
    const selection = describeSelection(bench, hands.selection(), document.documentElement.lang);
    if (plan) return { mode: 'guided', project: plan, progress: connectionProgress(bench, plan), selection, diagnoses: [] };
    // Independent DC supplies can energize an LED circuit without USB.
    const result = bench.usb || bench.placed.some(part => part.part === 'dc-source' && !part.burnt) ? evaluateBench(bench) : null;
    const diagnoses = result ? rankedDiagnoses(bench, result, document.documentElement.lang) : [];
    return { mode: 'free', project: null, progress: [], selection, diagnoses };
  },
  focusProject: points => {
    hands.highlightGuidance(points);
    const panel = document.getElementById('project-panel');
    const left = panel && !panel.hidden ? Math.max(0, panel.getBoundingClientRect().right - canvas.getBoundingClientRect().left) : 0;
    void world.focusPoints(points, { left });
  },
  clearProjectFocus: () => hands.highlightGuidance([]),
  start: (recipeId, screenId, mode, hooks, wand, speed) => startRun(recipeId, screenId, mode, hooks, wand, speed),
  speed: speedFactor(Number(read(SPEED_KEY))),
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
/** @param {import('./selection.js').Selection} selection */
function showContext(selection) {
  if (!selection || selection.kind === 'part') { context.hide(); return; }
  const info = describeSelection(bench, selection, document.documentElement.lang);
  const color = selection.kind === 'wire' ? bench.wires.find(w => w.id === selection.id)?.color : undefined;
  context.show({ selection, info, color });
}

/** The stimuli the bench and its runtime controls currently request. */
function simulationStimuli() {
  return { ...environment, buttons: runtime.buttons, servo: runtime.servo, motor: runtime.motor, strip: runtime.strip, displays: runtime.display };
}

/** Push evaluated device state (OLED frames, servo, motor, strip) into the scene. */
function refreshDeviceVisuals() {
  const stimuli = simulationStimuli();
  let engineering = evaluateBench(bench, { stimuli }).engineering;
  const readings = Object.values(engineering.bme280 ?? {}).find(state => state?.telemetry)?.telemetry;
  if (readings) {
    const displays = { ...(stimuli.displays ?? {}) };
    let added = false;
    for (const id of Object.keys(engineering.display ?? {})) if (!displays[id]) { displays[id] = { lines: formatReadings(readings).lines }; added = true; }
    if (added) engineering = evaluateBench(bench, { stimuli: { ...stimuli, displays } }).engineering;
  }
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
    const sensor = selected?.part === 'bme280-i2c' ? evaluateBench(bench, { stimuli: environment }).engineering.bme280[openPart] : undefined;
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
    const evaluated = evaluateBench(bench);
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
  if (result.burns.length) panels.status('LED current exceeded its rating; replace the burnt LED and check the resistance or current limit.');
  panels.links(targetFor(bench), bench.placed.filter((p) => p.part.startsWith('screen-')).map((p) => p.id));
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
      state: evaluateBench(bench, { stimuli: environment }).engineering.bme280[id], environment,
      change: (/** @type {string} */ key, /** @type {number} */ value) => {
        environment = setStimulus(environment, key, value);
        const current = bench.placed.find(item => item.id === id);
        const state = evaluateBench(bench, { stimuli: environment }).engineering.bme280[id];
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
const usb = attachUsb(world, { onPlug: (on) => (on ? plugIn(recipeOn) : unplug()), locked: () => startLock.locked(), bench: () => bench });

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

/** The running body, if the bench is one. */
/** @type {{ stop(): void } | null} */
let session = null;
/** @type {AbortController | null} */
let pendingStart = null;
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
 * session ended, a dropped link, what is wrong with the wiring, what the robot is doing.
 * `ending` is what to say to try a bench the simulator built, kept after the state.
 * @type {{ end: string | null, lost: boolean, api: string | null, fault: string | null, state: string | null, who: string | null, ending: string | null }}
 */
let line = { end: null, lost: false, api: null, fault: null, state: null, who: null, ending: null };
function showLine() {
  if (line.end) return panels.status(line.end);
  if (line.lost) return panels.status('Reconnecting…');
  if (line.api) return panels.status(line.api, { href: adminLink(apiFor), label: 'open' });
  if (line.fault) return panels.status(line.fault);
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
/**
 * What the recipe now being played needs of the character and what to say to
 * try the result. Read once by the plug-in the run itself causes, so a plug
 * the user pushes in later chooses a character by hand again.
 * @type {{ need: 'any' | 'pet' | 'car', ending: string } | null}
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
  panels.status('This bench was built for you.', {
    actions: [
      { label: 'Back to my bench', run: backToMine },
      { label: 'Keep this one', run: keepThisOne },
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
  setBench(mine);
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
    return panels.status('No toy robot on the bench — add one from Parts');
  }
  const levels = motorLevels(drive, steer);
  for (const [id, t] of movingToys()) {
    const action = toyAction(t.wiring, levels);
    if (action.wheels === 'short' || action.steer === 'short') {
      setBench({ ...bench, placed: bench.placed.map((p) => (p.id === id ? { ...p, burnt: true } : p)) });
      effects.smoke(id);
      panels.status('A driver on the toy shorted and burnt — drag it to the bin for a fresh one');
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

/** Invalidate pending starts before stopping so late callbacks cannot restart motion. */
function stopUnsafeSession() {
  plugs++;
  pendingStart?.abort();
  pendingStart = null;
  startLock.clear();
  driveStop();
  const old = session;
  session = null;
  old?.stop();
  clearInterval(wandTimer);
  wandFeed = null;
  world.onWandLevel(null);
  panels.closePicker();
  effects.setAlive(false);
  effects.playing([]);
  effects.led('off');
  line = { end: null, lost: false, api: null, fault: null, state: null, who: null, ending: null };
  const off = evaluateBench({ ...bench, usb: false }).parts;
  world.screens(/** @type {any} */ (off));
  world.imu(/** @type {any} */ (off));
}

/**
 * @param {{ need: 'any' | 'pet' | 'car', ending: string } | null} [recipe] set when
 *   a recipe run plugged in: the character is then chosen for it, not picked by hand
 */
async function plugIn(recipe = null) {
  recipeOn = null;
  const mine = ++plugs;
  bench = { ...bench, usb: true };
  const merged = evaluateBench(bench);
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
    panels.status(/** @type {Record<string, string>} */ ({
      hit: 'It\'s up against something — say "back up"',
      edge: 'That\'s the edge of the mat',
      taut: 'The wires are taut — the real build straps the board to the robot',
      stuck: 'Move the toy off what it is standing on first',
    })[blocked] ?? null);
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
  line = { end: null, lost: false, api: null, fault: first?.text ?? null, state: null, who: null, ending: null };
  showLine();
  if (outcome.esp !== 'ok' || blocked) return;

  // A bench that came alive is watched, not wired: the orbit view shows the
  // robot at an angle beside the bench. It used to happen only when a
  // character connected, so a run with no character to connect to stayed flat.
  wiringView = view === 'orbit' ? wiringView : view;
  view = 'orbit';
  peeking = null;
  go(view);

  /** @type {{ id: string, name: string, ready: boolean, online: boolean, motion: string | null }[]} */
  let list;
  try {
    const res = await fetch('/api/characters');
    if (!res.ok) throw new Error(String(res.status));
    list = await res.json();
  } catch {
    if (mine !== plugs) return;
    line.end = 'Could not reach the brain — is it running?';
    return showLine();
  }
  if (mine !== plugs) return;
  if (!list.length) {
    return panels.status('No characters on this brain yet —', { href: '/', label: 'set one up on the admin page' });
  }
  const ending = recipe?.ending ?? null;
  const pickFrom = (/** @type {ReturnType<typeof characterChoices>} */ choices) => panels.pick(choices, {
    pick: (id, name) => connect(mine, id, name, outcome, ending),
    cancel: () => { usb.pullOut(); unplug(); },
  });
  if (!recipe) return pickFrom(characterChoices(list));
  // A recipe knows what it needs, so it does not ask when only one character fits.
  const chosen = chooseCharacter(list, recipe.need);
  switch (chosen.kind) {
    case 'connect': return connect(mine, chosen.id, chosen.name, outcome, ending);
    case 'pick': return pickFrom(chosen.choices);
    default: {
      const l = chooseLine(chosen, recipe.need);
      if (l) panels.status(l.text, l.link);
    }
  }
}

/**
 * @param {number} mine
 * @param {string} id
 * @param {string} name
 * @param {import('./power.js').Outcome} outcome
 * @param {string | null} [ending] what to say to try the bench, when a recipe built it
 */
async function connect(mine, id, name, outcome, ending = null) {
  if (mine !== plugs) return;
  startLock.begin(mine);
  const abort = new AbortController();
  pendingStart = abort;
  line.who = name;
  line.state = 'connecting…';
  showLine();
  wiringView = view === 'orbit' ? wiringView : view;
  view = 'orbit';
  peeking = null;
  go(view);
  effects.setAlive(true);
  // Every callback checks it still belongs to the current plug-in: a session
  // unplugged while starting (Reset bench during the mic prompt) can still
  // end, or report state, before its late stop() runs.
  const live = () => mine === plugs;
  try {
    const started = await startBody({
      id,
      outcome,
      isCurrent: live,
      signal: abort.signal,
      // The brain names its states in capitals (LISTENING); the line reads as a sentence.
      onState: (s) => {
        if (!live()) return;
        // A fault stays up until the user speaks again: the brain voices its own apology (SPEAKING) right after one.
        if (!keepsFault(s)) line.api = null;
        line.state = s.toLowerCase(); line.lost = false; showLine();
      },
      onFault: (msg) => { if (!live()) return; apiFor = id; line.api = faultText(msg); showLine(); },
      onLevel: (up, down) => { if (live()) effects.levels(up, down); },
      // A stale session must not stop the toys of the one that replaced it.
      onEnd: (msg) => { if (!live()) return; driveStop(); line.end = msg; effects.setAlive(false); showLine(); },
      onLost: () => { if (!live()) return; driveStop(); line.lost = true; showLine(); },
      onMove: (msg) => { if (live()) driveMove(msg); },
      onStop: () => { if (live()) driveStop(); },
      onWelcome: () => { if (!live()) return; line.lost = false; line.ending = ending; if (line.state === 'connecting…') line.state = 'connected'; showLine(); },
      // The bench's screens connect the way the firmware does, with their own
      // size; a character that is not a pet leaves them black (spec §5.5).
      screen: outcome.screenModel
        ? { model: /** @type {any} */ (screenById(outcome.screenModel)), onFrame: (img) => { if (live()) world.paintScreens(img); } }
        : undefined,
    });
    // Reset bench can pull the plug while this was starting.
    if (live()) {
      session = started;
      wandFeed = createWandFeed({ detector: createShakeDetector(), send: () => started.sendShake(), now: () => performance.now() });
      world.onWandLevel((_id, level) => wandFeed?.level(level));
      clearInterval(wandTimer);
      wandTimer = setInterval(() => wandFeed?.tick(), 50);
    } else started.stop();
  } finally {
    if (pendingStart === abort) pendingStart = null;
    startLock.release(mine);
  }
}

function unplug() {
  hands.highlightPoints([]);
  plugs++;
  pendingStart?.abort();
  pendingStart = null;
  startLock.clear();
  powerInterlock.reset();
  driveStop();
  powered = null;
  session?.stop();
  session = null;
  clearInterval(wandTimer);
  wandFeed = null;
  world.onWandLevel(null);
  panels.closePicker();
  effects.setAlive(false);
  effects.playing([]);
  effects.led('off');
  line = { end: null, lost: false, api: null, fault: null, state: null, who: null, ending: null };
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
    hands,
    say: (text) => (hooks.onSay ? hooks.onSay(text) : panels.status(text)),
    onDone: () => {
      hooks.onEnd?.();
      running = false;
      recipeOn = null;
      runner = null;
      // Plugged in, the connection has its own news to show; do not talk over it.
      if (!usb.plugged) showLine();
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
