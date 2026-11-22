import { describe, expect, test } from 'vitest';
import { adoptModule } from './bodySwitch';
import type { BodyAction } from './types';

/** One action, as `core/bodies.js` requires it. */
const a = (name: string): BodyAction => ({
  name,
  label: { en: name, zh: name },
  say: `${name}.`,
  run: [],
});

/** A template name, as the page's `Object.hasOwn(TEMPLATES, …)` reads it. */
const only = (...ids: string[]) => (id: string) => ids.includes(id);

describe('adoptModule', () => {
  test('adopting a module keeps a custom id and merges actions by name', () => {
    const patch = { id: 'my-dog', template: 'pet', actions: [a('sit'), a('move')] };
    const out = adoptModule(patch, 'led-module', patch.actions as BodyAction[],
      [a('light_up'), a('move')], (id) => id === 'pet');
    expect(out.body).toEqual({
      template: 'led-module',
      actions: [a('sit'), a('move'), a('light_up')],
    });
  });

  test('the example wins when it shares a name with a current action', () => {
    const wanted = { ...a('move'), say: 'the module its own way' };
    const out = adoptModule({}, 'led-module', [a('move')], [wanted], only());
    expect(out.body.actions).toEqual([wanted]);
  });

  test('a template id follows the module, a name of one’s own does not', () => {
    const named = adoptModule({ id: 'pet', template: 'pet' }, 'led-module', [], [], only('pet'));
    expect(named.body).toEqual({ id: 'led-module', template: 'led-module', actions: [] });
    const mine = adoptModule({ id: 'my-dog', template: 'pet' }, 'led-module', [], [], only('pet'));
    expect(mine.body).toEqual({ template: 'led-module', actions: [] });
  });

  test('a body with nothing to carry writes an empty list, never null', () => {
    const out = adoptModule({ actions: null }, 'led-module', [], [], only());
    expect(out.body.actions).toEqual([]);
    // `null` is the wire form of "inherit", which would put the old body back.
    expect(out.body.actions).not.toBeNull();
  });

  test('every other current action survives, in its own order', () => {
    const out = adoptModule({}, 'led-module', [a('sit'), a('spin'), a('bark')],
      [a('light_up')], only());
    expect(out.body.actions?.map((x) => x.name)).toEqual(['sit', 'spin', 'bark', 'light_up']);
  });
});
