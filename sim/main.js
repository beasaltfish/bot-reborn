// The wiring simulator's boot: read the saved bench, draw it, give it hands
// (every change is saved as it is made), the three views side by side (hold
// Space to peek at the other flat view without changing the choice), the panels, and the
// USB cable that powers the bench up.
//
// Power-on is a moment (spec §7): nothing reacts while wiring. When the plug
// goes in, the circuit is judged once, what burns burns, and the bench either
// comes alive as a body or shows why not. Pulling the plug ends it.

import { emptyBench, load, serialize, addPart, addBoard } from './bench.js';
import { powerOn } from './power.js';
import { PARTS } from './parts.js';
import { spotForNew } from './snap.js';
import { targetFor } from './target.js';
import { screenById } from '../core/screens.js';
import { diagnose, nextHint } from './diagnose.js';
import { characterChoices, chooseCharacter, chooseLine, startBody, faultText, adminLink, keepsFault } from './body.js';
import { keptBench, keepBench, dropKept } from './keep.js';
import { RECIPES, startBench, recipeSteps, applyStep } from './recipes.js';
import { runRecipe } from './scene/autowire.js';
import { createPanels } from './panels.js';
import { createWorld } from './scene/world.js';
import { attachInteraction, beginCarry } from './scene/interact.js';
import { attachUsb } from './scene/usb.js';
import { createEffects } from './scene/effects.js';

/** @typedef {import('./scene/world.js').ViewMode} ViewMode */

const BENCH_KEY = 'botreborn.sim.bench';
const VIEW_KEY = 'botreborn.sim.view';

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

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('bench'));
const viewButtons = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('#views button')]);
const peekHint = /** @type {HTMLElement} */ (document.getElementById('peek'));
const world = createWorld(canvas);
const effects = createEffects(world);
// A page that was closed with the cable in is not powered when it opens again.
let bench = { ...load(read(BENCH_KEY)), usb: false };
const panels = createPanels({
  hint: () => (bench.placed.some((p) => p.burnt)
    ? 'A part burnt out; drag it to the bin and take a new one from Parts.'
    : nextHint(bench)?.text ?? 'Looks complete — plug in USB.'),
  reset,
  follow: effects.follow,
  add: (part) => addFromBin(part),
  carry: (part, e) => beginCarry(/** @type {any} */ (part), e),
  start: (recipeId, screenId, mode, hooks) => startRun(recipeId, screenId, mode, hooks),
});

/** @param {import('./bench.js').Bench} b */
function setBench(b) {
  bench = b;
  write(BENCH_KEY, serialize(b));
  world.show(b);
  panels.links(targetFor(b), b.placed.filter((p) => p.part.startsWith('screen-')).map((p) => p.id));
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

const hands = attachInteraction(world, () => bench, setBench, { say: (text) => panels.status(text) });
const usb = attachUsb(world, { onPlug: (on) => (on ? plugIn(recipeOn) : unplug()), locked: () => starting, bench: () => bench });

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

/** @param {KeyboardEvent} e */
const isSpace = (e) => e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement);

addEventListener('keydown', (e) => {
  if (!isSpace(e)) return;
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
  if (!isSpace(e)) return;
  e.preventDefault();
  unpeek();
});
// Letting go of Space in another window never reaches us.
addEventListener('blur', unpeek);

// ---- Power --------------------------------------------------------------

/** The running body, if the bench is one. */
/** @type {{ stop(): void } | null} */
let session = null;
/** startBody has been called and not yet returned: the plug stays where it is. */
let starting = false;
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
 * @type {{ need: 'any' | 'pet', ending: string } | null}
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

/**
 * @param {{ need: 'any' | 'pet', ending: string } | null} [recipe] set when
 *   a recipe run plugged in: the character is then chosen for it, not picked by hand
 */
async function plugIn(recipe = null) {
  recipeOn = null;
  const mine = ++plugs;
  bench = { ...bench, usb: true };
  const outcome = powerOn(bench);
  // What burns is marked now, before anything else is shown, so a reload
  // remembers it; it stays burnt until the user drops it in the bin.
  if (outcome.burns.length) {
    bench = { ...bench, placed: bench.placed.map((p) => (outcome.burns.includes(p.id) ? { ...p, burnt: true } : p)) };
  }
  setBench(bench);
  world.screens(outcome.parts);
  effects.playing(bench.placed
    .filter((p) => /** @type {any} */ (outcome.parts[p.id])?.kind === 'speaker' && /** @type {any} */ (outcome.parts[p.id]).playing)
    .map((p) => p.id));
  for (const id of outcome.burns) effects.smoke(id);
  effects.led(outcome.esp === 'brownout' ? 'blink' : 'on');
  // After a brown-out the short is the news; a guess about some other wire would mislead.
  const hints = diagnose(bench, outcome);
  const first = outcome.esp === 'brownout' ? hints.find((h) => h.kind === 'fault') : hints[0];
  line = { end: null, lost: false, api: null, fault: first?.text ?? null, state: null, who: null, ending: null };
  showLine();
  if (outcome.esp !== 'ok') return;

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
  starting = true;
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
      // The brain names its states in capitals (LISTENING); the line reads as a sentence.
      onState: (s) => {
        if (!live()) return;
        // A fault stays up until the user speaks again: the brain voices its own apology (SPEAKING) right after one.
        if (!keepsFault(s)) line.api = null;
        line.state = s.toLowerCase(); line.lost = false; showLine();
      },
      onFault: (msg) => { if (!live()) return; apiFor = id; line.api = faultText(msg); showLine(); },
      onLevel: (up, down) => { if (live()) effects.levels(up, down); },
      onEnd: (msg) => { if (!live()) return; line.end = msg; effects.setAlive(false); showLine(); },
      onLost: () => { if (!live()) return; line.lost = true; showLine(); },
      onWelcome: () => { if (!live()) return; line.lost = false; line.ending = ending; if (line.state === 'connecting…') line.state = 'connected'; showLine(); },
      // The bench's screens connect the way the firmware does, with their own
      // size; a character that is not a pet leaves them black (spec §5.5).
      screen: outcome.screenModel
        ? { model: /** @type {any} */ (screenById(outcome.screenModel)), onFrame: (img) => world.paintScreens(img) }
        : undefined,
    });
    // Reset bench can pull the plug while this was starting.
    if (live()) session = started;
    else started.stop();
  } finally {
    starting = false;
  }
}

function unplug() {
  plugs++;
  session?.stop();
  session = null;
  panels.closePicker();
  effects.setAlive(false);
  effects.playing([]);
  effects.led('off');
  line = { end: null, lost: false, api: null, fault: null, state: null, who: null, ending: null };
  showLine();
  bench = { ...bench, usb: false };
  setBench(bench);
  // Pulling the plug turns the panels off; the last look is not kept.
  world.screens(powerOn(bench).parts);
  if (view === 'orbit' && wiringView !== 'orbit') {
    view = wiringView;
    go(view);
  }
}

function reset() {
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
 * @returns {{ next(): void, finish(): void, skip(): void, stop(): void } | null}
 */
export function startRun(recipeId, screenId, mode, hooks = {}) {
  const recipe = RECIPES.find((r) => r.id === recipeId);
  if (!recipe || running) return null;
  if (usb.plugged) {
    usb.pullOut();
    unplug();
  }
  const hasWork = bench.boards.length > 0 || bench.wires.length > 0 || bench.placed.length > 1;
  if (hasWork && !keptBench(store())) keepBench(store(), bench);
  running = true;
  recipeOn = { need: recipe.needs, ending: recipe.ending };
  const steps = recipeSteps(recipe.id, screenId);
  setBench(startBench(bench));
  // Frame the camera for the bench the run will end with, so nothing lands off screen.
  world.view(view, steps.reduce(applyStep, bench));
  const controls = runRecipe({
    steps,
    mode,
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
