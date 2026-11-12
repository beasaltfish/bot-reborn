import test from 'node:test';
import assert from 'node:assert/strict';
import { createLedLabCircuit, evaluateLedLabExperiment } from '../../sim/lessons/led-circuit.js';
import { evaluateLedBench } from '../../sim/electrical/led-bench.js';
import { connectionProgress } from '../../sim/project-progress.js';
import { LED_PROJECT } from '../../sim/projects.js';

test('lab circuit assembles the shared LED project from actual wire steps', () => {
  const circuit = createLedLabCircuit();
  assert.equal(circuit.bench().wires.length, 0);
  assert.equal(evaluateLedBench(circuit.bench(), 'led').state, 'off');
  circuit.connect(2); circuit.connect(0);
  assert.equal(circuit.complete(), false);
  circuit.connect(1);
  assert.equal(circuit.complete(), true);
  assert.equal(evaluateLedBench(circuit.bench(), 'led').state, 'on');
  assert.ok(connectionProgress(circuit.bench(), LED_PROJECT).every(link => link.status === 'complete'));
  circuit.connect(1);
  assert.equal(circuit.bench().wires.length, 3, 'repeat click must not duplicate a wire');
});

test('experiment uses the workbench circuit evaluator and shared fault codes', () => {
  for (const [options, state, fault] of [
    [{ voltage: 5, resistance: 220, reversed: false }, 'on', null],
    [{ voltage: 5, resistance: 220, reversed: true }, 'reversed', 'led-reversed'],
    [{ voltage: 5, resistance: 0, reversed: false }, 'overcurrent', 'led-overcurrent'],
  ]) {
    const experiment = evaluateLedLabExperiment(/** @type {{voltage:number,resistance:number,reversed:boolean}} */ (options));
    assert.equal(experiment.outcome.state, state);
    assert.equal(evaluateLedBench(experiment.bench, 'led').state, state);
    if (fault) assert.ok(experiment.faults.some(item => item.code === fault));
  }
});

test('lab wiring state is isolated and can be reset', () => {
  const first = createLedLabCircuit(), second = createLedLabCircuit();
  first.connect(0);
  assert.equal(second.bench().wires.length, 0);
  first.reset();
  assert.equal(first.bench().wires.length, 0);
  assert.equal(first.complete(), false);
  assert.throws(() => first.connect(99), RangeError);
});
