import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_KEY, STICKY, REFLEX_TOOLS, defaultConfig, loadConfig, saveConfig, resetSticky, layerReady,
  reflexReady, reflexMissing, normalizeReflex, DEFAULT_STATE } from '../core/config.js';
import { buildSystemPrompt } from '../core/brain.js';
import { resolveBody } from '../core/bodies.js';

/** A localStorage stand-in. The real one is not available in node, and every
 * function under test takes it as a parameter for exactly this reason. */
function fakeStorage(/** @type {Record<string, string>} */ initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (/** @type {string} */ k) => (m.has(k) ? m.get(k) ?? null : null),
    setItem: (/** @type {string} */ k, /** @type {string} */ v) =>
      void m.set(k, String(v)),
  };
}

test('defaults are the ones spec §8.2 fixed', () => {
  const d = defaultConfig('en-US');
  assert.equal(d.lang, 'en');
  // null ≠ lang. "No preference recorded" and "prefers the UI language" are
  // different things, and the default must be the former (§11.1).
  assert.equal(d.replyLang, null);
  // Measured by waiting item ⑥, not guessed (§8.2).
  assert.equal(d.bargeIn, true);
  assert.equal(d.ttsPath, 'webaudio');
  // Off: turning the screen on is already the robot being called (2026-09-27).
  assert.equal(d.wakeWord, false);
});

test('a stored wakeWord of true survives the read, and an old config gets the default', () => {
  const on = loadConfig(fakeStorage({ [CONFIG_KEY]: JSON.stringify({ wakeWord: true }) }));
  assert.equal(on.wakeWord, true);
  const old = loadConfig(fakeStorage({ [CONFIG_KEY]: JSON.stringify({ bargeIn: false }) }));
  assert.equal(old.wakeWord, false);
});

test('lang is English whatever the handset says', () => {
  // Inferred from navigator.language until 2026-09-17. It was changed because
  // this is an open-source project: the default has to be the language its
  // readers share, and inferring one from the phone made the source's default
  // and the running default two different things. The zh table is still there
  // and still complete; the switcher that reaches it arrives with i18n.
  assert.equal(defaultConfig('zh-CN').lang, 'en');
  assert.equal(defaultConfig('zh').lang, 'en');
  assert.equal(defaultConfig('fr-FR').lang, 'en');
  assert.equal(defaultConfig(undefined).lang, 'en');
});

test('preferences sit flat beside the three layers, not nested (§8.2)', () => {
  const d = defaultConfig('en');
  assert.ok(!('providers' in d) && !('prefs' in d));
  assert.deepEqual(Object.keys(d.tts).sort(),
    ['apiKey', 'baseURL', 'model', 'voice']);
});

test('a config saved before the preference fields existed still reads back', () => {
  // This is the whole argument for flat-plus-a-field: an old config is just
  // missing keys, so `?? default` covers it. No version number, no migration.
  const old = { stt: { baseURL: 'a', apiKey: 'b', model: 'c' } };
  const storage = fakeStorage({ [CONFIG_KEY]: JSON.stringify(old) });
  const cfg = loadConfig(storage);
  assert.equal(cfg.stt.baseURL, 'a');
  assert.equal(cfg.llm.baseURL, '');
  assert.equal(cfg.bargeIn, true);
  assert.equal(cfg.ttsPath, 'webaudio');
  assert.equal(cfg.replyLang, null);
  // Saved before stt.prompt existed: it reads back empty, which sends none.
  assert.equal(cfg.stt.prompt, '');
});

test('stt.prompt is empty by default, and a stored one survives the read', () => {
  assert.equal(defaultConfig().stt.prompt, '');
  const storage = fakeStorage({
    [CONFIG_KEY]: JSON.stringify({ stt: { baseURL: 'a', apiKey: 'b', model: 'c', prompt: 'p' } }),
  });
  assert.equal(loadConfig(storage).stt.prompt, 'p');
});

test('an stt layer without a prompt is still ready', () => {
  // The prompt is optional. Requiring it would mark every existing setup as
  // unconfigured the moment this field shipped.
  assert.equal(layerReady({ baseURL: 'a', apiKey: 'b', model: 'c', prompt: '' }), true);
});

test('a stored bargeIn of false survives the read', () => {
  // `||` would turn it back into true here; `??` is required. The user who
  // most needs this flag remembered is the one whose device failed calibration.
  const storage = fakeStorage({
    [CONFIG_KEY]: JSON.stringify({ bargeIn: false, ttsPath: 'speechSynthesis' }),
  });
  const cfg = loadConfig(storage);
  assert.equal(cfg.bargeIn, false);
  assert.equal(cfg.ttsPath, 'speechSynthesis');
});

test('unreadable storage yields defaults rather than throwing', () => {
  assert.equal(loadConfig(fakeStorage({ [CONFIG_KEY]: 'not json' })).bargeIn, true);
  assert.equal(loadConfig(undefined).bargeIn, true);
});

test('save then load round-trips every field', () => {
  const storage = fakeStorage();
  /** @type {import('../core/config.js').Config} */
  const cfg = { ...defaultConfig(), lang: 'zh', replyLang: 'en', bargeIn: false };
  cfg.tts.voice = 'alloy';
  saveConfig(cfg, storage);
  assert.deepEqual(loadConfig(storage), cfg);
});

test('resetSticky clears exactly the two states the user cannot otherwise see', () => {
  assert.deepEqual([...STICKY], ['ttsPath', 'replyLang']);
  /** @type {import('../core/config.js').Config} */
  // lang set explicitly, not asked of defaultConfig: since 2026-09-17 that
  // returns 'en' whatever it is handed, and asserting the reset kept 'en' when
  // 'en' is also the default would pass without testing anything.
  const cfg = {
    ...defaultConfig(), lang: 'zh', replyLang: 'en', ttsPath: 'speechSynthesis',
  };
  cfg.llm.apiKey = 'keep me';
  const reset = resetSticky(cfg);
  assert.equal(reset.replyLang, null);
  assert.equal(reset.ttsPath, 'webaudio');
  assert.equal(reset.llm.apiKey, 'keep me');
  assert.equal(reset.lang, 'zh', 'lang is a visible setting, not sticky state');
});

// --- calibration ----------------------------------------------------------

test('calibration starts as "never measured", which is null and not false', () => {
  // false is a measurement result — "I checked, it is not reversed". Writing it
  // as the default would make the checklist tick itself on a car nobody has
  // touched, and the one step that stops the car driving the wrong way is
  // exactly the step people skip.
  const d = defaultConfig();
  assert.equal(d.calibration.steerSwapped, null);
  assert.equal(d.calibration.driveSwapped, null);
  assert.equal(d.calibration.bytesPerMs, null);
});

test('calibration survives a save and load', () => {
  const storage = fakeStorage();
  const cfg = { ...defaultConfig() };
  cfg.calibration = { steerSwapped: true, driveSwapped: false, bytesPerMs: 0.42 };
  saveConfig(cfg, storage);
  assert.deepEqual(
    loadConfig(storage).calibration,
    { steerSwapped: true, driveSwapped: false, bytesPerMs: 0.42 },
  );
});

test('a config saved when only ① existed loads ①b as "never measured"', () => {
  // The real migration: anybody who calibrated before today has a stored
  // calibration object with steerSwapped in it and no driveSwapped. The spread
  // has to reach inside the object, not just supply it when it is absent
  // altogether — otherwise driveSwapped reads undefined, which is neither
  // null nor a measurement, and the checklist compares it against null.
  const storage = fakeStorage();
  const old = { ...defaultConfig(), calibration: { steerSwapped: true, bytesPerMs: null } };
  storage.setItem(CONFIG_KEY, JSON.stringify(old));
  assert.equal(loadConfig(storage).calibration.driveSwapped, null);
  assert.equal(loadConfig(storage).calibration.steerSwapped, true);
});

test('a config saved before calibration existed still loads', () => {
  // Anybody who used this before today has a stored object with no calibration
  // key at all. Reading undefined.steerSwapped would throw on startup and the
  // product would not open — for a field whose whole meaning is "not measured".
  const storage = fakeStorage();
  const old = { ...defaultConfig() };
  delete (/** @type {any} */ (old).calibration);
  storage.setItem(CONFIG_KEY, JSON.stringify(old));
  assert.deepEqual(
    loadConfig(storage).calibration,
    { steerSwapped: null, driveSwapped: null, bytesPerMs: null },
  );
});

const LAYER = { baseURL: 'http://192.168.3.47:8888/v1', apiKey: 'k', model: 'jev-latest' };
const QUESTION = {
  name: 'action',
  instructions: 'Is it a move?',
  options: [
    { choice: 'left', description: 'Turn left.', actions: [{ name: 'move', args: { steps: [{ drive: 'forward', steer: 'left', duration_ms: 600 }] } }] },
    { choice: 'pass', description: 'Anything else.', actions: [] },
  ],
};

test('persona: empty by default, a stored string kept, anything else empty', () => {
  assert.equal(defaultConfig().persona, '');
  const read = (/** @type {unknown} */ persona) => loadConfig(fakeStorage({ [CONFIG_KEY]: JSON.stringify({ persona }) })).persona;
  assert.equal(read('一块面包板'), '一块面包板');
  assert.equal(read(42), '');
  assert.equal(loadConfig(fakeStorage({ [CONFIG_KEY]: '{}' })).persona, '');
});

test('reflex is off by default: no layer and no question', () => {
  const d = defaultConfig();
  assert.deepEqual(d.reflex, {
    baseURL: '', apiKey: '', model: '', enabled: true, threshold: 0.8, state: DEFAULT_STATE, question: null,
  });
  assert.equal(DEFAULT_STATE, 'Robot said: "{robot}"\nPerson said: "{person}"');
  assert.equal(reflexReady(d.reflex), false);
});

test('a config saved before the question existed loads with the reflex off', () => {
  // Configurable reflex spec §2.3: three connection fields and no question is
  // today's 小黑 — off until the admin picks a preset.
  const storage = fakeStorage({ [CONFIG_KEY]: JSON.stringify({ reflex: LAYER }) });
  const r = loadConfig(storage).reflex;
  assert.equal(layerReady(r), true);
  assert.equal(r.question, null);
  assert.equal(reflexReady(r), false);
});

test('a stored reflex with a question survives the read, and is on', () => {
  const reflex = { ...LAYER, enabled: true, threshold: 0.6, state: 'Person said: {person}', question: QUESTION };
  const r = loadConfig(fakeStorage({ [CONFIG_KEY]: JSON.stringify({ reflex }) })).reflex;
  assert.deepEqual(r, reflex);
  assert.equal(reflexReady(r), true);
});

test('a reflex switched off keeps its question and does not run', () => {
  const reflex = { ...LAYER, enabled: false, question: QUESTION };
  const r = loadConfig(fakeStorage({ [CONFIG_KEY]: JSON.stringify({ reflex }) })).reflex;
  assert.equal(r.enabled, false);
  assert.deepEqual(r.question, QUESTION);
  assert.equal(reflexReady(r), false);
  assert.deepEqual(reflexMissing(r), []);
});

test('normalizeReflex: a reflex saved before the switch existed is on', () => {
  assert.equal(normalizeReflex({ ...LAYER, question: QUESTION }).enabled, true);
  assert.equal(normalizeReflex({ enabled: 'no' }).enabled, true);
});

test('reflexMissing names what the reflex still needs, in page order', () => {
  assert.deepEqual(reflexMissing(defaultConfig().reflex), ['baseURL', 'apiKey', 'model', 'question']);
  assert.deepEqual(reflexMissing({ ...defaultConfig().reflex, ...LAYER }), ['question']);
  assert.deepEqual(reflexMissing({ ...defaultConfig().reflex, ...LAYER, apiKey: '', question: /** @type {any} */ (QUESTION) }), ['apiKey']);
});

test('normalizeReflex: bad threshold and state fall back to the defaults', () => {
  for (const threshold of [-0.1, 1.1, '0.5', NaN, null]) {
    assert.equal(normalizeReflex({ threshold }).threshold, 0.8, String(threshold));
  }
  assert.equal(normalizeReflex({ threshold: 0 }).threshold, 0);
  assert.equal(normalizeReflex({ threshold: 1 }).threshold, 1);
  assert.equal(normalizeReflex({ state: 'no placeholder' }).state, DEFAULT_STATE);
  assert.equal(normalizeReflex({ state: 42 }).state, DEFAULT_STATE);
});

test('normalizeReflex: a question needs a name, instructions and two good options', () => {
  assert.equal(normalizeReflex({ question: { ...QUESTION, name: '' } }).question, null);
  assert.equal(normalizeReflex({ question: { ...QUESTION, instructions: 3 } }).question, null);
  assert.equal(normalizeReflex({ question: { ...QUESTION, options: 'x' } }).question, null);
  assert.equal(normalizeReflex({ question: { ...QUESTION, options: [QUESTION.options[0]] } }).question, null);
  assert.equal(normalizeReflex({ question: 'action' }).question, null);
});

test('a reflex option may carry a pose action, which survives the read', () => {
  const q = normalizeReflex({ question: { ...QUESTION, options: [
    { choice: 'sit', description: 'Sit down.', actions: [
      { name: 'pose', args: { name: 'sit' } },
      { name: 'play_sound', args: { name: 'bark' } },
    ] },
    QUESTION.options[1],
  ] } }).question;
  assert.deepEqual(q?.options[0].actions, [
    { name: 'pose', args: { name: 'sit' } },
    { name: 'play_sound', args: { name: 'bark' } },
  ]);
});

test('normalizeReflex: bad options and bad actions are dropped one by one', () => {
  const q = normalizeReflex({ question: { ...QUESTION, options: [
    ...QUESTION.options,
    { choice: 'left', description: 'duplicate', actions: [] },
    { choice: '', description: 'empty', actions: [] },
    { choice: 'right', description: 7, actions: [] },
    { choice: 'stop', description: 'Stop.', actions: [
      { name: 'stop', args: {} },
      // Survives: the parse layer only checks shape. `set_reply_language`
      // writes config and is not an action, but whether the body can do a
      // thing is a trigger-time question, not one this layer can answer.
      { name: 'set_reply_language', args: { lang: 'en' } },
      { name: 'move', args: [] },
      'stop',
    ] },
    { choice: 'odd', description: 'no actions array', actions: 'stop' },
  ] } }).question;
  assert.deepEqual(q?.options.map((o) => o.choice), ['left', 'pass', 'stop', 'odd']);
  assert.deepEqual(q?.options[2].actions, [
    { name: 'stop', args: {} },
    { name: 'set_reply_language', args: { lang: 'en' } },
  ]);
  assert.deepEqual(q?.options[3].actions, []);
});

test('a saved reflex keeps an action this body cannot do', () => {
  // The body is not known at parse time, and an action is not illegal just
  // because the five templates do not carry it: a person's own body may.
  // "Can this body do it" is decided when the reflex fires, against the
  // resolved body's actions, and the editor says so. Dropping it here would
  // lose the configuration for good when the user switches body and back.
  const actions = [{ name: 'wag', args: { times: 2 } }];
  const reflex = { ...LAYER, question: { ...QUESTION, options: [
    { ...QUESTION.options[0], actions },
    QUESTION.options[1],
  ] } };
  const r = loadConfig(fakeStorage({ [CONFIG_KEY]: JSON.stringify({ reflex }) })).reflex;
  assert.deepEqual(r.question?.options[0].actions, actions);
});

test('a reflex may call every action a body can carry out, and draw_card', () => {
  assert.ok(REFLEX_TOOLS.includes('draw_card'));
  assert.ok(REFLEX_TOOLS.includes('pose'));
});

test('a new character has no body worth speaking of', () => {
  // Nothing is picked yet. A brand-new character is not a car by accident:
  // the admin asks, and until it answers there are no wheels to promise.
  assert.deepEqual(defaultConfig().body, { id: 'none' });
});

test('a file with no body key at all is still a toy', () => {
  // Every character written before this field existed was a car. The two
  // cases differ on purpose: absent means "the old default", `none` is a
  // choice somebody made (or a fresh character).
  const old = loadConfig(fakeStorage({ [CONFIG_KEY]: JSON.stringify({ wakeWord: true }) }));
  assert.deepEqual(old.body, { id: 'toy' });
});

test('a stored body.id survives the read', () => {
  for (const id of ['toy', 'dry-run', 'none', 'pet', 'tarot']) {
    const c = loadConfig(fakeStorage({ [CONFIG_KEY]: JSON.stringify({ body: { id } }) }));
    assert.equal(c.body.id, id);
  }
});

test('the body that drives kept its old id readable', () => {
  /** @param {any} body */
  const load = (body) => loadConfig(fakeStorage({ [CONFIG_KEY]: JSON.stringify({ body }) }));
  assert.equal(load({ id: 'car' }).body.id, 'toy', 'a file saved before the rename');
  assert.equal(load({ motion: 'car' }).body.id, 'toy', 'a file saved before the field was renamed');
  assert.equal(load({ id: 'toy' }).body.id, 'toy');
});

test('an old body.motion becomes body.id, and the old key is gone', () => {
  const saved = { name: 'A', body: { motion: 'pet' } };
  const c = loadConfig(fakeStorage({ [CONFIG_KEY]: JSON.stringify(saved) }));
  assert.equal(c.body.id, 'pet');
  // The default file written before this field was renamed: same five names.
  assert.equal('motion' in c.body, false);
  // An id wins over a leftover motion, so a half-migrated file is not a trap.
  const both = loadConfig(fakeStorage({ [CONFIG_KEY]: JSON.stringify({ body: { id: 'tarot', motion: 'pet' } }) }));
  assert.equal(both.body.id, 'tarot');
});

test('an unknown id falls to none, and does not throw', () => {
  // A hand-edited file with a typo must not claim wheels. `none` is the body
  // that promises nothing, and the id is still readable enough to be fixed.
  for (const body of [{ id: 'Car' }, { id: 'dryrun' }, { id: 42 }, { id: null }, { id: '' }, { motion: 'bogus' }]) {
    const c = loadConfig(fakeStorage({ [CONFIG_KEY]: JSON.stringify({ body }) }));
    assert.equal(c.body.id, 'none', `body ${JSON.stringify(body)}`);
  }
  const notObject = loadConfig(fakeStorage({ [CONFIG_KEY]: JSON.stringify({ body: 'car' }) }));
  assert.equal(notObject.body.id, 'none');
});

test('a known body keeps its id and the rest of the patch', () => {
  // The stored value is the patch, not a resolved body: no template is
  // flattened in, and no key the file did not have is invented.
  const body = {
    id: 'pet',
    template: 'pet',
    label: { en: 'Rex', zh: '雷克斯' },
    prompts: { rules: ['Only a dog.'] },
    triggers: [{ on: 'button', action: 'pose' }],
  };
  const c = loadConfig(fakeStorage({ [CONFIG_KEY]: JSON.stringify({ body: { ...body, wheels: true } }) }));
  assert.deepEqual(c.body, body);
});

test('a malformed prompts patch is dropped, and the template\'s own words apply', () => {
  // `prompts.rules` is joined by buildSystemPrompt, so a string here would
  // throw inside the prompt and read from outside as an LLM failure. Load
  // catches it: one bad field costs that field, not the character.
  const c = loadConfig(fakeStorage({ [CONFIG_KEY]: JSON.stringify({
    body: { id: 'toy', prompts: { rules: 'text' } },
  }) }));
  assert.equal(c.body.id, 'toy');
  assert.equal('prompts' in c.body, false, 'the malformed key is gone, not passed on');
  const body = resolveBody(c.body.id, c.body);
  assert.doesNotThrow(() => buildSystemPrompt({ replyLang: null, body }));
  assert.match(buildSystemPrompt({ replyLang: null, body }), /Your reply is read aloud/);

  // Both halves are checked the same way: an empty voice is no voice, and a
  // rules list with a non-string in it is not a list of rules.
  for (const prompts of [{ voice: '' }, { voice: 7 }, { rules: ['ok', 3] }, { rules: [] , voice: ' ' }, 'x']) {
    const bad = loadConfig(fakeStorage({ [CONFIG_KEY]: JSON.stringify({ body: { id: 'toy', prompts } }) }));
    assert.equal('prompts' in bad.body, false, JSON.stringify(prompts));
  }
});

test('the page\'s "use the template" sends actions: null, which reads as inherited', () => {
  // A PATCH merges and cannot drop a key, so the admin removes the override by
  // sending null. It is not an actions list, so the next read drops it and the
  // template's own actions apply again; an emptied trigger list stays explicit.
  const c = loadConfig(fakeStorage({ [CONFIG_KEY]: JSON.stringify({
    body: { id: 'toy', actions: null, triggers: [] },
  }) }));
  assert.equal('actions' in c.body, false);
  assert.deepEqual(c.body.triggers, []);
  assert.deepEqual(resolveBody(c.body.id, c.body).actions.map((a) => a.name), ['move', 'cruise', 'stop', 'play_sound']);
});

test('a body that carries actions is kept as written, id included', () => {
  // A body of one's own is told apart by carrying actions (or by naming the
  // template it copied), not by its id, so an id the templates do not know is
  // not a typo in this case. The admin reads the id back, so rewriting it to
  // `none` made a user body show as "Voice only".
  const actions = [{
    name: 'pose',
    label: { en: 'Pose', zh: '做个动作' },
    say: 'Sit.',
    args: { type: 'object', properties: { name: { enum: ['sit'] } } },
    run: [{ verb: 'pose', args: { pose: '$name' } }],
  }];
  const body = { id: 'my-dog', template: 'pet', label: { en: 'My dog', zh: '我的狗' }, actions };
  const c = loadConfig(fakeStorage({ [CONFIG_KEY]: JSON.stringify({ body }) }));
  assert.equal(c.body.id, 'my-dog');
  assert.deepEqual(c.body.actions, actions);
  assert.equal(c.body.template, 'pet');
  assert.deepEqual(c.body.label, body.label);

  // An id with no actions and no template is still a typo, not a body.
  const typo = loadConfig(fakeStorage({ [CONFIG_KEY]: JSON.stringify({ body: { id: 'my-dog' } }) }));
  assert.equal(typo.body.id, 'none');

  // Through the real pair, not just the read: what saveConfig writes is what
  // loadConfig reads back, the whole body as the user wrote it.
  const store = fakeStorage();
  saveConfig(/** @type {any} */ ({ ...defaultConfig(), body }), store);
  assert.deepEqual(loadConfig(store).body, c.body, 'the same body after a save and a load');
});
