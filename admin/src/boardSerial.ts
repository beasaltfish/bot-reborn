// The browser half of talking to a board: Web Serial for the console, and
// esptool-js to write the firmware the brain serves at /firmware/. Thin on
// purpose, and not unit-tested — it is the hardware. The logic that can be
// tested is in boardConsole.ts.
import { ESPLoader, Transport, type FlashOptions } from 'esptool-js';
import type { LinePort } from './boardConsole';

/** Chrome and Edge only; Safari and Firefox have no Web Serial. */
export const supportsSerial = () => typeof navigator !== 'undefined' && 'serial' in navigator;

const CONSOLE_BAUD = 115200;
const FLASH_BAUD = 460800;

interface Manifest {
  chip: string;
  flashMode: FlashOptions['flashMode'];
  flashFreq: FlashOptions['flashFreq'];
  flashSize: FlashOptions['flashSize'];
  files: { offset: number; path: string }[];
}

/** Splits a byte stream into lines, whatever the board ends them with. */
function lineStream(readable: ReadableStream<Uint8Array>) {
  const decoded: ReadableStream<string> = readable.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>);
  const reader = decoded.getReader();
  async function* lines() {
    let rest = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      rest += value;
      const parts = rest.split(/\r\n|\n|\r/);
      rest = parts.pop() ?? '';
      yield* parts;
    }
  }
  return { lines: lines(), cancel: () => reader.cancel().catch(() => {}) };
}

/**
 * Open the board's console. Pass the port a flash just used to skip the
 * browser's chooser; if it cannot be reopened (the board re-enumerated after
 * its reset), the chooser opens as usual.
 */
export async function openBoard(known?: SerialPort): Promise<LinePort> {
  let port = known;
  if (port) {
    try { await port.open({ baudRate: CONSOLE_BAUD }); } catch { port = undefined; }
  }
  if (!port) {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: CONSOLE_BAUD });
  }
  const opened = port;
  const input = lineStream(opened.readable as ReadableStream<Uint8Array>);
  const writer = (opened.writable as WritableStream<Uint8Array>).getWriter();
  const encoder = new TextEncoder();
  return {
    write: (line) => writer.write(encoder.encode(line)),
    lines: input.lines,
    close: async () => {
      await input.cancel();
      await writer.close().catch(() => {});
      await opened.close().catch(() => {});
    },
  };
}

/**
 * Write the bundled firmware to a board the user picks. Resolves with the
 * port, closed, so the caller can reopen it as a console without asking again.
 */
export async function flashBoard(manifestUrl: string, onProgress: (percent: number) => void): Promise<SerialPort> {
  const manifest = (await (await fetch(manifestUrl)).json()) as Manifest;
  const base = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1);
  const fileArray = await Promise.all(manifest.files.map(async (f) => ({
    address: f.offset,
    data: new Uint8Array(await (await fetch(base + f.path)).arrayBuffer()),
  })));
  const total = fileArray.reduce((n, f) => n + f.data.length, 0);
  const written: number[] = fileArray.map(() => 0);

  const port = await navigator.serial.requestPort();
  const transport = new Transport(port, false);
  try {
    const loader = new ESPLoader({ transport, baudrate: FLASH_BAUD, romBaudrate: CONSOLE_BAUD });
    await loader.main();
    await loader.writeFlash({
      fileArray,
      flashMode: manifest.flashMode,
      flashFreq: manifest.flashFreq,
      flashSize: manifest.flashSize,
      eraseAll: false,
      compress: true,
      reportProgress: (i, done, size) => {
        // `done` counts compressed bytes against `size`; scale it to the image's own length.
        written[i] = Math.round((done / size) * fileArray[i].data.length);
        onProgress(Math.min(100, Math.round((written.reduce((a, b) => a + b, 0) / total) * 100)));
      },
    });
    await loader.after('hard_reset');
  } finally {
    await transport.disconnect().catch(() => {});
  }
  return port;
}
