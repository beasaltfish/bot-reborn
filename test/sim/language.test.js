import test from 'node:test';
import assert from 'node:assert/strict';
import { simulatorLanguage, requestLanguageChange } from '../../sim/ui/language.js';

test('simulator language accepts the shared saved language and defaults safely', () => {
  assert.equal(simulatorLanguage('zh'), 'zh');
  assert.equal(simulatorLanguage('en'), 'en');
  for (const value of [null, '', 'zh-CN', 'invalid']) assert.equal(simulatorLanguage(value), 'en');
});

test('language changes never reload if cancelled or storage rejects the preference', () => {
  /** @type {string[]} */ const events = [];
  assert.equal(requestLanguageChange('zh', { confirm: () => false, save: () => events.push('save'), reload: () => events.push('reload') }), false);
  assert.equal(events.length, 0);
  assert.equal(requestLanguageChange('zh', { confirm: () => true, save: () => { throw Error('blocked'); }, reload: () => events.push('reload') }), false);
  assert.equal(events.length, 0);
  assert.equal(requestLanguageChange('zh', { confirm: () => true, save: lang => events.push(`save:${lang}`), reload: () => events.push('reload') }), true);
  assert.deepEqual(events, ['save:zh', 'reload']);
});
