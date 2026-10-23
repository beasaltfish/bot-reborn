import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlFor, lanAllowed } from '../../server/pages.js';

test('each page address names its HTML, with or without index.html', () => {
  assert.equal(htmlFor('/phone/')?.html, 'phone/index.html');
  assert.equal(htmlFor('/phone/index.html')?.html, 'phone/index.html');
  assert.equal(htmlFor('/phone/dev.html')?.html, 'phone/dev.html');
  assert.equal(htmlFor('/')?.html, 'admin/index.html');
  assert.equal(htmlFor('/index.html')?.html, 'admin/index.html');
  assert.equal(htmlFor('/sim/index.html')?.html, 'sim/index.html');
  assert.equal(htmlFor('/sim/main.js'), null);
});

test('the network may open the phone page and what it loads', () => {
  for (const p of [
    '/phone', '/phone/', '/phone/style.css', '/phone/icons/icon.svg',
    '/assets/index-abc123.js', '/core/protocol.js', '/core/audio/pcm.js',
    '/@vite/client', '/@vite/env', '/@react-refresh', '/node_modules/vite/dist/client/env.mjs',
  ]) assert.equal(lanAllowed(p), true, p);
});

test('the network gets nothing else', () => {
  for (const p of [
    '/', '/index.html', '/sim/', '/sim/main.js', '/api/characters', '/fixtures/check-en.wav',
    '/core/fixtures/check-en.wav', '/core/fixtures/README.md', '/core/strings.ts',
    '/server/main.js', '/admin/src/main.tsx', '/node_modules/three/build/three.module.js',
    '/@fs/etc/passwd', '/phone/../server/main.js', '/core/../server/main.js',
    // Windows: Vite reads a backslash as a separator.
    '/phone/..\\server\\brain-server.js', '/core/..\\server\\x.js',
  ]) assert.equal(lanAllowed(p), false, p);
});
