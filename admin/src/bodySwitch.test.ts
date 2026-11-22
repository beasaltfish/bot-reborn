import { afterEach, describe, expect, test } from 'vitest';
import { TEMPLATES, bodyById, bodyProblem, registerPlugins } from '../../core/bodies.js';
import { adoptModule } from './bodySwitch';
import type { BodyAction } from './types';

/** One action, as `core/bodies.js` requires it. */
const a = (name: string): BodyAction => ({
  name,
  label: { en: name, zh: name },
  say: `${name}.`,
  run: [],
});

/** A module example: an action whose one step calls the module's command. */
const led = (name: string, command: string): BodyAction => ({ ...a(name), run: [{ command }] });

/** A template name, as the page's `Object.hasOwn(TEMPLATES, …)` reads it. */
const only = (...ids: string[]) => (id: string) => ids.includes(id);

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
 * `BodyTab` asks, with triggers judged against the actions that survived.
 */
const acceptsLed = (actions: BodyAction[]): string | null => {
  const body = bodyById('led-module') ?? TEMPLATES.none;
  const names = new Set(actions.map((action) => action.name));
  const triggers = (body.triggers ?? []).filter((trigger) => names.has(trigger.action));
  return bodyProblem({ ...body, actions, triggers });
};

afterEach(() => {
  // The plugin registry is process-wide: a later test starts with no module.
  registerPlugins({});
});

describe('adoptModule', () => {
  test('adopting a module keeps a custom id and merges actions by name', () => {
    const patch = { id: 'my-dog', template: 'pet', actions: [a('sit'), a('move')] };
    const out = adoptModule(patch, 'led-module', patch.actions as BodyAction[],
      [a('light_up'), a('move')], (id) => id === 'pet', () => null);
    expect(out.body).toEqual({
      template: 'led-module',
      actions: [a('sit'), a('move'), a('light_up')],
    });
    expect(out.dropped).toEqual([]);
  });

  test('the example wins when it shares a name with a current action', () => {
    const wanted = { ...a('move'), say: 'the module its own way' };
    const out = adoptModule({}, 'led-module', [a('move')], [wanted], only(), () => null);
    expect(out.body.actions).toEqual([wanted]);
  });

  test('a template id follows the module, a name of one’s own does not', () => {
    const named = adoptModule({ id: 'pet', template: 'pet' }, 'led-module', [], [], only('pet'), () => null);
    expect(named.body).toEqual({ id: 'led-module', template: 'led-module', actions: [] });
    const mine = adoptModule({ id: 'my-dog', template: 'pet' }, 'led-module', [], [], only('pet'), () => null);
    expect(mine.body).toEqual({ template: 'led-module', actions: [] });
  });

  test('a body with nothing to carry writes an empty list, never null', () => {
    const out = adoptModule({ actions: null }, 'led-module', [], [], only(), () => null);
    expect(out.body.actions).toEqual([]);
    // `null` is the wire form of "inherit", which would put the old body back.
    expect(out.body.actions).not.toBeNull();
  });

  test('every other current action survives, in its own order', () => {
    const out = adoptModule({}, 'led-module', [a('sit'), a('spin'), a('bark')],
      [a('light_up')], only(), () => null);
    expect(out.body.actions?.map((x) => x.name)).toEqual(['sit', 'spin', 'bark', 'light_up']);
  });

  test('keeps what the module body can run, and names what it cannot', () => {
    registerPlugins({ 'led-module': ledBody() });
    const toy = structuredClone(TEMPLATES.toy.actions) as BodyAction[];
    const out = adoptModule({ id: 'toy', template: 'toy', actions: toy }, 'led-module', toy,
      [led('light_up', 'led_on'), led('light_down', 'led_off')], only('toy'), acceptsLed);
    // The toy drives; the LED module does not. A sound needs only the voice.
    expect(out.dropped).toEqual(['move', 'cruise', 'stop']);
    expect(out.body.actions?.map((x) => x.name)).toEqual(['play_sound', 'light_up', 'light_down']);
    expect(bodyProblem({ ...ledBody(), actions: out.body.actions, triggers: [] })).toBeNull();
  });

  test('an example is the module’s own words and is never dropped', () => {
    registerPlugins({ 'led-module': ledBody() });
    // The predicate refuses everything, including the examples' own names.
    const out = adoptModule({}, 'led-module', [a('move')], [a('light_up')], only(), () => 'no');
    expect(out.body.actions?.map((x) => x.name)).toEqual(['light_up']);
    expect(out.dropped).toEqual(['move']);
  });
});
