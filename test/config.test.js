import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_KEY, STICKY, defaultConfig, loadConfig, saveConfig, resetSticky }
  from '../web/config.js';

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
  /** @type {import('../web/config.js').Config} */
  const cfg = { ...defaultConfig(), lang: 'zh', replyLang: 'en', bargeIn: false };
  cfg.tts.voice = 'alloy';
  saveConfig(cfg, storage);
  assert.deepEqual(loadConfig(storage), cfg);
});

test('resetSticky clears exactly the two states the user cannot otherwise see', () => {
  assert.deepEqual([...STICKY], ['ttsPath', 'replyLang']);
  /** @type {import('../web/config.js').Config} */
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
