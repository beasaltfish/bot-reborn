import { describe, expect, it } from 'vitest';
import { setupSteps } from './setup';
import type { Summary } from './types';

const summary: Summary = { id: 'asten', name: 'Asten', ready: true, online: false, motion: 'pet', setupId: 'gen-1' };
const stepsFor = (current: Summary, board: { characterId: string; setupId?: string; screen: string | null; flashedAt: number } | null = null) =>
  setupSteps({ characters: [current], current, board });
const flash = { characterId: 'asten', setupId: 'gen-1', screen: 'ili9341-ips', flashedAt: 1 };

describe('setupSteps', () => {
  it('keeps all five steps in order and starts with the character', () => {
    const steps = setupSteps({ characters: [], current: null, board: null });
    expect(steps.map((s) => s.id)).toEqual(['character', 'keys', 'board', 'body-screen', 'first-words']);
    expect(steps.every((s) => !s.done)).toBe(true);
  });

  it('counts the character and configured keys, without assuming the body has connected', () => {
    expect(stepsFor(summary)).toEqual([
      { id: 'character', done: true, source: 'brain' },
      { id: 'keys', done: true, source: 'brain' },
      { id: 'board', done: false, source: 'none' },
      { id: 'body-screen', done: false, source: 'none' },
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
      { id: 'board', done: true, source: 'browser' },
      { id: 'body-screen', done: true, source: 'browser' },
    ]);
    expect(stepsFor(summary, { ...flash, screen: null }).find((s) => s.id === 'body-screen')).toMatchObject({ done: true, source: 'browser' });
  });

  it('does not require a board once the body has said it is a phone', () => {
    const phone = stepsFor({ ...summary, motion: 'car', bodyKind: 'phone' }, flash);
    expect(phone.find((s) => s.id === 'board')).toEqual({ id: 'board', done: false, source: 'none', optionalFor: 'phone' });
  });

  it('a body that needs no board skips the flash, because the body is a choice', () => {
    for (const motion of ['none', 'dry-run'] as const) {
      const steps = stepsFor({ ...summary, motion }, null);
      expect(steps.find((s) => s.id === 'board')).toEqual({ id: 'board', done: false, source: 'none', optionalFor: 'phone' });
    }
  });

  it('a car still asks for the flash until a phone says it is the body', () => {
    // A car can be either, so the card cannot skip the board on the user's behalf.
    expect(stepsFor({ ...summary, motion: 'car' }, null).find((s) => s.id === 'board')).toMatchObject({ done: false });
    expect(stepsFor({ ...summary, motion: 'car' }, flash).find((s) => s.id === 'board')).toMatchObject({ done: true });
  });

  it('does not credit a flash from before the pairing token changed', () => {
    const rotated = stepsFor(summary, { ...flash, setupId: 'gen-0' });
    expect(rotated.slice(2, 4).map((s) => s.done)).toEqual([false, false]);
  });

  it('does not trust an ID-only old flash when this brain has a setupId', () => {
    const old = { characterId: 'asten', screen: 'ili9341-ips', flashedAt: 1 };
    expect(stepsFor(summary, old).slice(2, 4).map((s) => s.done)).toEqual([false, false]);
  });

  it('prefers this brain’s presence over browser memory and requires its speech evidence', () => {
    const connected = stepsFor({ ...summary, lastSeenAt: 0 }, flash);
    expect(connected.find((s) => s.id === 'body-screen')).toMatchObject({ done: true, source: 'brain' });
    expect(connected[4]).toMatchObject({ done: false, source: 'none' });
    expect(stepsFor({ ...summary, lastSeenAt: 5, lastSpokeAt: 9 })[4]).toMatchObject({ done: true, source: 'brain' });
  });
});
