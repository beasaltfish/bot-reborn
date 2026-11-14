import { defaultSonarStimuli, hcSr04State, setSonarDistance, SONAR_DISTANCE_CM } from '../devices/hc-sr04.js';
import { simText } from './strings.js';

/** A hypothetical, isolated demonstration; it does not evaluate bench wiring. @param {string} lang */
export function createSonarLabPanel(lang) {
  const element = document.createElement('section'); element.className = 'sonar-lab-panel';
  const title = document.createElement('h2'), note = document.createElement('p');
  const label = document.createElement('label'), caption = document.createElement('span');
  const slider = document.createElement('input'); slider.type = 'range'; slider.min = String(SONAR_DISTANCE_CM[0]); slider.max = String(SONAR_DISTANCE_CM[1]); slider.step = '1';
  const output = document.createElement('output');
  const button = document.createElement('button'); button.type = 'button';
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  label.append(caption, slider, output); element.append(title, note, label, button, status);
  let stimuli = defaultSonarStimuli();
  /** @type {'idle'|'measure'} */ let action = 'idle';
  const conditions = /** @type {const} */ ({ power: 'on', trigger: 'valid', echo: 'compatible' });
  function render() {
    title.textContent = simText(lang, 'sonarLab.title');
    note.textContent = simText(lang, 'sonarLab.note');
    caption.textContent = `${simText(lang, 'sonarLab.distance')} `;
    slider.value = String(stimuli.distanceCm);
    slider.setAttribute('aria-valuetext', `${stimuli.distanceCm} cm`);
    output.textContent = ` ${stimuli.distanceCm} cm`;
    button.textContent = simText(lang, 'sonarLab.trigger');
    const result = hcSr04State(conditions, stimuli, action);
    status.textContent = result.state === 'measured'
      ? simText(lang, 'sonarLab.result', { distance: result.distanceCm ?? 0, duration: result.echoDurationUs ?? 0 })
      : simText(lang, 'sonarLab.noMeasurement');
  }
  slider.addEventListener('input', () => { stimuli = setSonarDistance(stimuli, slider.valueAsNumber); action = 'idle'; render(); });
  button.addEventListener('click', () => { action = 'measure'; render(); });
  render();
  return { element, setLanguage(/** @type {string} */ value) { lang = value; render(); } };
}
