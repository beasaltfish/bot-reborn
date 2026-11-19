import { describe, expect, it } from 'vitest';
import { setupSteps } from './setup';
import type { Summary } from './types';

const summary: Summary = { id: 'asten', name: 'Asten', ready: true, online: false, motion: 'pet' };
const stepsFor = (current: Summary, board: { characterId: string; screen: string | null; flashedAt: number } | null = null) =>
  setupSteps({ characters: [current], current, board });
const flash = { characterId: 'asten', screen: 'ili9341-ips', flashedAt: 1 };

describe('setupSteps', () => {
  it('keeps all five steps in order and starts with the character', () => {
    const steps = setupSteps({ characters: [], current: null, board: null });
    expect(steps.map((s) => s.id)).toEqual(['character', 'keys', 'body-screen', 'board', 'first-words']);
    expect(steps.every((s) => !s.done)).toBe(true);
  });

  it('counts the character and configured keys, without assuming the body has connected', () => {
    expect(stepsFor(summary)).toEqual([
      { id: 'character', done: true, source: 'brain' },
      { id: 'keys', done: true, source: 'brain' },
      { id: 'body-screen', done: false, source: 'none' },
      { id: 'board', done: false, source: 'none' },
      { id: 'first-words', done: false, source: 'none' },
    ]);
    expect(stepsFor({ ...summary, ready: false })[1]).toMatchObject({ done: false, source: 'brain' });
  });

  it('does not credit another character’s flash', () => {
    const steps = stepsFor(summary, { ...flash, characterId: 'rex' });
    expect(steps.slice(2, 4).map((s) => s.done)).toEqual([false, false]);
  });

  it('credits only this browser for its successful flash', () => {
    expect(stepsFor(summary, flash).slice(2, 4)).toEqual([
      { id: 'body-screen', done: true, source: 'browser' },
      { id: 'board', done: true, source: 'browser' },
    ]);
    expect(stepsFor(summary, { ...flash, screen: null })[3]).toMatchObject({ done: true, source: 'browser' });
  });

  it.each(['none', 'dry-run'] as const)('does not require flashing a %s body', (motion) => {
    expect(stepsFor({ ...summary, motion }, flash)[3]).toMatchObject({ done: false, optionalFor: 'phone' });
  });

  it('prefers this brain’s presence over browser memory and requires its speech evidence', () => {
    const connected = stepsFor({ ...summary, lastSeenAt: 0 }, flash);
    expect(connected[2]).toMatchObject({ done: true, source: 'brain' });
    expect(connected[4]).toMatchObject({ done: false, source: 'none' });
    expect(stepsFor({ ...summary, lastSeenAt: 5, lastSpokeAt: 9 })[4]).toMatchObject({ done: true, source: 'brain' });
  });
});
