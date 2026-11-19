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
  // A flash belongs to the pairing it went with. When this brain can name the
  // generation, an old ID-only record (or one from before a token changed) is
  // not evidence; an older brain without setup ids still matches by id.
  const flashed = !!current && board?.characterId === current.id
    && (current.setupId == null || board?.setupId === current.setupId);
  const seen = current?.lastSeenAt != null;
  const spoke = current?.lastSpokeAt != null;
  // Only the hello marker says a phone is on the other end. Motion cannot: a
  // phone driving a car and a board driving the same car look identical until
  // one of them connects, so guessing would label the wrong step.
  const phone = current?.bodyKind === 'phone';
  // Flashing comes before connecting: a board has to be flashed to join at all.
  return [
    { id: 'character', done: characters.length > 0, source: 'brain' },
    { id: 'keys', done: current?.ready === true, source: current ? 'brain' : 'none' },
    phone
      ? { id: 'board', done: false, source: 'none', optionalFor: 'phone' }
      : { id: 'board', done: flashed, source: flashed ? 'browser' : 'none' },
    { id: 'body-screen', done: seen || flashed, source: seen ? 'brain' : flashed ? 'browser' : 'none' },
    { id: 'first-words', done: spoke, source: spoke ? 'brain' : 'none' },
  ];
}
