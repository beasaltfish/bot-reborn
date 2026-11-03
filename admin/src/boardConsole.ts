// Talking to the board's serial console the way a person at a monitor does:
// type a line, read what it says back. The firmware's commands and replies
// (firmware/components/body_logic/command.c, main/console.c) are instrument
// text, so they stay English and are matched here, never translated.

export interface LinePort {
  /** One console line, newline included. */
  write(line: string): Promise<void>;
  /** What the board prints, a line at a time, without the line ending. */
  lines: AsyncIterable<string>;
  close(): Promise<void>;
}

export type ConsoleReason = 'bad-ssid' | 'bad-pass' | 'bad-token' | 'no-reply' | 'rejected' | 'not-welcomed';

export class ConsoleError extends Error {
  reason: ConsoleReason;
  constructor(reason: ConsoleReason, message: string = reason) {
    super(message);
    this.reason = reason;
  }
}

const REPLY_TIMEOUT_MS = 5000;
const bytes = (s: string) => new TextEncoder().encode(s).length;

/** What the console would refuse about a Wi-Fi name and password, found without a board. */
export function checkWifi(ssid: string, pass: string): 'bad-ssid' | 'bad-pass' | null {
  // The console has no escape for a quote inside a quoted word.
  if (ssid.includes('"') || bytes(ssid) < 1 || bytes(ssid) > 32) return 'bad-ssid';
  if (pass.includes('"') || (pass !== '' && (pass.length < 8 || pass.length > 63))) return 'bad-pass';
  return null;
}

export class BoardConsole {
  private listeners = new Set<(line: string) => void>();
  private welcomed: string | null = null;

  constructor(private port: LinePort, private opts: { replyTimeoutMs?: number } = {}) {
    void this.pump();
  }

  /** The one reader of port.lines: every call below listens through it. */
  private async pump() {
    try {
      for await (const line of this.port.lines) {
        const m = /^welcomed as (.+)$/.exec(line);
        if (m) this.welcomed = m[1];
        for (const listen of [...this.listeners]) listen(line);
      }
    } catch { /* the port went away; pending calls time out */ }
  }

  /** Write a command, then wait for the board's "… saved" or "error: …". */
  private async command(line: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const done = (fn: () => void) => { clearTimeout(timer); this.listeners.delete(listen); fn(); };
      const listen = (reply: string) => {
        if (reply.startsWith('error:')) done(() => reject(new ConsoleError('rejected', reply)));
        else if (/saved$/.test(reply)) done(resolve);
      };
      const timer = setTimeout(() => done(() => reject(new ConsoleError('no-reply'))), this.opts.replyTimeoutMs ?? REPLY_TIMEOUT_MS);
      this.listeners.add(listen);   // before the write: the answer can be instant
      this.port.write(line).catch((e) => done(() => reject(e)));
    });
  }

  async setWifi(ssid: string, pass: string): Promise<void> {
    const bad = checkWifi(ssid, pass);
    if (bad) throw new ConsoleError(bad);
    await this.command(`wifi "${ssid}"${pass ? ` "${pass}"` : ''}\n`);
  }

  async setToken(token: string): Promise<void> {
    if (!/^[0-9a-fA-F]{32}$/.test(token)) throw new ConsoleError('bad-token');
    await this.command(`token ${token.toLowerCase()}\n`);
  }

  /** The board restarts and answers nothing. */
  async reboot(): Promise<void> {
    this.welcomed = null;
    await this.port.write('reboot\n');
  }

  /** Resolves with the character's name from "welcomed as <name>". */
  waitWelcomed(timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.welcomed) return resolve(this.welcomed);
      const done = (fn: () => void) => { clearTimeout(timer); this.listeners.delete(listen); fn(); };
      const listen = (line: string) => {
        const m = /^welcomed as (.+)$/.exec(line);
        if (m) done(() => resolve(m[1]));
      };
      const timer = setTimeout(() => done(() => reject(new ConsoleError('not-welcomed'))), timeoutMs);
      this.listeners.add(listen);
    });
  }
}
