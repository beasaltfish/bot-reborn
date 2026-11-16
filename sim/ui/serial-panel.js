// The board's USB serial monitor: the firmware's own lines, its own commands,
// and a character picker that only types a `token` command. The console text
// stays English; the chrome is bilingual.
import { consoleCommand } from '../firmware/console.js';
import { simText } from './strings.js';

const MAX_LINES = 200;

/** @param {string} text @returns {HTMLElement} */
const el = (text = '') => {
  const node = document.createElement('div');
  if (text) node.textContent = text;
  return node;
};

/**
 * @param {{
 *   lang: 'en' | 'zh',
 *   firmware: import('../firmware/index.js').Firmware,
 *   settings: import('../bench.js').Settings,
 *   characters?: { id: string, name: string }[],
 *   onChange(settings: import('../bench.js').Settings): void,
 *   onReboot(): void,
 * }} o
 */
export function createSerialPanel(o) {
  let settings = o.settings;
  /** @type {string[]} */ const lines = [];

  const root = document.createElement('section');
  root.id = 'serial';
  root.hidden = true;
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', simText(o.lang, 'serial.title'));

  const header = document.createElement('h2');
  header.textContent = simText(o.lang, 'serial.title');

  const log = document.createElement('pre');
  log.dataset.role = 'log';

  const form = document.createElement('form');
  const input = document.createElement('input');
  input.dataset.role = 'line';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', simText(o.lang, 'serial.hint'));
  const send = document.createElement('button');
  send.type = 'submit';
  send.textContent = simText(o.lang, 'serial.send');
  form.append(input, send);

  const picker = document.createElement('label');
  picker.textContent = simText(o.lang, 'serial.characters');
  const select = document.createElement('select');
  select.dataset.role = 'character';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = simText(o.lang, 'serial.pick');
  select.append(none);
  for (const c of o.characters ?? []) {
    const option = document.createElement('option');
    option.value = c.id;
    option.textContent = c.name;
    select.append(option);
  }
  picker.append(select);

  root.append(header, log, form, picker);

  function renderLog() {
    log.textContent = lines.join('\n');
    log.scrollTop = log.scrollHeight;
  }

  /** @param {string} line */
  function append(line) {
    lines.push(line);
    if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
    renderLog();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (o.firmware.id !== 'body') return;
    const result = consoleCommand({ settings, firmware: o.firmware }, input.value);
    for (const line of result.lines) append(line);
    settings = result.settings;
    o.onChange(settings);
    input.value = '';
    if (result.reboot) o.onReboot();
  });

  select.addEventListener('change', async () => {
    const id = select.value;
    if (!id) return;
    try {
      const res = await fetch(`/api/characters/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(String(res.status));
      const { token } = await res.json();
      input.value = `token ${token}`;
      input.focus();
    } catch {
      append('error: cannot read that character from the brain');
    }
    select.value = '';
  });

  if (o.firmware.id !== 'body') {
    input.disabled = true;
    send.disabled = true;
    append('no console on this firmware');
  }

  return {
    element: root,
    /** @param {boolean} visible */
    show(visible) { root.hidden = !visible; },
    append,
    /** @param {import('../bench.js').Settings} next */
    setSettings(next) { settings = next; },
    get log() { return [...lines]; },
  };
}
