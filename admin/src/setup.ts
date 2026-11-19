import type { BoardMemory } from './boardMemory';
import type { Summary } from './types';

export type StepId = 'character' | 'keys' | 'body-screen' | 'board' | 'first-words';
export type StepSource = 'brain' | 'browser' | 'none';
export interface Step { id: StepId; done: boolean; source: StepSource; optionalFor?: 'phone' }

export function setupSteps({ characters, current, board }: {
  characters: Summary[];
  current: Summary | null;
  board: BoardMemory | null;
}): Step[] {
  const flashed = !!current && board?.characterId === current.id;
  const seen = current?.lastSeenAt != null;
  const spoke = current?.lastSpokeAt != null;
  const phone = current?.motion === 'none' || current?.motion === 'dry-run';
  return [
    { id: 'character', done: characters.length > 0, source: 'brain' },
    { id: 'keys', done: current?.ready === true, source: current ? 'brain' : 'none' },
    { id: 'body-screen', done: seen || flashed, source: seen ? 'brain' : flashed ? 'browser' : 'none' },
    phone
      ? { id: 'board', done: false, source: 'none', optionalFor: 'phone' }
      : { id: 'board', done: flashed, source: flashed ? 'browser' : 'none' },
    { id: 'first-words', done: spoke, source: spoke ? 'brain' : 'none' },
  ];
}
