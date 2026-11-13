import { simText } from './strings.js';

/** @typedef {{kind:'servo'|'driver'|'motor'|'strip'|'display'|'button', id:string, driverId?:string}} RuntimeTarget */
/** @type {Record<string, any>} */
const DEFAULTS = {
  servo: { angle: 90 },
  driver: { direction: 'coast', speed: 0.5, load: 'idle' },
  motor: { direction: 'coast', speed: 0.5, load: 'idle' },
  strip: { color: 'white', pixels: 8 },
  display: { temperature: 25, humidity: 50, pressure: 1013 },
  button: { pressed: false },
};

/** A floating panel that drives the selected device's runtime state. */
export function createRuntimePanel(/** @type {{lang:string, change:(target:RuntimeTarget, values:Record<string,any>)=>void}} */ opts) {
  const element = document.createElement('section');
  element.id = 'runtime';
  element.hidden = true;
  const heading = document.createElement('h2');
  const body = document.createElement('div');
  element.append(heading, body);
  let lang = opts.lang;
  /** @type {RuntimeTarget|null} */ let target = null;
  /** @type {Record<string, Record<string, any>>} */ const values = {};

  /** @param {string} id @param {Record<string, any>} defaults */
  function stateFor(id, defaults) {
    values[id] ??= { ...defaults };
    return values[id];
  }
  /** @param {string} labelKey @param {HTMLElement} input */
  function row(labelKey, input) {
    const label = document.createElement('label');
    const caption = document.createElement('span');
    caption.textContent = simText(lang, labelKey);
    label.append(caption, input);
    body.append(label);
    return input;
  }
  /** @param {RuntimeTarget|null} next @param {'servo'|'driver'|'motor'|'strip'|'display'|'button'} kind @param {string} key @param {any} value */
  function change(next, kind, key, value) {
    if (!next) return;
    const state = stateFor(next.id, DEFAULTS[kind]);
    state[key] = value;
    opts.change(next, { ...state });
  }
  /** @param {number} min @param {number} max @param {number} step */
  function range(min, max, step) {
    const input = document.createElement('input');
    input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step);
    return input;
  }
  /** @param {string[]} options */
  function select(options) {
    const input = document.createElement('select');
    for (const option of options) {
      const item = document.createElement('option');
      item.value = option;
      item.textContent = simText(lang, `lesson.value.${option}`);
      input.append(item);
    }
    return input;
  }
  function render() {
    if (!target) { element.hidden = true; return; }
    element.hidden = false;
    const kind = target.kind;
    heading.textContent = simText(lang, 'runtime.title');
    body.replaceChildren();
    if (kind === 'servo') {
      const state = stateFor(target.id, DEFAULTS.servo);
      const angle = /** @type {HTMLInputElement} */ (row('lesson.control.angle', range(0, 180, 1)));
      angle.value = String(state.angle);
      const output = document.createElement('output');
      output.textContent = `${angle.value}°`;
      angle.addEventListener('input', () => { output.textContent = `${angle.value}°`; change(target, kind, 'angle', Number(angle.value)); });
      angle.after(output);
    } else if (kind === 'driver' || kind === 'motor') {
      const id = target.driverId ?? target.id;
      const driveTarget = { ...target, id };
      const state = stateFor(id, DEFAULTS[kind]);
      const direction = /** @type {HTMLSelectElement} */ (row('lesson.control.direction', select(['forward', 'reverse', 'coast', 'brake'])));
      direction.value = state.direction;
      direction.addEventListener('change', () => change(driveTarget, kind, 'direction', direction.value));
      const speed = /** @type {HTMLInputElement} */ (row('lesson.control.speed', range(0, 1, 0.05)));
      speed.value = String(state.speed);
      speed.addEventListener('input', () => change(driveTarget, kind, 'speed', Number(speed.value)));
      const load = /** @type {HTMLSelectElement} */ (row('lesson.control.load', select(['idle', 'load', 'stall'])));
      load.value = state.load;
      load.addEventListener('change', () => change(driveTarget, kind, 'load', load.value));
    } else if (kind === 'strip') {
      const state = stateFor(target.id, DEFAULTS.strip);
      const color = /** @type {HTMLSelectElement} */ (row('lesson.control.color', select(['off', 'red', 'green', 'blue', 'white'])));
      color.value = state.color;
      color.addEventListener('change', () => change(target, kind, 'color', color.value));
      const pixels = /** @type {HTMLInputElement} */ (row('lesson.control.pixels', range(1, 60, 1)));
      pixels.value = String(state.pixels);
      pixels.addEventListener('input', () => change(target, kind, 'pixels', Number(pixels.value)));
    } else if (kind === 'display') {
      const state = stateFor(target.id, DEFAULTS.display);
      for (const key of /** @type {const} */ (['temperature', 'humidity', 'pressure'])) {
        const input = /** @type {HTMLInputElement} */ (row(`lesson.control.${key}`, range(key === 'temperature' ? -10 : key === 'humidity' ? 0 : 800, key === 'temperature' ? 50 : key === 'humidity' ? 100 : 1200, key === 'temperature' ? 0.1 : 1)));
        input.value = String(state[key]);
        input.addEventListener('input', () => change(target, kind, key, Number(input.value)));
      }
    } else {
      const state = stateFor(target.id, DEFAULTS.button);
      const pressed = /** @type {HTMLInputElement} */ (row('lesson.control.pressed', document.createElement('input')));
      pressed.type = 'checkbox';
      pressed.checked = Boolean(state.pressed);
      pressed.addEventListener('change', () => change(target, kind, 'pressed', pressed.checked));
    }
  }
  return {
    element,
    /** @param {RuntimeTarget} next */
    show(next) { target = next; render(); },
    hide() { target = null; element.hidden = true; },
    /** @param {string} value */
    setLanguage(value) { lang = value; render(); },
  };
}
