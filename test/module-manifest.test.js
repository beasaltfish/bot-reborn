import assert from 'node:assert/strict';
import test from 'node:test';
import { moduleProblem, MODULE_ID } from '../core/module-manifest.js';

const led = () => ({
  id: 'led-module', label: { en: 'LED module', zh: 'LED 模块' },
  parts: ['esp32', 'led-5mm', 'resistor'],
  resources: [{ kind: 'gpio', name: 'led', gpio: 5, direction: 'output', safe: 0 }],
  commands: [{ name: 'led_on', args: { type: 'object', properties: {} }, timeoutMs: 500,
    run: [{ op: 'pin.write', args: { pin: 'led', level: 1 } }] }],
  examples: [{ name: 'light_up', label: { en: 'Light up', zh: '点亮' }, say: 'Turn it on.',
    args: { type: 'object', properties: {} }, run: [{ command: 'led_on' }] }],
  wiring: { parts: [{ id: 'led', part: 'led-5mm' }],
    links: [{ a: 'esp:GPIO5', b: 'led:A', why: 'Drive it.' }] },
});

test('the shipped LED module is valid and its id is safe', () => {
  assert.equal(moduleProblem(led()), null);
  assert.ok(MODULE_ID.test('led-module'));
  assert.equal(MODULE_ID.test('1-led'), false);
  assert.equal(MODULE_ID.test('none'), false, 'a template name is never a module id');
});

test('a wiring pin the resources do not declare is refused', () => {
  const m = led();
  m.wiring.links[0].a = 'esp:GPIO9';
  assert.match(moduleProblem(m) ?? '', /GPIO9.*not declared/);
});

test('a broken example action is refused by name', () => {
  const m = led();
  m.examples[0].run = [{ command: 'nope' }];
  assert.match(moduleProblem(m) ?? '', /unknown command "nope"/);
});

test('a command is held to the plugin rules, not just the examples that call it', () => {
  const m = led();
  m.commands[0].run = [{ op: 'pin.write', args: { pin: 'nope', level: 1 } }];
  assert.match(moduleProblem(m) ?? '', /command led_on: pin "nope" is not declared/);
});
