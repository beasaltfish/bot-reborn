import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BODIES, BODY_IDS, CAN_DO, TEMPLATES, TEMPLATE_IDS, bodyById, bodyProblem,
  labelOf, resolveBody,
} from '../core/bodies.js';

/** The parts a way asks for, in order. A need is `{ part }`, not a bare string,
 * because the wand is a part that is optional. */
const parts = (/** @type {{ needs: { part: string }[] }} */ way) => way.needs.map((n) => n.part);

/** A body written by hand, to be broken one field at a time. */
const row = () => structuredClone(TEMPLATES.pet);

test('the five templates exist, with unique ids and a preview each', () => {
  assert.deepEqual(TEMPLATE_IDS, ['none', 'pet', 'tarot', 'dry-run', 'toy']);
  for (const body of BODIES) {
    assert.equal(bodyProblem(body), null, body.id);
    assert.ok(body.label.en && body.label.zh, body.id);
    assert.ok(body.preview, body.id);
  }
  assert.equal(bodyById('pet')?.actions.some((a) => a.name === 'pose'), true);
  assert.equal(bodyById('nope'), undefined);
});

test('five templates say what today says: same actions, same names', () => {
  assert.deepEqual(TEMPLATES.toy.actions.map((a) => a.name), ['move', 'cruise', 'stop', 'play_sound']);
  assert.deepEqual(TEMPLATES.pet.actions.map((a) => a.name), ['pose', 'play_sound']);
  assert.deepEqual(TEMPLATES.tarot.actions.map((a) => a.name), ['draw_card']);
  assert.deepEqual(TEMPLATES.none.actions.map((a) => a.name), ['play_sound']);
  assert.deepEqual(TEMPLATES['dry-run'].actions.map((a) => a.name), TEMPLATES.toy.actions.map((a) => a.name));
});

test('an action without its capability is refused', () => {
  assert.match(bodyProblem({ ...row(), capabilities: ['hear', 'speak'] }) ?? '', /show/);
});

test('draw needs a screen, not a wand', () => {
  assert.equal(TEMPLATES.tarot.capabilities.includes(/** @type {any} */ ('sense')), false);
  assert.match(bodyProblem({ ...structuredClone(TEMPLATES.tarot), capabilities: ['hear', 'speak'] }) ?? '', /show/);
  const tarot = bodyById('tarot');
  const wand = tarot?.ways[0].needs.find((n) => n.part === 'wand');
  assert.equal(wand?.optional, true, 'the wand is optional: the screen is what a draw needs');
});

test('a body with a pose action and a draw action is refused', () => {
  // One screen, one surface: the pet's animator and the tarot's would fight
  // over the same display, so a body may have one or the other.
  const both = {
    ...structuredClone(TEMPLATES.toy),
    capabilities: /** @type {any} */ (['hear', 'speak', 'show']),
    actions: [structuredClone(TEMPLATES.pet.actions[0]), structuredClone(TEMPLATES.tarot.actions[0])],
  };
  assert.match(bodyProblem(both) ?? '', /one screen|both pose and draw/);
});

test('an action name must be one the model could call, and only once', () => {
  const body = row();
  assert.match(bodyProblem({ ...body, actions: [{ ...body.actions[1], name: 'Play Sound' }] }) ?? '', /Play Sound/);
  assert.match(bodyProblem({ ...body, actions: [body.actions[1], structuredClone(body.actions[1])] }) ?? '', /play_sound/);
});

test('a trigger has to name an action the body actually has', () => {
  const tarot = structuredClone(TEMPLATES.tarot);
  assert.deepEqual(tarot.triggers, [{ on: 'shake', action: 'draw_card' }]);
  assert.match(
    bodyProblem({ ...tarot, actions: [], triggers: [{ on: 'shake', action: 'draw_card' }] }) ?? '',
    /draw_card/,
  );
});

test('a copied tarot body can shed the shake that no longer has an action', () => {
  // The trigger follows the template's action. Replacing that action must not
  // leave a body permanently invalid with no way to remove the trigger.
  const pose = structuredClone(TEMPLATES.pet.actions[0]);
  assert.deepEqual(resolveBody('copy').triggers, undefined);
  assert.deepEqual(resolveBody('mine', { template: 'tarot' }).triggers, [{ on: 'shake', action: 'draw_card' }]);
  const mine = resolveBody('mine', { template: 'tarot', actions: [pose] });
  assert.equal(mine.triggers, undefined);
  assert.equal(bodyProblem(mine), null);

  // A trigger the person declares survives when its action does.
  const own = resolveBody('mine', {
    template: 'pet',
    actions: [structuredClone(TEMPLATES.tarot.actions[0])],
    triggers: [{ on: 'shake', action: 'draw_card' }],
  });
  assert.deepEqual(own.triggers, [{ on: 'shake', action: 'draw_card' }]);
  assert.equal(bodyProblem(own), null);

  // And one that names nothing the body has is dropped, not carried along.
  const dropped = resolveBody('mine', {
    template: 'pet',
    triggers: [{ on: 'shake', action: 'draw_card' }],
  });
  assert.equal(dropped.triggers, undefined);
});

test('the prompt and reply are data the body has to carry', () => {
  const pet = row();
  assert.match(bodyProblem({ ...pet, prompts: {} }) ?? '', /voice prompt/);
  assert.match(bodyProblem({ ...pet, prompts: { voice: '', rules: [] } }) ?? '', /voice prompt/);
  assert.match(bodyProblem({ ...pet, prompts: { voice: 'hi', rules: 'text' } }) ?? '', /list of strings/);
  assert.match(bodyProblem({ ...pet, prompts: { voice: 'hi', rules: ['ok', 3] } }) ?? '', /list of strings/);
  assert.match(bodyProblem({ ...pet, reply: 'voice' }) ?? '', /tts/);
  assert.equal(bodyProblem({ ...pet, reply: 'clips', prompts: { voice: 'hi', rules: [] } }), null);
});

test('a capability nobody implements is refused, not ignored', () => {
  assert.match(bodyProblem({ ...row(), capabilities: /** @type {any} */ (['telepathy']) }) ?? '', /telepathy/);
  assert.match(
    bodyProblem({ ...row(), capabilities: /** @type {any} */ (['hear', 'speak', 'show', 'telepathy']) }) ?? '',
    /telepathy/,
  );
});

test('the five templates say how a reply is carried and which one is hidden', () => {
  const reply = Object.fromEntries(BODIES.map((b) => [b.id, b.reply]));
  assert.deepEqual(reply, {
    none: 'tts',
    pet: 'clips',
    tarot: 'tts',
    'dry-run': 'tts',
    toy: 'tts',
  });
  // Task 8 depends on exactly one hidden template being the dry run.
  assert.deepEqual(BODIES.filter((b) => b.hidden).map((b) => b.id), ['dry-run']);
  for (const b of BODIES) assert.equal('still' in b.prompts, false, b.id);
});

test('a board way needs firmware and a phone way must not have one', () => {
  const base = { ...row(), ways: [], firmware: null, actions: [] };
  assert.match(bodyProblem({ ...base, ways: [{ source: 'board', needs: [] }], firmware: null }) ?? '', /firmware/);
  assert.match(bodyProblem({ ...base, ways: [{ source: 'phone', needs: [] }], firmware: 'body' }) ?? '', /firmware/);
  assert.equal(bodyProblem({ ...base, ways: [{ source: 'phone', needs: [] }], firmware: null }), null);
  // A body reachable both ways is flashed for one of them and not the other.
  assert.equal(bodyProblem({
    ...base,
    ways: [{ source: 'board', needs: [] }, { source: 'phone', needs: [] }],
    firmware: 'body.bin',
  }), null);
});

test('a body may be reached more than one way, and each way says what it needs', () => {
  const toy = bodyById('toy');
  assert.deepEqual(toy?.ways.map((w) => w.source), ['board']);
  assert.ok(parts(/** @type {any} */ (toy?.ways[0])).includes('toy'), 'the toy is the thing being driven');
  assert.ok(parts(/** @type {any} */ (toy?.ways[0])).includes('mic'), 'a board needs ears to hear the order');
  assert.deepEqual(bodyById('pet')?.ways.map((w) => w.source), ['board']);
  // Every board body hears and speaks, so every board list has a mic and an amp.
  for (const b of BODIES) {
    for (const w of b.ways.filter((x) => x.source === 'board')) {
      assert.ok(parts(w).includes('mic') && parts(w).includes('amp'), b.id);
    }
  }

  // Two bodies on the same board, two different bills of materials.
  const voice = bodyById('none');
  assert.deepEqual(voice?.ways.map((w) => w.source), ['board']);
  assert.ok(parts(/** @type {any} */ (voice?.ways[0])).includes('mic'), 'a board voice-only body needs a microphone');
});

// The phone page still works, but it is not offered as a way to get a body
// until the ESP32 path is settled: one body, one way, one thing to explain.
test('no body offers the phone while the ESP32 path is being settled', () => {
  for (const b of BODIES) {
    assert.ok(!b.ways.some((w) => w.source === 'phone'), b.id);
  }
  // A dry run still has no hardware at all; everything else is a board build.
  assert.deepEqual(bodyById('dry-run')?.ways.map((w) => w.source), ['none']);
});

test('a way nobody can follow is refused', () => {
  const base = { ...row(), ways: [], firmware: null, actions: [] };
  assert.match(bodyProblem({ ...base, ways: [] }) ?? '', /way/);
  assert.match(bodyProblem({ ...base, ways: [{ source: 'telepathy', needs: [] }] }) ?? '', /telepathy/);
  assert.match(bodyProblem({ ...base, ways: [{ source: 'phone', needs: [{ part: 'unobtainium' }] }] }) ?? '', /unobtainium/);
});

test('what a body senses with is in the list of things it needs', () => {
  const tarot = bodyById('tarot');
  assert.ok(tarot, 'tarot is one of the five');
  const needs = tarot.ways.flatMap(parts);
  assert.ok(needs.includes('wand'), 'a tarot reader senses with the MPU-6050 wand');
});

test('the driving body is a toy with wheels, not a category called car', () => {
  const toy = bodyById('toy');
  assert.equal(toy?.label.en, 'Toy on wheels');
  assert.equal(toy?.label.zh, '会动的玩具');
  // The parts a buyer shops for, not a chip number: the model lives in docs/hardware.md.
  assert.deepEqual(parts(/** @type {any} */ (toy?.ways[0])), ['toy', 'board', 'mic', 'amp']);
});

test('a voice-only body does not borrow the phone\'s face', () => {
  const voice = bodyById('none');
  assert.deepEqual(voice?.capabilities, ['hear', 'speak']);
  assert.equal(voice?.label.en, 'Voice only');
});

test('the label is the reader\'s language', () => {
  assert.equal(labelOf(bodyById('pet') ?? BODIES[0], 'en'), 'Pet on a screen');
  assert.equal(labelOf(bodyById('pet') ?? BODIES[0], 'zh'), '屏幕宠物');
});

// The table replaces CAN_DO, so it has to say exactly what CAN_DO said. A
// tarot reader draws and nothing else: it has no wheels and it does not pose,
// and what it says is the robot's audio, which is not a tool call.
test('the actions are the ones the bodies already carry out', () => {
  const actions = Object.fromEntries(BODIES.map((b) => [b.id, b.actions.map((a) => a.name)]));
  assert.deepEqual(actions, {
    toy: ['move', 'cruise', 'stop', 'play_sound'],
    pet: ['pose', 'play_sound'],
    tarot: ['draw_card'],
    'dry-run': ['move', 'cruise', 'stop', 'play_sound'],
    none: ['play_sound'],
  });
});

// The one view the rest of the app kept asking for: a body id to the actions
// it carries out. Derived, so it cannot drift from the table above. The legacy
// kind (`sound`, `draw`) rides along until Task 6 / Task 8 stop comparing it.
test('CAN_DO is the table, keyed by body id', () => {
  assert.deepEqual(CAN_DO.tarot, ['draw_card', 'draw']);
  assert.deepEqual(CAN_DO.toy, ['move', 'cruise', 'stop', 'play_sound', 'sound']);
  assert.deepEqual(Object.keys(CAN_DO).sort(), [...TEMPLATE_IDS].sort());
});

test('a user copy resolves to its template until it carries actions', () => {
  const copy = resolveBody('mine', { template: 'pet' });
  assert.equal(copy.id, 'mine');
  assert.equal(copy.template, 'pet');
  assert.deepEqual(copy.label, { en: 'Pet on a screen', zh: '屏幕宠物' });
  assert.deepEqual(copy.actions.map((a) => a.name), ['pose', 'play_sound']);

  // A renamed copy still follows the template's prompts.
  const named = resolveBody('mine', { template: 'pet', label: { en: 'Rex', zh: '雷克斯' } });
  assert.deepEqual(named.prompts, TEMPLATES.pet.prompts);
  assert.deepEqual(named.label, { en: 'Rex', zh: '雷克斯' });

  // Carrying its own actions is what makes it a body of its own.
  const own = resolveBody('mine', {
    template: 'pet',
    actions: [{
      name: 'nod',
      label: { en: 'Nod', zh: '点头' },
      say: 'Nod once, as if agreeing.',
      args: { type: 'object', properties: {} },
      run: [{ verb: 'pose', args: { pose: 'sit' } }],
    }],
  });
  assert.deepEqual(own.actions.map((a) => a.name), ['nod']);
  assert.equal(bodyProblem(own), null);
});

test('an id nobody knows falls back to the voice-only template', () => {
  const lost = resolveBody('nope');
  assert.equal(lost.template, 'none');
  assert.deepEqual(lost.actions.map((a) => a.name), ['play_sound']);
});

test('a resolved body owns its actions: editing one does not edit the template', () => {
  const mine = resolveBody('toy');
  // A copy is the point: the admin hands the person this object to edit.
  const steps = /** @type {any} */ (mine.actions[0].args).properties.steps;
  steps.maxItems = 1;
  assert.equal(/** @type {any} */ (TEMPLATES.toy.actions[0].args).properties.steps.maxItems, 5);
});
