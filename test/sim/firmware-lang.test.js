import test from 'node:test';
import assert from 'node:assert/strict';

import { tokenize } from '../../sim/firmware/lang/lexer.js';

test('tokenizes comments, strings and positions', () => {
  const tokens = tokenize('// hi\nint x = 1; /* ok */ Serial.println("a b");');
  assert.equal(tokens[0].value, 'int');
  assert.equal(tokens[0].kind, 'keyword');
  assert.equal(tokens[0].line, 2);
  const string = tokens.find((t) => t.kind === 'string');
  assert.ok(string);
  assert.equal(string.value, 'a b');
  assert.equal(tokens.at(-1)?.kind, 'eof');
});

test('reports an unterminated string', () => {
  assert.throws(() => tokenize('Serial.println("oops);'), /unterminated string/);
});

test('recognizes multi-character operators and member access', () => {
  const values = tokenize('if (a == b && c != d) c = c + 1; Serial.println("x");').map((t) => t.value);
  assert.ok(values.includes('==') && values.includes('&&') && values.includes('!='));
  assert.ok(values.includes('.'));
});

test('tokenizes decimals and rejects unknown characters with a line', () => {
  assert.equal(tokenize('float x = 3.3;')[3].kind, 'number');
  assert.throws(() => tokenize('int x = 1;\n@'), /line 2/);
});

import { compile } from '../../sim/firmware/lang/index.js';

test('parses setup, loop, if/else, while, for and calls', () => {
  const { program, errors } = compile('void setup(){ pinMode(4, INPUT); } void loop(){ if (digitalRead(4) == LOW) { digitalWrite(5, HIGH); } else { digitalWrite(5, LOW); } }');
  assert.deepEqual(errors, []);
  assert.ok(program.setup && program.loop);
});

test('accepts a C-shaped for with assignment increment', () => {
  const { errors } = compile('void loop(){ for (int i = 0; i < 3; i = i + 1) { Serial.println("x"); } }');
  assert.deepEqual(errors, []);
});

test('reports a missing semicolon with a line', () => {
  const { errors } = compile('void loop(){ digitalWrite(5, HIGH) }');
  assert.equal(errors[0].line, 1);
  assert.match(errors[0].message, /;/);
});

test('rejects ++ and compound assignment', () => {
  assert.ok(compile('void loop(){ int i = 0; i++; }').errors.length > 0);
});

test('an empty source compiles to an empty program', () => {
  const { program, errors } = compile('');
  assert.deepEqual(errors, []);
  assert.equal(program.setup, null);
  assert.equal(program.loop, null);
});

import { createMachine } from '../../sim/firmware/lang/index.js';

function fakeCtx() {
  /** @type {[string, string][]} */ const written = [];
  /** @type {string[]} */ const logs = [];
  return {
    written, logs,
    /** @param {string} name @param {string} level */
    pin: (name, level) => written.push([name, level]),
    /** @param {number} pin */
    read: (pin) => (pin === 4 ? 'LOW' : 'HIGH'),
    /** @param {string} line */
    log: (line) => logs.push(line),
    measure() {}, device() {},
  };
}

test('setup runs once and loop runs per tick', () => {
  const { program } = compile('void setup(){ pinMode(4, INPUT); } void loop(){ digitalWrite(5, HIGH); }');
  const m = createMachine({ program });
  const ctx = fakeCtx();
  m.start();
  m.tick(ctx); // setup only
  m.tick(ctx); // first loop
  assert.deepEqual(ctx.written.filter(([n]) => n === 'GPIO5').map(([, l]) => l), ['high']);
  m.tick(ctx); // second loop
  assert.deepEqual(ctx.written.filter(([n]) => n === 'GPIO5').map(([, l]) => l), ['high', 'high']);
});

test('if/read/log write the expected trace lines', () => {
  const { program } = compile('void loop(){ if (digitalRead(4) == LOW) { digitalWrite(5, HIGH); Serial.println("pressed"); } }');
  const m = createMachine({ program }); const ctx = fakeCtx(); m.start();
  m.tick(ctx); // setup
  const records = m.tick(ctx);
  assert.ok(records.some((r) => r.line === 1 && r.kind === 'statement'));
  assert.deepEqual(ctx.logs, ['pressed']);
});

test('variables and for loops execute in order', () => {
  const { program } = compile('void loop(){ int n = 0; for (int i = 0; i < 3; i = i + 1) { n = n + 1; } Serial.println(n); }');
  const ctx = fakeCtx(); const m = createMachine({ program }); m.start();
  m.tick(ctx); // setup
  m.tick(ctx);
  assert.deepEqual(ctx.logs, ['3']);
});

/** A wall clock that advances a little on every read, so a budget exhausts. */
function advancingClock(step = 0.01) { let t = 0; return () => (t += step); }

test('delay(60000) in setup does not trip the setup watchdog', () => {
  const { program } = compile('void setup(){ delay(60000); Serial.println("done"); } void loop(){}');
  const m = createMachine({ program }); m.start();
  const ctx = fakeCtx();
  for (let i = 0; i < 600; i++) m.tick(ctx);
  assert.ok(m.phase === 'setup' || m.phase === 'waiting');
  m.tick(ctx);
  assert.equal(m.phase, 'loop');
  assert.deepEqual(ctx.logs, ['done']);
});

test('a setup that never returns stops at 300 progress ticks', () => {
  const { program } = compile('void setup(){ while(1){} } void loop(){}');
  const m = createMachine({ program, now: advancingClock() }); m.start(); const ctx = fakeCtx();
  for (let i = 0; i < 300; i++) m.tick(ctx);
  assert.equal(m.phase, 'stopped');
  assert.ok(m.lastError?.includes('setup did not finish'));
});

test('an empty while loop is progress and stops at 600 progress ticks', () => {
  const { program } = compile('void loop(){ digitalWrite(5, HIGH); while(1){} }');
  const m = createMachine({ program, now: advancingClock() }); m.start(); const ctx = fakeCtx();
  for (let i = 0; i < 601; i++) m.tick(ctx);
  assert.equal(m.phase, 'stopped');
  assert.ok(m.lastError?.includes('loop did not finish'));
  assert.ok(ctx.written.some(([, level]) => level === 'high-z'));
});

test('while(1){delay(100);} also accumulates progress and stops', () => {
  const { program } = compile('void loop(){ while(1){ delay(100); } }');
  const m = createMachine({ program, now: advancingClock() }); m.start(); const ctx = fakeCtx();
  for (let i = 0; i < 1301; i++) m.tick(ctx);
  assert.equal(m.phase, 'stopped');
});

test('a long loop yields at the budget and resumes at the same statement', () => {
  const { program } = compile('void loop(){ for (int i = 0; i < 100; i = i + 1) { Serial.println(i); } }');
  const m = createMachine({ program, now: advancingClock(0.1), budgetMs: 6 }); m.start();
  const ctx = fakeCtx();
  m.tick(ctx); // setup
  m.tick(ctx); // budget exhausts inside the loop
  const first = ctx.logs.length;
  assert.ok(first > 0 && first < 100);
  m.tick(ctx);
  assert.ok(ctx.logs.length > first);
});

test('a half-line print flushes capped at 512 chars', () => {
  const { program } = compile(`void loop(){ Serial.print("${'x'.repeat(600)}"); Serial.println(""); }`);
  const m = createMachine({ program, now: advancingClock() }); m.start(); const ctx = fakeCtx();
  m.tick(ctx); // setup
  m.tick(ctx);
  assert.ok(ctx.logs.length > 0);
  assert.ok(ctx.logs.every((line) => line.length <= 512));
});
