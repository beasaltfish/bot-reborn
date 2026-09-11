import test from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, KEYWORDS, t } from '../web/strings.js';

test('the two keywords are the ones spec §5.5 fixed, and they are language-independent', () => {
  assert.deepEqual(KEYWORDS, ['hey steven', 'all stop']);
});

test('no fixed line may contain a keyword (spec §6.8)', () => {
  // Fixed lines bypass the LLM, so the system prompt's forbidden-word
  // injection cannot reach them. If a line ever says "all stop", the robot
  // triggers its own emergency stop the moment it reads that line aloud.
  for (const [lang, table] of Object.entries(STRINGS)) {
    for (const [key, value] of Object.entries(table)) {
      for (const keyword of KEYWORDS) {
        assert.ok(
          !value.toLowerCase().includes(keyword),
          `STRINGS.${lang}.${key} contains the keyword "${keyword}": ${value}`,
        );
      }
      // The wake word is a coined name; guard the bare name too, not just the phrase.
      assert.ok(
        !value.toLowerCase().includes('steven'),
        `STRINGS.${lang}.${key} contains the wake word: ${value}`,
      );
    }
  }
});

test('en and zh define exactly the same keys', () => {
  assert.deepEqual(Object.keys(STRINGS.en).sort(), Object.keys(STRINGS.zh).sort());
});

test('t() falls back to the key rather than rendering undefined', () => {
  assert.equal(t('zh', 'usbNotConnected'), STRINGS.zh.usbNotConnected);
  assert.equal(t('zh', 'noSuchKey'), 'noSuchKey');
});
