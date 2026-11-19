// The shopping list as a sheet: every line the bench needs, with the specs to
// check before paying, and a print button. It reads the bench on every render
// so it always matches what is on the table.
import { shoppingList, totalUsd } from '../shopping.js';
import { screenById, screenLabel } from '../../core/screens.js';
import { simText } from './strings.js';

/**
 * @param {{
 *   lang: string,
 *   bench: () => import('../bench.js').Bench,
 *   plan?: () => import('../plan.js').Plan | null,
 *   onClose?: () => void,
 * }} opts
 */
export function createShoppingPanel({ lang, bench, plan, onClose }) {
  const element = document.createElement('section');
  element.className = 'shopping-panel';
  element.id = 'shopping-panel';

  /** @param {string} key @param {{ [k: string]: string }} [vars] */
  const text = (key, vars) => simText(lang, key, vars);

  /** @param {string} tag @param {string} value @param {string} [cls] */
  function child(tag, value, cls) {
    const node = document.createElement(tag);
    node.textContent = value;
    if (cls) node.className = cls;
    return node;
  }

  function render() {
    element.replaceChildren();
    const list = shoppingList(bench(), plan?.() ?? null);
    const header = document.createElement('header');
    header.append(child('h2', text('shopping.title')));
    const close = /** @type {HTMLButtonElement} */ (child('button', '×'));
    close.type = 'button';
    close.className = 'close no-print';
    close.setAttribute('aria-label', text('shopping.close'));
    close.addEventListener('click', () => { if (onClose) onClose(); else element.hidden = true; });
    header.append(close);
    element.append(header);

    if (!list.lines.length) {
      element.append(child('p', text('shopping.empty')));
      return;
    }

    const total = totalUsd(list.lines);
    element.append(child('p', text('shopping.total', {
      low: total.low.toFixed(2), high: total.high.toFixed(2),
    }), 'shopping-total'));

    const rows = document.createElement('ul');
    rows.className = 'shopping-lines';
    for (const line of list.lines) {
      const row = document.createElement('li');
      row.dataset.part = line.key;
      const keywords = line.purchase.keywords[lang === 'zh' ? 'zh' : 'en'];
      row.append(child('strong', `${keywords}${line.detail ? ` · ${line.detail}` : ''} ×${line.quantity}`));
      row.append(child('span', `$${line.purchase.priceUsd[0]}–${line.purchase.priceUsd[1]}`, 'shopping-price'));
      const specs = line.purchase.mustMatch.map((m) => m[lang === 'zh' ? 'zh' : 'en']).join(' · ');
      if (specs) row.append(child('p', `${text('shopping.spec')}: ${specs}`, 'shopping-spec'));
      // The English words are what a search box anywhere takes, whatever the page language.
      row.append(child('p', `${text('shopping.keywords')}: ${line.purchase.keywords.en}`, 'shopping-keywords'));
      const alternatives = line.purchase.alternatives.map((a) => a[lang === 'zh' ? 'zh' : 'en']).join(' · ');
      if (alternatives) row.append(child('p', `${text('shopping.alternatives')}: ${alternatives}`, 'shopping-alternatives'));
      if (line.planned > 0) row.append(child('span', text('shopping.planned', { n: String(line.planned) }), 'shopping-planned'));
      rows.append(row);
      if (line.warning) {
        const warn = child('p', text(`shopping.warn.${line.warning === 'screen-unsupported-controller' ? 'unsupported' : 'unverified'}`));
        warn.dataset.warning = line.warning;
        warn.setAttribute('role', 'status');
        rows.append(warn);
      }
    }
    element.append(rows);

    if (list.planScreens.length) {
      const named = list.planScreens
        .map((id) => { const s = screenById(id.slice('screen-'.length)); return s ? screenLabel(s, lang) : id; })
        .join(', ');
      const onBench = list.lines
        .filter((line) => line.key.startsWith('screen-'))
        .map((line) => { const s = screenById(line.key.slice('screen-'.length)); return s ? screenLabel(s, lang) : line.key; })
        .join(', ');
      element.append(child('p', text('shopping.planScreen', { wanted: named, have: onBench }), 'shopping-plan-screen'));
    }

    const footer = document.createElement('div');
    footer.className = 'shopping-footer no-print';
    const print = /** @type {HTMLButtonElement} */ (child('button', text('shopping.print')));
    print.type = 'button';
    print.dataset.action = 'print';
    print.addEventListener('click', () => window.print());
    footer.append(print, child('p', text('shopping.note'), 'shopping-note'));
    element.append(footer);
  }

  return { element, render };
}
