// The sheet behind the gear: settings, and nothing else.
//
// It used to be the onboarding checklist, and that stopped being its job the
// day the robot started showing which parts it had not been given. Three
// dashed arcs and a plug say "what is still missing" better than three lines
// of text, and the two together only said it twice. What is behind a gear now
// is what a gear has always been for: the things you go looking for.
//
// Everything here is a door or a switch. Nothing on this sheet is part of
// getting started — that path is the robot and the one button — so nothing
// here is ordered, numbered, or ticked.

import { t, KEYWORDS } from './strings.js';
import { STICKY } from './config.js';

const $ = (/** @type {string} */ id) =>
  /** @type {HTMLElement} */ (document.getElementById(id));

/**
 * The instrument page. English-only by the language rule — it is an instrument,
 * not product — and listed rather than hidden because a maintainer with no way
 * back to it has to remember the URL.
 *
 * It was three entries until the three benches merged: they each opened their
 * own handle to the same FT232H, which is fine in three documents and is a
 * failed claimInterface in one.
 *
 * @type {[string, string][]}
 */
const TOOLS = [
  ['dev.html', 'Developer options'],
];

/**
 * @param {{
 *   lang: 'en' | 'zh',
 *   config: import('./config.js').Config,
 *   save: () => void,
 *   openKeys: (back: () => void) => void,
 *   calibrate: (back: () => void) => void,
 *   onResetSticky: () => void,
 *   onChange: () => void,
 * }} deps
 */
export function createSettings(deps) {
  const sheet = $('sheet');
  const rows = $('settingsRows');

  $('settingsTitle').textContent = t(deps.lang, 'settings');
  $('sheetClose').textContent = t(deps.lang, 'close');
  $('sheetClose').addEventListener('click', () => close());
  $('settings').addEventListener('click', (e) => { e.preventDefault(); open(); });
  // The backdrop is the sheet itself; a click that lands on it rather than on
  // the panel inside is a click outside.
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });

  function open() { render(); sheet.hidden = false; }
  function close() { sheet.hidden = true; deps.onChange(); }

  function render() {
    rows.textContent = '';

    // Closing first, always: two bottom sheets on one phone screen leave the
    // lower one showing around the edges of the upper, and closing the top one
    // uncovers a panel that has since gone stale. What is handed over is the
    // way back, so a door out of a drawer is not a one-way door.
    rows.append(door('stepKeys', () => { close(); deps.openKeys(open); }));
    rows.append(door('stepSteer', () => { close(); deps.calibrate(open); }));
    rows.append(language());
    rows.append(wakeWord());
    rows.append(sticky());
    rows.append(tools());
  }

  /**
   * @param {import('./strings.js').StringKey} key
   * @param {() => void} onPick
   */
  function door(key, onPick) {
    const row = document.createElement('button');
    row.className = 'setting setting-door';
    row.type = 'button';
    row.textContent = t(deps.lang, key);
    row.addEventListener('click', onPick);
    return row;
  }

  /**
   * Reloads rather than re-rendering. Every surface reads `lang` once, when it
   * is built — the fab's label, the robot's five state names, the setup sheet's
   * rows — and re-translating a running page in place means every one of them
   * has to be told. A reload is one line and cannot miss a caller.
   */
  function language() {
    const row = document.createElement('div');
    row.className = 'setting';
    row.append(caption('settingsLanguage'));
    const picker = document.createElement('select');
    for (const [code, label] of /** @type {[string, string][]} */ ([
      ['en', 'English'], ['zh', '中文'],
    ])) {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = label;
      option.selected = code === deps.config.lang;
      picker.append(option);
    }
    picker.addEventListener('change', () => {
      deps.config.lang = /** @type {'en' | 'zh'} */ (picker.value);
      deps.save();
      location.reload();
    });
    row.append(picker);
    return row;
  }

  /**
   * Off by default: the screen being on is the robot being called. On brings
   * back SLEEPING and the name that ends it. Read when the microphone opens,
   * so a change lands on the next Listen rather than mid-conversation.
   */
  function wakeWord() {
    const row = document.createElement('label');
    row.className = 'setting';
    row.append(caption('settingsWakeWord'));
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = deps.config.wakeWord;
    const shown = document.createElement('p');
    shown.className = 'setting-value';
    // The name is composed here, never stored joined — see sayThis.
    const paint = () => {
      shown.textContent = box.checked
        ? `「${KEYWORDS[0]}」` : t(deps.lang, 'settingsWakeWordOff');
    };
    box.addEventListener('change', () => {
      deps.config.wakeWord = box.checked;
      deps.save();
      paint();
    });
    paint();
    row.append(box, shown);
    return row;
  }

  /**
   * Spec §11.1: state the robot was put into by voice, invisible ever after.
   * A state that can be entered and not left is a trap, and the trap is the
   * reason this row exists rather than a list of preferences.
   */
  function sticky() {
    const row = document.createElement('div');
    row.className = 'setting';
    row.append(caption('settingsSticky'));
    const shown = document.createElement('p');
    shown.className = 'setting-value';
    shown.textContent = STICKY
      .map((k) => `${k}: ${String(deps.config[k] ?? '—')}`)
      .join(' · ');
    const button = document.createElement('button');
    button.className = 'quiet';
    button.type = 'button';
    button.textContent = t(deps.lang, 'settingsForget');
    button.addEventListener('click', () => { deps.onResetSticky(); render(); });
    row.append(shown, button);
    return row;
  }

  function tools() {
    const row = document.createElement('div');
    row.className = 'setting';
    row.append(caption('settingsTools'));
    const list = document.createElement('p');
    list.className = 'setting-value';
    for (const [href, label] of TOOLS) {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = label;
      if (list.childNodes.length) list.append(' · ');
      list.append(a);
    }
    row.append(list);
    return row;
  }

  /** @param {import('./strings.js').StringKey} key */
  function caption(key) {
    const el = document.createElement('span');
    el.className = 'setting-caption';
    el.textContent = t(deps.lang, key);
    return el;
  }

  return { open, close, render };
}
