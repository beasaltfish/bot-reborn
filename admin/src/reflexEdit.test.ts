import { describe, expect, it } from 'vitest';
import { REFLEX_PRESETS } from '../../core/reflex-presets.js';
import { blankQuestion, freshChoice, fromUnsloth, presetIdOf, presetPatch, toUnsloth, unsupported } from './reflexEdit';
import { blankConfig } from './test/fakeApi';
import type { ReflexConfig, ReflexQuestion } from './types';

const LEFT = [{ name: 'move' as const, args: { steps: [{ drive: 'forward', steer: 'left', duration_ms: 600 }] } }];
const Q: ReflexQuestion = {
  name: 'action',
  instructions: 'Is it a move?',
  options: [
    { choice: 'left', description: 'Turn left.', actions: LEFT },
    { choice: 'pass', description: 'Anything else.', actions: [] },
  ],
};
const withQ = (question: ReflexQuestion | null): ReflexConfig => ({ ...blankConfig().reflex, question });

describe('toUnsloth / fromUnsloth', () => {
  it('writes the question the way the decision API and the training data spell it', () => {
    expect(JSON.parse(toUnsloth(Q))).toEqual({
      action: { type: 'choice', instructions: 'Is it a move?', criteria: { left: 'Turn left.', pass: 'Anything else.' } },
    });
  });

  it('reads it back, keeping each choice\'s actions by name', () => {
    const r = fromUnsloth(toUnsloth(Q), Q);
    expect(r).toEqual({ question: Q });
  });

  it('a pasted question with new choices gets them with no actions, and drops gone ones', () => {
    const text = JSON.stringify({ action: { type: 'choice', instructions: 'New?',
      criteria: { right: 'Turn right.', left: 'Turn left!', pass: 'Else.' } } });
    const r = fromUnsloth(text, Q);
    expect(r).toEqual({ question: { name: 'action', instructions: 'New?', options: [
      { choice: 'right', description: 'Turn right.', actions: [] },
      { choice: 'left', description: 'Turn left!', actions: LEFT },
      { choice: 'pass', description: 'Else.', actions: [] },
    ] } });
  });

  it('says what is wrong instead of writing a broken question', () => {
    expect(fromUnsloth('{ not json', Q)).toEqual({ error: 'jsonInvalid' });
    for (const bad of [
      [],
      {},
      { a: {}, b: {} },
      { a: { type: 'noul', instructions: 'x', criteria: { y: 'y', n: 'n' } } },
      { a: { type: 'choice', instructions: 1, criteria: { y: 'y', n: 'n' } } },
      { a: { type: 'choice', instructions: 'x', criteria: { y: 'y' } } },
      { a: { type: 'choice', instructions: 'x', criteria: { y: 'y', n: 2 } } },
    ]) {
      expect(fromUnsloth(JSON.stringify(bad), Q)).toEqual({ error: 'jsonNotChoice' });
    }
  });
});

describe('presets', () => {
  it('names what the config holds: none, a preset untouched, or custom once edited', () => {
    expect(presetIdOf(withQ(null))).toBe('none');
    expect(presetIdOf(withQ(REFLEX_PRESETS[0].question))).toBe('bark');
    expect(presetIdOf(withQ(REFLEX_PRESETS[1].question))).toBe('commands');
    expect(presetIdOf(withQ({ ...REFLEX_PRESETS[1].question, instructions: 'edited' }))).toBe('custom');
  });

  it('picking one copies its question, state and threshold; none turns the reflex off', () => {
    const p = presetPatch('commands');
    expect(p).toEqual({ threshold: REFLEX_PRESETS[1].threshold, state: REFLEX_PRESETS[1].state, question: REFLEX_PRESETS[1].question });
    expect(p.question).not.toBe(REFLEX_PRESETS[1].question);
    expect(presetPatch('none')).toEqual({ question: null });
    expect(presetPatch('custom')).toEqual({});
  });
});

describe('unsupported', () => {
  it('lists the configured kinds this body does not do', () => {
    const r = withQ(REFLEX_PRESETS[1].question);
    expect(unsupported(r, 'car')).toEqual([]);
    expect(unsupported(r, 'dry-run')).toEqual([]);
    expect(unsupported(r, 'none').sort()).toEqual(['cruise', 'move', 'stop']);
    expect(unsupported(withQ(REFLEX_PRESETS[0].question), 'none')).toEqual([]);
    expect(unsupported(withQ(null), 'none')).toEqual([]);
  });
});

describe('new questions and options', () => {
  it('a blank question is already a valid one, and new choices never collide', () => {
    const q = blankQuestion();
    expect(q.options).toHaveLength(2);
    expect(new Set(q.options.map((o) => o.choice)).size).toBe(2);
    const next = freshChoice(q);
    expect(q.options.map((o) => o.choice)).not.toContain(next);
    expect(freshChoice({ ...q, options: [...q.options, { choice: next, description: '', actions: [] }] })).not.toBe(next);
  });
});
