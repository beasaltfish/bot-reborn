import { simText } from './strings.js';
import { projectReason } from './project-copy.js';

/** @typedef {ReturnType<typeof import('../project-progress.js').connectionProgress>[number]} Progress */
/** @typedef {ReturnType<typeof import('../selection.js').describeSelection>} SelectionInfo */
/** @typedef {{mode:'guided'|'free', project:import('../projects.js').Project|null, progress:Progress[], selection:SelectionInfo, diagnoses:import('../diagnose.js').Hint[]}} State */

/** @param {{lang:string, focus(points:string[]):void}} opts */
export function createProjectPanel(opts) {
  const element = document.createElement('section');
  element.className = 'project-panel';
  const text = (/** @type {string} */ key) => simText(opts.lang, `project.${key}`);
  /** @param {string} tag @param {string} value */
  function child(tag, value) {
    const node = document.createElement(tag);
    node.textContent = value;
    return node;
  }
  /** @param {string[]} points */
  function showButton(points) {
    const button = /** @type {HTMLButtonElement} */ (child('button', text('show')));
    button.type = 'button';
    button.setAttribute('aria-label', `${text('show')}: ${points.join(' → ')}`);
    button.addEventListener('click', () => opts.focus(points));
    return button;
  }
  /** @param {State} state */
  function render(state) {
    const active = document.activeElement;
    const focusLabel = active?.tagName === 'BUTTON' && element.contains(active) ? active.getAttribute('aria-label') : null;
    const restoreFocus = () => {
      if (!focusLabel) return;
      [...element.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === focusLabel)?.focus();
    };
    element.replaceChildren();
    if (state.mode === 'guided' && state.project) {
      const project = state.project;
      const title = text(project.id);
      const completed = state.progress.filter(link => link.status === 'complete').length;
      const heading = document.createElement('div');
      heading.className = 'project-heading';
      heading.append(child('h2', title === `project.${project.id}` ? project.name : title));
      heading.append(child('span', text('progress').replace('{done}', String(completed)).replace('{total}', String(state.progress.length))));
      element.append(heading);
      const next = state.progress.find(link => link.status !== 'complete');
      if (next) element.append(child('p', `${text('next')}: ${next.a} → ${next.b}`));
      const list = document.createElement('ol');
      for (const link of state.progress) {
        const row = document.createElement('li');
        row.dataset.status = link.status;
        const label = text(link.status);
        const status = child('span', label);
        status.setAttribute('aria-label', label);
        row.append(status, child('div', `${link.a} → ${link.b}`));
        const reason = project.links.find(l => l.a === link.a && l.b === link.b)?.why;
        const why = reason ? projectReason(opts.lang, reason) : null;
        if (why) row.append(child('p', why));
        if (link.faultCodes.length) row.append(child('div', link.faultCodes.join(', ')));
        row.append(showButton([link.a, link.b]));
        list.append(row);
      }
      element.append(list);
      restoreFocus();
      return;
    }
    element.append(child('h2', text('free')));
    if (state.selection) {
      element.append(child('h3', text('selection')), child('strong', state.selection.title));
      for (const row of state.selection.rows) element.append(child('div', `${row.label}: ${row.value}`));
    }
    element.append(child('h3', text('diagnoses')));
    if (!state.diagnoses.length) element.append(child('p', text('none')));
    for (const hint of state.diagnoses) {
      const row = document.createElement('div');
      row.append(child('p', hint.text));
      if (hint.points.length) row.append(showButton(hint.points));
      element.append(row);
    }
    restoreFocus();
  }
  return { element, render };
}
