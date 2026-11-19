// A board on a serial line, for the page's tests: `answer` is what it prints
// back for each line the page writes (like the real console does).
import { vi } from 'vitest';
import type { LinePort } from '../boardConsole';

export function fakeSerial({ supported = true, answer = true, token = `${'0'.repeat(31)}1`, screen = '', dropAfterReboot = false }: { supported?: boolean; answer?: boolean; token?: string; screen?: string; dropAfterReboot?: boolean } = {}) {
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  const emit = (line: string) => { queue.push(line); wake?.(); wake = null; };
  const written: string[] = [];
  const events: string[] = [];
  // Opening the board again retires the previous reader, the way closing a real
  // port does; without this a page that reads, then starts, listens twice.
  let generation = 0;
  const port: LinePort = {
    write: async (line) => {
      written.push(line);
      if (!answer) return;
      if (line.startsWith('wifi')) emit('wifi saved');
      else if (line.startsWith('screen')) emit('screen saved');
      else if (line.startsWith('token')) emit('token 0000…  saved');
      else if (line.startsWith('url')) emit('url saved');
      else if (line.startsWith('show')) {
        for (const l of ['board.ssid=HomeNet', 'board.pass=secret12', `board.token=${token}`, 'board.url=', `board.screen=${screen}`, 'board.end']) emit(l);
      }
      else if (line.startsWith('reboot')) {
        // A real reboot re-enumerates the USB-CDC device: the link usually drops
        // before the board can say anything.
        if (dropAfterReboot) { generation += 1; wake?.(); wake = null; }
        else emit('welcomed as Asten');
      }
    },
    lines: (async function* () {
      const mine = generation;
      for (;;) {
        if (mine !== generation) return;
        while (queue.length) yield queue.shift() as string;
        await new Promise<void>((r) => { wake = r; });
      }
    })(),
    close: async () => { events.push('close'); },
  };
  const flashed = {} as SerialPort;
  const serial = {
    supportsSerial: () => supported,
    openBoard: vi.fn(async (known?: SerialPort) => {
      events.push(known === flashed ? 'open:flashed' : 'open');
      generation += 1;
      return { ...port, lines: (async function* () {
        const mine = generation;
        for (;;) {
          if (mine !== generation) return;
          while (queue.length) yield queue.shift() as string;
          await new Promise<void>((r) => { wake = r; });
        }
      })() };
    }),
    flashBoard: vi.fn(async (_url: string, onProgress: (p: number) => void) => { events.push('flash'); onProgress(50); return flashed; }),
  };
  return { serial, written, events };
}
