import test from 'node:test';
import assert from 'node:assert/strict';

import { planById } from '../../sim/plan.js';

test('a demo that talks to a character declares a body connection', () => {
  for (const id of ['audio', 'screen', 'toy', 'tarot']) assert.equal(planById(id)?.connection, 'body', id);
});

test('a device-only project declares no connection', () => {
  for (const id of ['led-basics', 'power-a-rail', 'bme280-readings', 'button-led']) assert.equal(planById(id)?.connection, null, id);
});
