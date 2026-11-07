import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createShakeDetector, SHAKE } from '../core/shake-detector.js';

const cases = JSON.parse(readFileSync(new URL('../firmware/test/shake-cases.json', import.meta.url), 'utf8'));

for (const c of cases) {
  test(`shake detector: ${c.name}`, () => {
    const d = createShakeDetector();
    const fired = [];
    for (const [ms, level] of c.samples) if (d.feed(level, ms)) fired.push(ms);
    assert.deepEqual(fired, c.fires);
  });
}

test('the numbers are the spec\'s', () => {
  assert.deepEqual(SHAKE, { MOVING: 0.15, ARM_MS: 500, GAP_MS: 150, STILL_MS: 800, CAP_MS: 6000 });
});
