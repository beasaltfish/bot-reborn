import { createButtonLabExample } from '../lessons/button-example.js';
import { simText } from './strings.js';

/** Isolated hypothetical input circuit, independent of real firmware settings. @param {string} lang */
export function createButtonLabPanel(lang) {
  const element = document.createElement('section'); element.className = 'button-lab-panel';
  const title = document.createElement('h2'), note = document.createElement('p');
  const label = document.createElement('label'), caption = document.createElement('span'), select = document.createElement('select');
  for (const value of ['up', 'down', 'none']) { const option = document.createElement('option'); option.value = value; select.append(option); }
  label.append(caption, select);
  const button = document.createElement('button'); button.type = 'button'; button.setAttribute('aria-pressed', 'false');
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  element.append(title, note, label, button, status);
  const example = createButtonLabExample();
  let pressed = false;
  function render() {
    title.textContent = simText(lang, 'buttonLab.title');
    note.textContent = simText(lang, 'buttonLab.note');
    caption.textContent = `${simText(lang, 'buttonLab.pull')} `;
    for (const option of select.options) option.textContent = simText(lang, `buttonLab.${option.value}`);
    button.textContent = simText(lang, 'buttonLab.hold');
    button.setAttribute('aria-pressed', String(pressed));
    status.textContent = simText(lang, `buttonLab.state.${example.evaluate().states['esp:GPIO4']}`);
  }
  const release = () => { if (pressed) { pressed = false; example.press(false); render(); } };
  const press = () => { if (!pressed) { pressed = true; example.press(true); render(); } };
  select.value = 'up';
  select.addEventListener('change', () => { example.setPull(select.value === 'down' ? 'down' : select.value === 'none' ? 'none' : 'up'); render(); });
  button.addEventListener('pointerdown', event => { event.preventDefault(); if (button.setPointerCapture) button.setPointerCapture(event.pointerId); press(); });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) button.addEventListener(event, release);
  button.addEventListener('keydown', event => { if (!event.repeat && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); press(); } });
  button.addEventListener('keyup', event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); release(); } });
  window.addEventListener('blur', release);
  render();
  return { element, setLanguage(/** @type {string} */ value) { lang = value; render(); }, dispose() { release(); window.removeEventListener('blur', release); } };
}
