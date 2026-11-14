import { simText } from './strings.js';

/** @typedef {{query:string, sections:import('./catalogue-model.js').CatalogueSection[], categories:{id:string,label:string}[], tags:string[], selectedCategories:string[], selectedTags:string[]}} CatalogueState */
/** @param {{lang:string, add(part:string):void, carry(part:string,event:PointerEvent):void, learn(part:string):void, setQuery(query:string):void, toggleCategory(id:string):void, toggleTag(id:string):void, toggleFavourite(part:string):void, thumbnail?(part:string):string|null}} opts */
export function createCataloguePanel(opts) {
  const text = (/** @type {string} */ key) => simText(opts.lang, `catalogue.${key}`);
  const element = document.createElement('section');
  element.className = 'catalogue-panel';
  element.hidden = true;
  element.setAttribute('aria-label', text('title'));
  const header = document.createElement('header');
  const title = document.createElement('h2');
  title.textContent = text('title');
  const close = document.createElement('button');
  close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', text('close'));
  close.addEventListener('click', () => { element.hidden = true; });
  header.append(title, close);
  const label = document.createElement('label');
  label.textContent = text('search');
  const search = document.createElement('input');
  search.type = 'search';
  search.addEventListener('input', () => opts.setQuery(search.value));
  label.append(search);
  const filters = document.createElement('div');
  const results = document.createElement('div');
  element.append(header, label, filters, results);
  /** @param {string} name @param {string} value @param {string} action @param {() => void} run */
  function actionButton(name, value, action, run) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = name; button.dataset.action = action;
    button.setAttribute('aria-label', `${name}: ${value}`);
    button.addEventListener('click', run);
    return button;
  }
  /** @param {CatalogueState} state */
  function render(state) {
    const active = document.activeElement;
    const focused = active?.tagName === 'BUTTON' && element.contains(active) ? {
      category: active.getAttribute('data-category'), tag: active.getAttribute('data-tag'),
      action: active.getAttribute('data-action'), part: active.closest('[data-part]')?.getAttribute('data-part') ?? null,
    } : null;
    if (search.value !== state.query) search.value = state.query;
    filters.replaceChildren();
    /** @param {string} labelText @param {{id:string,label:string}[]} choices @param {string[]} selected @param {'category'|'tag'} kind @param {(id:string)=>void} toggle */
    function filterGroup(labelText, choices, selected, kind, toggle) {
      if (!choices.length) return;
      const group = document.createElement('div');
      group.setAttribute('role', 'group'); group.setAttribute('aria-label', labelText);
      for (const choice of choices) {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = choice.label; button.dataset[kind] = choice.id;
        button.setAttribute('aria-pressed', String(selected.includes(choice.id)));
        button.addEventListener('click', () => toggle(choice.id));
        group.append(button);
      }
      filters.append(group);
    }
    filterGroup(text('categories'), state.categories, state.selectedCategories, 'category', opts.toggleCategory);
    filterGroup(text('interfaces'), state.tags.map(id => ({ id, label: id })), state.selectedTags, 'tag', opts.toggleTag);
    results.replaceChildren();
    for (const section of state.sections) {
      const group = document.createElement('section');
      const heading = document.createElement('h3'); heading.textContent = section.label; group.append(heading);
      for (const entry of section.entries) {
        const card = document.createElement('article'); card.dataset.part = entry.part;
        const body = document.createElement('div'); body.className = 'card-body';
        const thumb = opts.thumbnail?.(entry.part);
        if (thumb) {
          const image = document.createElement('img');
          image.className = 'thumb'; image.src = thumb; image.alt = ''; image.loading = 'lazy'; image.width = 64; image.height = 64;
          card.append(image);
        }
        const name = document.createElement('h4'); name.textContent = entry.name;
        const summary = document.createElement('p'); summary.textContent = entry.summary;
        const meta = document.createElement('p');
        const simulation = entry.simulationLimited ? 'limited' : entry.simulated ? 'simulated' : 'developing';
        const firmware = entry.firmwareIndependent ? 'noFirmwareNeeded' : entry.firmwareSupported ? 'firmware' : 'noFirmware';
        meta.textContent = entry.structural ? '' : [...entry.interfaces, ...(entry.voltage ? [entry.voltage] : []), ...(entry.onBoard ? [text('board')] : []), text(simulation), text(firmware)].join(' · ');
        const add = actionButton(text('add'), entry.name, 'add', () => opts.add(entry.part));
        const learn = actionButton(text('learn'), entry.name, 'learn', () => opts.learn(entry.part));
        const favourite = actionButton(entry.favourite ? '★' : '☆', entry.name, 'favourite', () => opts.toggleFavourite(entry.part));
        favourite.classList.add('star');
        favourite.setAttribute('aria-pressed', String(entry.favourite));
        body.append(name, summary, meta, add);
        if (!entry.structural) body.append(learn);
        body.append(favourite);
        card.append(body);
        card.addEventListener('pointerdown', event => {
          const target = /** @type {Element|null} */ (event.target);
          if (event.button !== 0 || event.isPrimary === false || target?.closest('button')) return;
          const win = document.defaultView;
          if (!win) return;
          const stop = () => {
            win.removeEventListener('pointermove', move);
            win.removeEventListener('pointerup', stop);
            win.removeEventListener('pointercancel', stop);
          };
          /** @param {PointerEvent} next */
          const move = next => {
            if (next.pointerId !== event.pointerId || Math.hypot(next.clientX - event.clientX, next.clientY - event.clientY) <= 5) return;
            stop();
            opts.carry(entry.part, next);
          };
          win.addEventListener('pointermove', move);
          win.addEventListener('pointerup', stop);
          win.addEventListener('pointercancel', stop);
        });
        group.append(card);
      }
      results.append(group);
    }
    if (focused) {
      const button = [...element.querySelectorAll('button')].find(candidate =>
        (focused.category !== null && candidate.dataset.category === focused.category)
        || (focused.tag !== null && candidate.dataset.tag === focused.tag)
        || (focused.part !== null && candidate.dataset.action === focused.action && candidate.closest('[data-part]')?.getAttribute('data-part') === focused.part));
      button?.focus();
    }
  }
  return { element, render, open: () => { element.hidden = false; }, close: () => { element.hidden = true; } };
}
