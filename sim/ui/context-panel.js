import { WIRE_PALETTE } from '../wire-color.js';
import { simText } from './strings.js';

/**
 * @param {{lang:string, startWire(point:string):void, recolorWire(id:string,color:string):void, removeWire(id:string):void}} opts
 */
export function createContextPanel(opts) {
  const element = document.createElement('section');
  element.id = 'selection-context';
  element.hidden = true;
  element.setAttribute('role', 'region');
  /** @param {{selection: import('../selection.js').Selection, info: ReturnType<typeof import('../selection.js').describeSelection>, color?:string}} state */
  function show({ selection, info, color }) {
    element.replaceChildren();
    if (!selection || !info) { element.hidden = true; return; }
    element.setAttribute('aria-label', info.title);
    const title = document.createElement('strong');
    title.textContent = info.title;
    element.append(title);
    const close = document.createElement('button');
    close.type = 'button';
    close.dataset.action = 'close';
    close.setAttribute('aria-label', simText(opts.lang, 'selection.close'));
    close.textContent = '×';
    close.addEventListener('click', () => { element.hidden = true; });
    element.append(close);
    for (const row of info.rows) {
      const item = document.createElement('div');
      item.textContent = `${row.label}: ${row.value}`;
      element.append(item);
    }
    if (selection.kind === 'pin') {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = 'start-wire';
      button.textContent = simText(opts.lang, 'selection.startWire');
      button.addEventListener('click', () => opts.startWire(selection.point));
      element.append(button);
    }
    if (selection.kind === 'wire') {
      for (const swatch of WIRE_PALETTE) {
        if (!swatch.color) continue;
        const value = swatch.color;
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.color = swatch.id;
        button.setAttribute('aria-label', simText(opts.lang, swatch.labelKey));
        button.setAttribute('aria-pressed', String(color === value));
        button.style.backgroundColor = value;
        button.addEventListener('click', () => opts.recolorWire(selection.id, value));
        element.append(button);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.dataset.action = 'remove-wire';
      remove.textContent = simText(opts.lang, 'selection.removeWire');
      remove.addEventListener('click', () => opts.removeWire(selection.id));
      element.append(remove);
    }
    element.hidden = false;
  }
  /** Place the measured panel inside the viewport, even when its content grows.
   * @param {number} x @param {number} y @param {number} [width] @param {number} [height]
   */
  function position(x, y, width = window.innerWidth, height = window.innerHeight) {
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(x, width - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(y, height - rect.height - 8))}px`;
    element.style.right = 'auto';
  }
  return { element, show, position, hide: () => { element.hidden = true; } };
}
