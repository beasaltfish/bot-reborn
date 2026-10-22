// The wiring simulator's boot: read the saved bench, draw it, and the one
// control the page has so far, the view toggle (hold Space to peek at the
// other wiring view without changing the choice).

import { load } from './bench.js';
import { createWorld } from './scene/world.js';

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
const toggle = /** @type {HTMLButtonElement} */ (document.getElementById('view'));
const world = createWorld(canvas);
world.show(load(read(BENCH_KEY)));

// #view=top opens in that view without saving it: handy for a screenshot.
const asked = new URLSearchParams(location.hash.slice(1)).get('view');
const saved = read(VIEW_KEY);
/** @type {ViewMode} */
let view = isView(asked) ? asked : isView(saved) ? saved : 'tilted';
/** @type {ViewMode | null} */
let peeking = null;

/** @param {ViewMode} v */
function go(v) {
  world.view(v);
  toggle.textContent = VIEW_NAMES[v];
}
go(view);

toggle.addEventListener('click', () => {
  view = VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length];
  write(VIEW_KEY, view);
  peeking = null;
  go(view);
});

/** @param {KeyboardEvent} e */
const isSpace = (e) => e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement);

addEventListener('keydown', (e) => {
  if (!isSpace(e)) return;
  // Space would also press a focused button; this key belongs to the bench.
  e.preventDefault();
  if (e.repeat || peeking) return;
  peeking = view === 'top' ? 'tilted' : 'top';
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
