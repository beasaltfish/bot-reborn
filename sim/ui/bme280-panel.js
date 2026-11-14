import { defaultStimuli, STIMULUS_LIMITS } from '../stimuli.js';
import { simText } from './strings.js';

/** @typedef {ReturnType<typeof defaultStimuli>} Environment */
/** @typedef {{state:string,telemetry:Environment|null}} SensorState */
/** @param {{lang:string,change(key:string,value:number):void}} opts */
export function createBme280Panel(opts) {
  const element = document.createElement('section');
  element.className = 'bme280-panel';
  const title = document.createElement('strong');
  const note = document.createElement('p');
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const readings = document.createElement('p'); readings.dataset.readings = '';
  const controls = document.createElement('div');
  element.append(title, note, status, readings, controls);
  let lang = opts.lang;
  /** @type {SensorState} */ let state = { state: 'off', telemetry: null };
  let environment = defaultStimuli();
  /** @type {Map<keyof Environment, {label:HTMLSpanElement, input:HTMLInputElement}>} */
  const fields = new Map();
  for (const key of /** @type {const} */ (['temperatureC', 'humidityPct', 'pressureHpa'])) {
    const label = document.createElement('label');
    const caption = document.createElement('span');
    const input = document.createElement('input');
    input.type = 'number'; input.step = 'any'; input.min = String(STIMULUS_LIMITS[key][0]); input.max = String(STIMULUS_LIMITS[key][1]); input.dataset.stimulus = key;
    input.addEventListener('change', () => { if (Number.isFinite(input.valueAsNumber)) opts.change(key, input.valueAsNumber); });
    input.addEventListener('blur', () => { input.value = String(environment[key]); });
    label.append(caption, input); controls.append(label); fields.set(key, { label: caption, input });
  }
  function render() {
    title.textContent = simText(lang, 'bme.title');
    note.textContent = simText(lang, 'bme.note');
    const statusKey = `bme.state.${state.state}`;
    const translated = simText(lang, statusKey);
    status.textContent = translated === statusKey ? simText(lang, 'bme.state.unsupported') : translated;
    readings.textContent = state.telemetry
      ? `${state.telemetry.temperatureC} °C · ${state.telemetry.humidityPct} % · ${state.telemetry.pressureHpa} hPa`
      : simText(lang, 'bme.noReadings');
    for (const [key, field] of fields) {
      field.label.textContent = `${simText(lang, `bme.${key}`)} `;
      field.input.value = String(environment[key]);
    }
  }
  render();
  return {
    element,
    /** @param {SensorState} next @param {Environment} values */
    update(next, values) { state = next; environment = values; render(); },
    setLanguage(/** @type {string} */ value) { lang = value; render(); },
  };
}
