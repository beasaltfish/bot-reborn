// TEMPORARY. Deleted in Task 4 of docs/superpowers/plans/2026-09-21-developer-options.md.
//
// The three instrument pages are being merged into web/dev.html. Their entry
// files become panels first, one at a time, and this keeps each old page
// running in between so that no commit lands with a page that cannot be opened.
//
// It is not the shape anything should copy: it builds the one thing a panel is
// not allowed to build for itself (the status strip), and it hands out a
// context with most of the fields missing.

import { createStatus } from '../instrument-status.js';
import { loadConfig } from '../config.js';

/**
 * @param {{ name: string, start(ctx: any): void, stop(): void }} panel
 * @param {string[]} items status-strip readings this page shows
 */
export function bootLegacy(panel, items) {
  const mount = /** @type {HTMLElement} */ (document.getElementById('instrumentStatus'));
  const strip = createStatus(mount, items);
  const logEl = document.getElementById('log') ?? document.getElementById('turnLog');

  panel.start({
    pipeline: null,
    sherpa: null,
    keywords: '',
    config: loadConfig(),
    log: (/** @type {string} */ msg) => { if (logEl) logEl.textContent += msg + '\n'; },
    status: (/** @type {string} */ id, /** @type {any} */ state, /** @type {string} */ label) =>
      strip.set(id, state, label),
    exclusion: { claim: () => true, release: () => {}, get owner() { return null; } },
    knobs: { get executor() { return null; } },
    armStop: () => {},
  });
}
