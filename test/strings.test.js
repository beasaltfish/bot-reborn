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
  // The cast is the point: reaching this fallback now takes deliberate effort,
  // because an ordinary misspelling no longer typechecks.
  assert.equal(t('zh', /** @type {any} */ ('noSuchKey')), 'noSuchKey');
});

test('every string the UI needs exists in both languages', () => {
  // Hand-written rather than derived from STRINGS.en, on purpose: deriving it
  // would make the test agree with whatever the table happens to say, and a key
  // deleted in both languages would pass. appTitle / start / stopBtn left this
  // list on 2026-09-17 when the main screen became one robot and one button.

  const needed = /** @type {(keyof typeof STRINGS.en)[]} */ ([
    'usbNotConnected', 'didNotCatch', 'apiFailed', 'deviceDisconnected',
    'sessionTimedOut',
    'fabStart', 'fabKeys', 'fabPair', 'fabSteer', 'fabStop',
    'micOn', 'micOff', 'settings', 'install', 'close', 'sayThis',
    'stepKeys', 'stepCar', 'stepSteer',
    'calTitle', 'calIntro', 'calGo', 'calAsk', 'calLeft', 'calRight',
    'calDriveIntro', 'calDriveAsk', 'calForward', 'calBack',
    'calAgain', 'calDone', 'calNoCar',
    'emergencyStop', 'booting', 'micDenied',
    'keywordsInvalid', 'usbNotPaired', 'pairNow', 'needsTap',
    'settingsWakeWord', 'settingsWakeWordOff',
    'stSleeping', 'stListening', 'stCapturing', 'stThinking', 'stSpeaking',
  ]);
  for (const key of needed) {
    for (const lang of /** @type {const} */ (['en', 'zh'])) {
      assert.ok(STRINGS[lang][key], `STRINGS.${lang}.${key} is missing`);
    }
  }
});

