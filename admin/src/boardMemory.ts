// What this computer last flashed and configured, so the setup steps can say
// "done on this machine" without asking the board. One record, no credentials.
import { SCREENS } from '../../core/screens.js';

export interface BoardMemory {
  characterId: string;
  /** The pairing the flash wrote; absent in records from before setup ids. */
  setupId?: string;
  /** A panel id from `SCREENS`, or null when the flash left the panel unknown. */
  screen: string | null;
  flashedAt: number;
}

const KEY = 'botreborn.adminBoard';

/** The record, or null when it is absent, unreadable, or not shaped like one. */
export function readBoardMemory(): BoardMemory | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const { characterId, setupId, screen, flashedAt } = value as Record<string, unknown>;
    if (typeof characterId !== 'string' || !characterId) return null;
    // Older records have no setupId; one that is present must be usable.
    if (setupId !== undefined && (typeof setupId !== 'string' || !setupId)) return null;
    if (screen !== null && (typeof screen !== 'string' || !SCREENS.some((s) => s.id === screen))) return null;
    if (typeof flashedAt !== 'number' || !Number.isFinite(flashedAt)) return null;
    return { characterId, ...(setupId === undefined ? {} : { setupId }), screen, flashedAt };
  } catch {
    // Junk, or a browser that keeps storage switched off for this page.
    return null;
  }
}

/** Keep what was just flashed; a browser with no storage simply forgets it. */
export function rememberBoard(memory: BoardMemory): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    /* nothing to keep it in */
  }
}
