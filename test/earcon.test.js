import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EARCONS, SHAPES, durationOf } from '../web/audio/earcon.js';

test('the vocabulary is exactly the five spec §5.6 fixed', () => {
  assert.deepEqual([...EARCONS], ['wake', 'done', 'sleep', 'huh', 'error']);
  assert.deepEqual(Object.keys(SHAPES).sort(), [...EARCONS].sort());
});

test('brain.js only ever asks for names that exist', () => {
  // brain.js calls earcon('done' | 'error' | 'huh'); session.js adds the other
  // two. A sixth name appearing here would mean someone reopened §5.6's
  // decision that three kinds of failure share one sound.
  const src = readFileSync(new URL('../web/brain.js', import.meta.url), 'utf8');
  for (const m of src.matchAll(/#earcon\('([a-z]+)'\)/g)) {
    assert.ok(/** @type {readonly string[]} */ (EARCONS).includes(m[1]),
      `brain.js asks for an unknown earcon: ${m[1]}`);
  }
});

test('every earcon is short enough to hard-unsubscribe through', () => {
  // §5.6: the whole pipeline is gated for the duration. A long earcon would be
  // a window in which the emergency stop word cannot be heard.
  for (const name of EARCONS) {
    const ms = durationOf(name);
    assert.ok(ms > 0 && ms <= 250, `${name} lasts ${ms} ms`);
  }
});

test('the wake earcon fits inside the 80 ms §5.6 budgets for the gate', () => {
  // Not a comfort margin. The gate drops VAD frames, and the wake earcon fires
  // at the one moment the user is most likely already talking — "hey steven
  // 往前走" in one breath. Those frames carry the head of 「往」, the same head
  // §5.5 refused to discard by clearing the buffer. Lengthen this and it is
  // lost through the other door, just as silently.
  assert.ok(durationOf('wake') <= 80, `wake lasts ${durationOf('wake')} ms`);
});

test('the two-tone shapes really have two tones, and they point opposite ways', () => {
  assert.equal(SHAPES.wake.length, 2);
  assert.ok(SHAPES.wake[1].f > SHAPES.wake[0].f);
  assert.equal(SHAPES.error.length, 2);
  assert.ok(SHAPES.error[0].f <= 250);
  assert.ok(SHAPES.sleep[0].to < SHAPES.sleep[0].f);
});
