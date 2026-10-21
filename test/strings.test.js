import test from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, KEYWORDS, t } from '../core/strings.js';

test('the keyword is the one spec §5.5 fixed, and it is language-independent', () => {
  assert.deepEqual(KEYWORDS, ['hey steven']);
});

test('no fixed line may contain a keyword (spec §6.8)', () => {
  // Fixed lines are read aloud by TTS. A line that says the wake word would
  // have the robot wake itself the moment it reads that line.
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
  assert.equal(t('zh', 'apiFailed'), STRINGS.zh.apiFailed);
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
    'didNotCatch', 'apiFailed', 'deviceDisconnected',
    'sessionTimedOut',
    'fabStart', 'fabBrain', 'fabPair', 'fabSteer', 'fabStop',
    'micOn', 'micOff', 'settings', 'install', 'close', 'sayThis',
    'stepBrain', 'stepCar', 'stepSteer',
    'calTitle', 'calIntro', 'calGo', 'calAsk', 'calLeft', 'calRight',
    'calDriveIntro', 'calDriveAsk', 'calForward', 'calBack',
    'calAgain', 'calDone', 'calNoCar',
    'emergencyStop', 'booting', 'micDenied',
    'usbNotPaired', 'pairNow', 'needsTap',
    'brainHow', 'linkLost', 'insecure',
    'rejectToken', 'rejectBusy', 'rejectUnconfigured', 'rejectProtocol', 'rejectOrigin',
    'settingsBrain', 'settingsBrainLinked', 'settingsForgetBrain',
    'stSleeping', 'stListening', 'stCapturing', 'stThinking', 'stSpeaking',
  ]);
  for (const key of needed) {
    for (const lang of /** @type {const} */ (['en', 'zh'])) {
      assert.ok(STRINGS[lang][key], `STRINGS.${lang}.${key} is missing`);
    }
  }
});

