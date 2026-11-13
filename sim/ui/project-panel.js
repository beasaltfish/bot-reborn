import { simText } from './strings.js';
import { projectReason } from './project-copy.js';

/** @typedef {ReturnType<typeof import('../project-progress.js').connectionProgress>[number]} Progress */
/** @typedef {ReturnType<typeof import('../selection.js').describeSelection>} SelectionInfo */
/** @typedef {{id:string,name:string,links:import('../target.js').Link[],ignoredFaultCodes?:string[]}} ProjectView */
/** @typedef {{mode:'guided'|'free', project:ProjectView|null, progress:Progress[], selection:SelectionInfo, diagnoses:import('../diagnose.js').Hint[]}} State */
/** @typedef {'project'|'diagnostics'} Tab */

/** @param {{lang:string, focus(points:string[]):void, leave?():void, build?(id:string):void}} opts */
export function createProjectPanel(opts) {
  const element = document.createElement('section');
  element.className = 'project-panel';
  const text = (/** @type {string} */ key) => simText(opts.lang, `project.${key}`);
  /** @type {Tab} */ let tab = 'project';
  let tabTouched = false;
  /** @type {State|null} */ let state = null;
  /** @type {State|null} */ let diagnostics = null;

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
  function renderTabs() {
    const strip = document.createElement('div');
    strip.className = 'project-tabs';
    strip.setAttribute('role', 'tablist');
    for (const [id, label] of /** @type {[Tab,string][]} */ ([['project', text('tabProject')], ['diagnostics', text('tabDiagnostics')]])) {
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.tab = id; button.textContent = label;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(tab === id));
      button.addEventListener('click', () => { tab = id; tabTouched = true; paint(); });
      strip.append(button);
    }
    element.append(strip);
  }
  /** @param {State} current */
  function renderProject(current) {
    if (current.mode === 'guided' && current.project) {
      const project = current.project;
      const title = text(project.id);
      const completed = current.progress.filter(link => link.status === 'complete').length;
      const heading = document.createElement('div');
      heading.className = 'project-heading';
      heading.append(child('h2', title === `project.${project.id}` ? project.name : title));
      heading.append(child('span', text('progress').replace('{done}', String(completed)).replace('{total}', String(current.progress.length))));
      element.append(heading);
      const goal = text(`goal.${project.id}`);
      if (goal !== `project.${project.id}`) element.append(child('p', goal));
      const next = current.progress.find(link => link.status !== 'complete');
      if (next) element.append(child('p', `${text('next')}: ${next.a} → ${next.b}`));
      const list = document.createElement('ol');
      for (const link of current.progress) {
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
        const show = showButton([link.a, link.b]);
        if (!link.present) {
          show.disabled = true;
          show.title = text('notOnBench');
          row.dataset.missing = 'true';
        }
        row.append(show);
        if (!link.present) {
          const note = child('span', text('missingParts').replace('{parts}', link.missing.join(', ')));
          note.className = 'missing';
          row.append(note);
        }
        list.append(row);
      }
      element.append(list);
      const actions = document.createElement('div');
      actions.className = 'project-actions';
      const build = /** @type {HTMLButtonElement} */ (child('button', text('build')));
      build.type = 'button';
      build.dataset.action = 'build';
      build.addEventListener('click', () => opts.build?.(project.id));
      const leave = /** @type {HTMLButtonElement} */ (child('button', text('leave')));
      leave.type = 'button';
      leave.dataset.action = 'leave';
      leave.addEventListener('click', () => opts.leave?.());
      actions.append(build, leave);
      element.append(actions);
      return;
    }
    element.append(child('h2', text('free')), child('p', text('choosePrompt')));
  }
  /** @param {State} current */
  function renderDiagnostics(current) {
    element.append(child('h2', text('diagnoses')));
    if (current.selection) {
      element.append(child('h3', text('selection')), child('strong', current.selection.title));
      for (const row of current.selection.rows) element.append(child('div', `${row.label}: ${row.value}`));
    }
    if (!current.diagnoses.length) {
      element.append(child('p', text('none')));
      return;
    }
    for (const hint of current.diagnoses) {
      const row = document.createElement('div');
      row.append(child('p', hint.text));
      if (hint.points.length) row.append(showButton(hint.points));
      element.append(row);
    }
  }
  function paint() {
    if (!state) return;
    const active = document.activeElement;
    const focusLabel = active?.tagName === 'BUTTON' && element.contains(active) ? active.getAttribute('aria-label') : null;
    element.replaceChildren();
    renderTabs();
    if (tab === 'diagnostics') renderDiagnostics(diagnostics ?? state);
    else renderProject(state);
    if (focusLabel) [...element.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === focusLabel)?.focus();
  }
  return {
    element,
    /** @param {State} next @param {State} [freeState] */
    render(next, freeState = next) {
      const previousProject = state?.project?.id ?? null;
      const nextProject = next.project?.id ?? null;
      state = next;
      diagnostics = freeState;
      if (!tabTouched || previousProject !== nextProject) tab = next.mode === 'guided' ? 'project' : 'diagnostics';
      paint();
    },
    /** @param {string} id */
    showProject(id) {
      if (!id) { tab = 'diagnostics'; tabTouched = true; }
      else { tab = 'project'; tabTouched = true; }
      paint();
    },
  };
}
