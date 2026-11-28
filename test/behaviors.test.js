// Local behaviors are a closed rule set: one trigger, commands only, bounded.
// These tests keep a manifest from loading a rule the runtime cannot execute.

import test from 'node:test';
import assert from 'node:assert/strict';
import { behaviorProblem, behaviorsProblem, BEHAVIOR_LIMIT } from '../core/behaviors.js';

const resources = [
  { kind: 'gpio', name: 'button', gpio: 4, direction: 'input' },
  { kind: 'gpio', name: 'led', gpio: 5, direction: 'output', safe: 0 },
];
const commands = [{ name: 'led_on' }, { name: 'led_off' }];

test('a level rule on an input is accepted', () => {
  assert.equal(behaviorProblem({ on: { resource: 'button', level: 'low' }, run: [{ command: 'led_on' }] }, { resources, commands }), null);
});

test('an edge rule on an input is accepted', () => {
  assert.equal(behaviorProblem({ on: { resource: 'button', edge: 'down' }, run: [{ command: 'led_on' }] }, { resources, commands }), null);
});

test('a rule naming an output resource is refused', () => {
  assert.match(behaviorProblem({ on: { resource: 'led', level: 'low' }, run: [{ command: 'led_on' }] }, { resources, commands }) ?? '', /input/);
});

test('a rule naming an unknown resource is refused', () => {
  assert.match(behaviorProblem({ on: { resource: 'nope', level: 'low' }, run: [{ command: 'led_on' }] }, { resources, commands }) ?? '', /no resource/);
});

test('a rule naming an unknown command is refused', () => {
  assert.match(behaviorProblem({ on: { resource: 'button', level: 'low' }, run: [{ command: 'nope' }] }, { resources, commands }) ?? '', /nope/);
});

test('a returning command is refused in v1', () => {
  assert.match(
    behaviorProblem({ on: { resource: 'button', edge: 'down' }, run: [{ command: 'read' }] },
      { resources, commands: [...commands, { name: 'read', returns: true }] }) ?? '',
    /returns/,
  );
});

test('everyMs has no resource and is at least 50', () => {
  assert.equal(behaviorProblem({ on: { everyMs: 100 }, run: [{ command: 'led_on' }] }, { resources, commands }), null);
  assert.match(behaviorProblem({ on: { everyMs: 10 }, run: [{ command: 'led_on' }] }, { resources, commands }) ?? '', /50/);
});

test('a trigger is exactly one of level, edge or everyMs', () => {
  assert.match(behaviorProblem({ on: { resource: 'button' }, run: [{ command: 'led_on' }] }, { resources, commands }) ?? '', /exactly one/);
  assert.match(behaviorProblem({ on: { resource: 'button', level: 'low', edge: 'down' }, run: [{ command: 'led_on' }] }, { resources, commands }) ?? '', /exactly one/);
  assert.match(behaviorProblem({ on: { resource: 'button', everyMs: 100 }, run: [{ command: 'led_on' }] }, { resources, commands }) ?? '', /not both/);
});

test('a behavior runs at least one command, and no arguments yet', () => {
  assert.match(behaviorProblem({ on: { resource: 'button', level: 'low' }, run: [] }, { resources, commands }) ?? '', /at least one/);
  assert.match(behaviorProblem({ on: { resource: 'button', level: 'low' }, run: [{ command: 'led_on', args: {} }] }, { resources, commands }) ?? '', /no arguments/);
});

test('sixteen rules are the limit', () => {
  const rules = Array.from({ length: BEHAVIOR_LIMIT + 1 }, () => ({ on: { resource: 'button', level: 'low' }, run: [{ command: 'led_on' }] }));
  assert.match(behaviorsProblem(rules, { resources, commands }) ?? '', /16/);
});

test('an absent behavior list is not a problem', () => {
  assert.equal(behaviorsProblem(undefined, { resources, commands }), null);
});
