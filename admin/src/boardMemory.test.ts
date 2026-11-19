import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readBoardMemory, rememberBoard } from './boardMemory';

describe('board memory', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips what this browser flashed', () => {
    rememberBoard({ characterId: 'asten', screen: 'ili9341-ips', flashedAt: 7 });
    expect(readBoardMemory()).toEqual({ characterId: 'asten', screen: 'ili9341-ips', flashedAt: 7 });
  });

  it('keeps a flash whose panel is unknown as null, never a guess', () => {
    rememberBoard({ characterId: 'asten', screen: null, flashedAt: 7 });
    expect(readBoardMemory()).toEqual({ characterId: 'asten', screen: null, flashedAt: 7 });
  });

  it('ignores junk and blocked storage instead of throwing', () => {
    localStorage.setItem('botreborn.adminBoard', '{oops');
    expect(readBoardMemory()).toBeNull();
    localStorage.setItem('botreborn.adminBoard', JSON.stringify({ characterId: 3 }));
    expect(readBoardMemory()).toBeNull();
  });

  it('rejects a record that names a panel this build does not know', () => {
    localStorage.setItem('botreborn.adminBoard', JSON.stringify({ characterId: 'asten', screen: 'not-a-panel', flashedAt: 7 }));
    expect(readBoardMemory()).toBeNull();
  });

  it('rejects a record without a character or a finite flash time', () => {
    localStorage.setItem('botreborn.adminBoard', JSON.stringify({ characterId: '', screen: null, flashedAt: 7 }));
    expect(readBoardMemory()).toBeNull();
    localStorage.setItem('botreborn.adminBoard', JSON.stringify({ characterId: 'asten', screen: null, flashedAt: 'yesterday' }));
    expect(readBoardMemory()).toBeNull();
    localStorage.setItem('botreborn.adminBoard', JSON.stringify({ characterId: 'asten', flashedAt: 7 }));
    expect(readBoardMemory()).toBeNull();
    expect(readBoardMemory()).toBeNull();   // nothing stored at all
  });

  it('survives storage that refuses to be read or written', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked'); });
    expect(readBoardMemory()).toBeNull();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked'); });
    expect(() => rememberBoard({ characterId: 'asten', screen: null, flashedAt: 7 })).not.toThrow();
  });
});
