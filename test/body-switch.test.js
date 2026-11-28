// The rule that writes a character's body when a module is adopted, tested
// without a brain, a browser dialog or a rendered page: the admin page and the
// brain's adopt route must answer the same question the same way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { adoptModule, switchBody } from '../core/body-switch.js';

import { TEMPLATES, bodyById, bodyProblem, registerPlugins, resolveBody } from '../core/bodies.js';

/** One action, as `core/bodies.js` requires it. */
const a = (/** @type {string} */ name) => ({ name, label: { en: name, zh: name }, say: `${name}.`, run: [] });

/** A module example: an action whose one step calls the module's command. */
const led = (/** @type {string} */ name, /** @type {string} */ command) => ({ ...a(name), run: [{ command }] });

/** A template name, as `Object.hasOwn(TEMPLATES, …)` reads it. */
const only = (/** @type {string[]} */ ...ids) => (/** @type {string} */ id) => ids.includes(id);

/** The body the LED module installs: voice only, plus its own commands. */
const ledBody = () => ({
  ...structuredClone(TEMPLATES.none),
  id: 'led-module',
  template: 'led-module',
  label: { en: 'LED module', zh: 'LED 模块' },
  commands: [
    { name: 'led_on', run: [{ op: 'pin.write', args: { pin: 'led', level: 1 } }], timeoutMs: 500 },
    { name: 'led_off', run: [{ op: 'pin.write', args: { pin: 'led', level: 0 } }], timeoutMs: 500 },
  ],
  resources: [{ kind: 'gpio', name: 'led', gpio: 5, direction: 'output', safe: 0 }],
});

/**
 * `bodyProblem` for the module's body carrying `actions` — the same question
 * the page asks, with triggers judged against the actions that survived.
 * @param {any[]} actions
 * @returns {string | null}
 */
const acceptsLed = (actions) => {
  const body = /** @type {any} */ (bodyById('led-module')) ?? TEMPLATES.none;
  const names = new Set(actions.map((action) => action.name));
  const triggers = (body.triggers ?? []).filter((/** @type {any} */ trigger) => names.has(trigger.action));
  return bodyProblem({ ...body, actions, triggers });
};

test('adopting a module keeps a custom id and merges actions by name', () => {
  const patch = { id: 'my-dog', template: 'pet', actions: [a('sit'), a('move')] };
  const out = adoptModule(patch, 'led-module', patch.actions,
    [a('light_up'), a('move')], (id) => id === 'pet', () => null);
  assert.deepEqual(out.body, {
    template: 'led-module',
    actions: [a('sit'), a('move'), a('light_up')],
  });
  assert.deepEqual(out.dropped, []);
});

test('the example wins when it shares a name with a current action', () => {
  const wanted = { ...a('move'), say: 'the module its own way' };
  const out = adoptModule({}, 'led-module', [a('move')], [wanted], only(), () => null);
  assert.deepEqual(out.body.actions, [wanted]);
});

test('a template id follows the module, a name of one’s own does not', () => {
  const named = adoptModule({ id: 'pet', template: 'pet' }, 'led-module', [], [], only('pet'), () => null);
  assert.deepEqual(named.body, { id: 'led-module', template: 'led-module', actions: [] });
  const mine = adoptModule({ id: 'my-dog', template: 'pet' }, 'led-module', [], [], only('pet'), () => null);
  assert.deepEqual(mine.body, { template: 'led-module', actions: [] });
});

test('a body with nothing to carry writes an empty list, never null', () => {
  const out = adoptModule({ actions: null }, 'led-module', [], [], only(), () => null);
  assert.deepEqual(out.body.actions, []);
  assert.notEqual(out.body.actions, null);
});

test('every other current action survives, in its own order', () => {
  const out = adoptModule({}, 'led-module', [a('sit'), a('spin'), a('bark')],
    [a('light_up')], only(), () => null);
  assert.deepEqual(out.body.actions?.map((x) => x.name), ['sit', 'spin', 'bark', 'light_up']);
});

test('keeps what the module body can run, and names what it cannot', () => {
  registerPlugins({ 'led-module': ledBody() });
  const toy = structuredClone(TEMPLATES.toy.actions);
  const out = adoptModule({ id: 'toy', template: 'toy', actions: toy }, 'led-module', toy,
    [led('light_up', 'led_on'), led('light_down', 'led_off')], only('toy'), acceptsLed);
  // The toy drives; the LED module does not. A sound needs only the voice.
  assert.deepEqual(out.dropped, ['move', 'cruise', 'stop']);
  assert.deepEqual(out.body.actions?.map((x) => x.name), ['play_sound', 'light_up', 'light_down']);
  assert.equal(bodyProblem({ ...ledBody(), actions: out.body.actions, triggers: [] }), null);
  registerPlugins({});
});

test('an example is the module’s own words and is never dropped', () => {
  registerPlugins({ 'led-module': ledBody() });
  // The predicate refuses everything, including the examples' own names.
  const out = adoptModule({}, 'led-module', [a('move')], [a('light_up')], only(), () => 'no');
  assert.deepEqual(out.body.actions?.map((x) => x.name), ['light_up']);
  assert.deepEqual(out.dropped, ['move']);
  registerPlugins({});
});

test('a trigger naming a dropped action is not written back', () => {
  const patch = {
    id: 'toy',
    template: 'toy',
    actions: [a('move'), a('play_sound')],
    triggers: [
      { on: 'shake', action: 'move' },
      { on: 'button', action: 'play_sound' },
    ],
  };
  const out = adoptModule(patch, 'led-module', patch.actions, [], only('toy'),
    (actions) => (actions.some((action) => action.name === 'move') ? 'needs move' : null));
  assert.deepEqual(out.dropped, ['move']);
  // The actions editor reads raw triggers: leaving `move` here would refuse the
  // next edit of a body that is otherwise valid.
  assert.deepEqual(out.body.triggers, [{ on: 'button', action: 'play_sound' }]);
});

test('no trigger list is written when the character had none of its own', () => {
  const out = adoptModule({ actions: [a('sit')], triggers: null }, 'led-module', [a('sit')], [], only(), () => null);
  // `null` means "inherit"; writing `[]` would replace the template's list.
  assert.equal(Object.hasOwn(out.body, 'triggers'), false);
});

/** `bodyProblem` for a template carrying `actions`, as the adopt route asks it. */
const accepts = (/** @type {any} */ body) => (/** @type {any[]} */ actions) => {
  const names = new Set(actions.map((action) => action.name));
  const triggers = (body.triggers ?? []).filter((/** @type {any} */ trigger) => names.has(trigger.action));
  return bodyProblem({ ...body, actions, triggers });
};

test('switching to a template writes null actions, so its own actions apply', () => {
  const out = switchBody({ id: 'none', template: 'none' }, 'pet', [], only('none', 'pet'), accepts(TEMPLATES.pet));
  assert.deepEqual(out.body, { id: 'pet', template: 'pet', actions: null });
  assert.deepEqual(out.dropped, []);
  // Null inherits; an empty list would give the pet no pose to make.
  assert.deepEqual(resolveBody('pet', out.body).actions.map((x) => x.name), ['pose', 'play_sound']);
});

test('a body of one’s own keeps its name when switching to a template', () => {
  const out = switchBody({ id: 'my-dog', template: 'pet' }, 'toy', [], only('pet', 'toy'), accepts(TEMPLATES.toy));
  assert.deepEqual(out.body, { template: 'toy', actions: null });
});

test('own actions the new body can run survive, in their order', () => {
  const current = structuredClone(TEMPLATES.pet.actions);
  const out = switchBody({ id: 'none', template: 'none', actions: current }, 'toy', current,
    only('none', 'pet', 'toy'), accepts(TEMPLATES.toy));
  // A toy has no screen: the pose goes, the sound stays.
  assert.deepEqual(out.dropped, ['pose']);
  assert.deepEqual(out.body.actions?.map((x) => x.name), ['play_sound']);
});

test('a trigger naming a dropped action is not written back on a switch', () => {
  const patch = {
    id: 'pet',
    template: 'pet',
    actions: structuredClone(TEMPLATES.pet.actions),
    triggers: [
      { on: 'button', action: 'pose' },
      { on: 'shake', action: 'play_sound' },
    ],
  };
  const out = switchBody(patch, 'toy', patch.actions, only('pet', 'toy'), accepts(TEMPLATES.toy));
  assert.deepEqual(out.dropped, ['pose']);
  assert.deepEqual(out.body.triggers, [{ on: 'shake', action: 'play_sound' }]);
});

test('a switch with no own actions leaves the template’s triggers alone', () => {
  const out = switchBody({ id: 'none', template: 'none', triggers: [] }, 'tarot', [], only('none', 'tarot'), accepts(TEMPLATES.tarot));
  // Writing [] here would replace tarot’s shake trigger with none.
  assert.equal(Object.hasOwn(out.body, 'triggers'), false);
});
