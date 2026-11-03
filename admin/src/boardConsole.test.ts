import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardConsole, ConsoleError, type LinePort } from './boardConsole';

/** A serial port the test talks through: `emit` is the board speaking. */
function fakePort() {
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  const written: string[] = [];
  const port: LinePort = {
    write: async (line) => { written.push(line); },
    lines: (async function* () {
      for (;;) {
        while (queue.length) yield queue.shift() as string;
        await new Promise<void>((r) => { wake = r; });
      }
    })(),
    close: async () => {},
  };
  return {
    port, written,
    emit(line: string) { queue.push(line); wake?.(); wake = null; },
  };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

async function reason(p: Promise<unknown>): Promise<string | null> {
  try { await p; return null; } catch (e) { return e instanceof ConsoleError ? e.reason : `other:${e}`; }
}

describe('BoardConsole', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('sends wifi with both arguments quoted and resolves on "wifi saved"', async () => {
    const f = fakePort();
    const c = new BoardConsole(f.port);
    const done = c.setWifi('My Home', 'secret12');
    await settle();
    expect(f.written).toEqual(['wifi "My Home" "secret12"\n']);
    f.emit('wifi saved');
    await expect(done).resolves.toBeUndefined();
  });

  it('refuses a name with a double quote, a short password, and writes nothing', async () => {
    const f = fakePort();
    const c = new BoardConsole(f.port);
    expect(await reason(c.setWifi('a"b', 'secret12'))).toBe('bad-ssid');
    expect(await reason(c.setWifi('x', 'short'))).toBe('bad-pass');
    expect(await reason(c.setWifi('', 'secret12'))).toBe('bad-ssid');
    expect(await reason(c.setWifi('é'.repeat(17), 'secret12'))).toBe('bad-ssid');   // 34 bytes
    expect(f.written).toEqual([]);
  });

  it('writes an open network with no password argument', async () => {
    const f = fakePort();
    const c = new BoardConsole(f.port);
    const done = c.setWifi('x', '');
    await settle();
    expect(f.written).toEqual(['wifi "x"\n']);
    f.emit('wifi saved');
    await done;
  });

  it('writes a 32-hex token lowercased and takes the board\'s "token abcd…  saved" reply', async () => {
    const f = fakePort();
    const c = new BoardConsole(f.port);
    expect(await reason(c.setToken('0123456789abcdef0123456789abcde'))).toBe('bad-token');
    expect(f.written).toEqual([]);
    const done = c.setToken('0123456789ABCDEF0123456789abcdef');
    await settle();
    expect(f.written).toEqual(['token 0123456789abcdef0123456789abcdef\n']);
    f.emit('token 0123…  saved');
    await done;
  });

  it('rejects with the board\'s own words when it answers error:', async () => {
    const f = fakePort();
    const c = new BoardConsole(f.port);
    const done = c.setWifi('x', '');
    const got = reason(done);
    await settle();
    f.emit('error: password must be empty or 8 to 63 characters');
    expect(await got).toBe('rejected');
  });

  it('rejects no-reply when nothing comes back in 5 seconds', async () => {
    const f = fakePort();
    const c = new BoardConsole(f.port);
    const got = reason(c.setWifi('x', ''));
    await vi.advanceTimersByTimeAsync(5000);
    expect(await got).toBe('no-reply');
  });

  it('useDiscovery writes "url auto" and resolves on "url saved"', async () => {
    const f = fakePort();
    const c = new BoardConsole(f.port);
    const done = c.useDiscovery();
    await settle();
    expect(f.written).toEqual(['url auto\n']);
    f.emit('url saved');
    await expect(done).resolves.toBeUndefined();
  });

  it('reboot writes the line and does not wait for a reply', async () => {
    const f = fakePort();
    const c = new BoardConsole(f.port);
    await c.reboot();
    expect(f.written).toEqual(['reboot\n']);
  });

  it('waitWelcomed resolves with the name, past boot-log lines', async () => {
    const f = fakePort();
    const c = new BoardConsole(f.port);
    await c.reboot();
    const got = c.waitWelcomed(10000);
    await settle();
    f.emit('I (1200) wifi: connected');
    f.emit('welcomed as Asten');
    await expect(got).resolves.toBe('Asten');
  });

  it('waitWelcomed rejects not-welcomed at the timeout', async () => {
    const f = fakePort();
    const c = new BoardConsole(f.port);
    const got = reason(c.waitWelcomed(10000));
    await vi.advanceTimersByTimeAsync(10000);
    expect(await got).toBe('not-welcomed');
  });
});
