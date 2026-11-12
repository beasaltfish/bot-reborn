import { simulatorLanguage } from './language.js';

/** @param {'en'|'zh'} initial @param {(lang:'en'|'zh')=>boolean} change */
export function createLanguageControl(initial, change) {
  const element = document.createElement('label');
  element.className = 'language-control';
  element.textContent = 'Language / 语言 ';
  const select = document.createElement('select');
  for (const [value, text] of [['en', 'English'], ['zh', '中文']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
  }
  let current = initial;
  select.value = current;
  select.addEventListener('change', () => {
    const next = simulatorLanguage(select.value);
    if (next !== current && change(next)) current = next;
    select.value = current;
  });
  element.append(select);
  return { element };
}
