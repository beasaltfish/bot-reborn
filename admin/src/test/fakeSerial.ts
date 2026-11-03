// A board on a serial line, for the page's tests: `answer` is what it prints
// back for each line the page writes (like the real console does).
import { vi } from 'vitest';
import type { LinePort } from '../boardConsole';

export function fakeSerial({ supported = true, answer = true }: { supported?: boolean; answer?: boolean } = {}) {
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  const emit = (line: string) => { queue.push(line); wake?.(); wake = null; };
  const written: string[] = [];
  const events: string[] = [];
  const port: LinePort = {
    write: async (line) => {
      written.push(line);
      if (!answer) return;
      if (line.startsWith('wifi')) emit('wifi saved');
      else if (line.startsWith('token')) emit('token 0000…  saved');
      else if (line.startsWith('reboot')) emit('welcomed as Asten');
    },
    lines: (async function* () {
      for (;;) {
        while (queue.length) yield queue.shift() as string;
        await new Promise<void>((r) => { wake = r; });
      }
    })(),
    close: async () => { events.push('close'); },
  };
  const flashed = {} as SerialPort;
  const serial = {
    supportsSerial: () => supported,
    openBoard: vi.fn(async (known?: SerialPort) => { events.push(known === flashed ? 'open:flashed' : 'open'); return port; }),
    flashBoard: vi.fn(async (_url: string, onProgress: (p: number) => void) => { events.push('flash'); onProgress(50); return flashed; }),
  };
  return { serial, written, events };
}
