// One contract for a manifest, whether it ships in the repository or a person
// wrote it: the fields the brain runs, and the two a person reads (examples,
// wiring) are judged here so the loader, the catalogue and the tests agree.

import test from 'node:test';
import assert from 'node:assert/strict';
import { manifestProblem, bodyFrom } from '../core/plugin-manifest.js';

const led = () => ({
  id: 'led-module', label: { en: 'LED module', zh: 'LED 模块' },
  parts: ['esp32', 'led-5mm', 'resistor'],
  resources: [{ kind: 'gpio', name: 'led', gpio: 5, direction: 'output', safe: 0 }],
  commands: [{ name: 'led_on', args: { type: 'object', properties: {} }, timeoutMs: 500,
    run: [{ op: 'pin.write', args: { pin: 'led', level: 1 } }] }],
});

test('an example that calls an undeclared command is refused', () => {
  const m = { ...led(), examples: [{ name: 'wave', say: 'Wave.', run: [{ command: 'nope' }] }] };
  assert.match(manifestProblem(m) ?? '', /unknown command "nope"/);
});

test('a wiring pin the resources do not declare is refused', () => {
  const m = { ...led(), wiring: { links: [{ a: 'esp:GPIO9', b: 'led:A' }] } };
  assert.match(manifestProblem(m) ?? '', /GPIO9.*not declared/);
});

test('examples and wiring that fit are accepted', () => {
  const m = { ...led(),
    examples: [{ name: 'light_up', say: 'Turn it on.', run: [{ command: 'led_on' }] }],
    wiring: { links: [{ a: 'esp:GPIO5', b: 'led:A' }] }, note: { en: 'Bench.', zh: '台面。' } };
  assert.equal(manifestProblem(m), null);
  const body = bodyFrom(m);
  assert.deepEqual(body.wiring, m.wiring);
  assert.deepEqual(body.note, m.note);
});
