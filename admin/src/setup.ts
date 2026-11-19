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
  // A phone body has no board to flash even when it drives a car; with no
  // marker, the old motion baseline still says which bodies are boardless.
  const phone = current?.bodyKind === 'phone'
    || current?.motion === 'none' || current?.motion === 'dry-run';
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
