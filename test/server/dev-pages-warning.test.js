import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDevPages } from '../../server/dev-pages.js';
import { createBrainServer } from '../../server/brain-server.js';
import { renderEarcons } from '../../server/audio/render.js';
import { tempCharacters } from './helpers.js';

// Its own file: Vite says a deprecation once per process, so a test after
// another dev-mode start would never hear it.
test('dev mode starts without a deprecation warning', { timeout: 60_000 }, async () => {
  /** @type {string[]} */ const lines = [];
  const saved = { warn: console.warn, log: console.log, error: console.error };
  for (const k of /** @type {const} */ (['warn', 'log', 'error'])) console[k] = (...a) => { lines.push(a.join(' ')); };
  const server = createBrainServer({
    dir: tempCharacters().dir, sfx: new Map(), earcons: renderEarcons(), log: () => {},
    makeEars: () => { throw new Error('no robot expected'); },
    pages: (http) => createDevPages(http),
  });
  try {
    const port = await server.listen(0);
    await fetch(`http://localhost:${port}/sim/`);
  } finally {
    await server.close();
    Object.assign(console, saved);
  }
  assert.deepEqual(lines.filter((l) => /deprecat/i.test(l)), []);
});
