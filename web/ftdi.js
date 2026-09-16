// FTDI protocol layer. Bytes only — this module knows nothing about driving,
// steering or the car. See spec §3.1, §4.2, §4.4.

export const FTDI_VID = 0x0403;
export const FT232H_PID = 0x6014;

/** D4–D7 are outputs (spec §3.1). */
export const PIN_MASK = 0xf0;

// --- FTDI vendor requests --------------------------------------------------

const SIO_RESET_REQUEST = 0x00;
const SIO_SET_BAUDRATE_REQUEST = 0x03;
const SIO_SET_BITMODE_REQUEST = 0x0b;
const SIO_READ_PINS_REQUEST = 0x0c;

const SIO_RESET_PURGE_TX = 2; // spec §4.4: wValue = 2
const BITMODE_ASYNC_BITBANG = 0x01;
const PORT_A = 1;

// --- Baud rate encoding ----------------------------------------------------
//
// The FT232H (like every "H" series part) runs its baud generator from a
// 120 MHz clock with a fixed /10 prescaler, giving a 12 MHz base, plus an
// optional /5 that we always switch off. The divisor is 14 integer bits plus
// a 3-bit fraction, and the fraction is NOT stored as a plain number: it is
// stored through this permutation table. This mirrors libftdi's
// ftdi_convert_baudrate() — the numbers below are not free parameters.
//
// Caveat: this covers only the 12 MHz-base path. Real libftdi switches to a
// different clock path below roughly 732 baud; this project never asks for
// anything that slow (the calibration rate is 1200), so that branch is not
// implemented here.

const H_CLK = 120_000_000;
const H_CLK_DIV = 10;
const FRAC_CODE = [0, 3, 2, 4, 1, 5, 6, 7];
const DISABLE_DIVIDE_BY_5 = 0x20000;

/**
 * @param {number} baud
 * @returns {{ value: number, index: number, actualBaud: number }}
 *   `value` and `index` go straight into the control transfer's wValue/wIndex.
 */
export function encodeBaudRate(baud) {
  if (!Number.isInteger(baud) || baud <= 0) {
    throw new RangeError(`baud must be a positive integer, got ${baud}`);
  }

  const base = Math.floor(H_CLK / H_CLK_DIV);        // 12_000_000
  const scaled = Math.floor((H_CLK * 16) / H_CLK_DIV); // 192_000_000
  let encoded;
  let actualBaud;

  if (baud >= base) {
    encoded = 0;
    actualBaud = base;
  } else if (baud >= Math.floor(H_CLK / (H_CLK_DIV + H_CLK_DIV / 2))) {
    encoded = 1;
    actualBaud = Math.floor(H_CLK / (H_CLK_DIV + H_CLK_DIV / 2));
  } else if (baud >= Math.floor(H_CLK / (2 * H_CLK_DIV))) {
    encoded = 2;
    actualBaud = Math.floor(H_CLK / (2 * H_CLK_DIV));
  } else {
    // divisor carries 3 extra low bits of fraction
    const divisor = Math.floor(scaled / baud);
    let best = divisor & 1 ? (divisor >> 1) + 1 : divisor >> 1;
    if (best > 0x20000) best = 0x1ffff;
    const back = Math.floor(scaled / best);
    actualBaud = back & 1 ? (back >> 1) + 1 : back >> 1;
    encoded = (best >>> 3) | (FRAC_CODE[best & 7] << 14);
  }

  encoded |= DISABLE_DIVIDE_BY_5;

  return {
    value: encoded & 0xffff,
    index: ((encoded >>> 8) & 0xff00) | PORT_A,
    actualBaud,
  };
}

// --- Device wrapper --------------------------------------------------------

/**
 * Byte rate of the pin output in async bitbang mode.
 *
 * PLACEHOLDER — calibration item ② (spec §12) measures this. Do not treat the
 * default as known-good: FTDI's bitbang clock is a multiple of the configured
 * baud rate and the multiplier is not documented consistently across parts,
 * which is exactly why ② exists. Task 5 replaces this with a measured value
 * recorded in docs/hardware.md.
 */
export const DEFAULT_BYTES_PER_MS = 1200 / 8 / 1000; // 0.15 — theory only, unverified

const DEFAULT_BAUD_RATE = 1200;

export class Ftdi {
  /** @type {USBDevice | null} */
  #device = null;

  /** @type {number} */
  #endpoint = 0;

  /** @type {number} */
  #bytesPerMs = DEFAULT_BYTES_PER_MS;

  /** @type {((reason: Error) => void) | null} */
  onDisconnect = null;

  /**
   * @param {USB} usb navigator.usb, or a fake in tests
   * @param {{ baudRate?: number, bytesPerMs?: number, device?: USBDevice }} [opts]
   */
  static async open(usb, opts = {}) {
    const ftdi = new Ftdi();
    const device = opts.device ?? await usb.requestDevice({
      filters: [{ vendorId: FTDI_VID, productId: FT232H_PID }],
    });

    await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);
    await device.claimInterface(0);

    const endpoint = findBulkOutEndpoint(device);
    if (endpoint === null) throw new Error('no bulk OUT endpoint on this device');

    ftdi.#device = device;
    ftdi.#endpoint = endpoint;
    ftdi.#bytesPerMs = opts.bytesPerMs ?? DEFAULT_BYTES_PER_MS;

    // FTDI wValue layout: high byte = mode, low byte = pin direction mask.
    await ftdi.#control(SIO_SET_BITMODE_REQUEST,
      (BITMODE_ASYNC_BITBANG << 8) | PIN_MASK, PORT_A);
    await ftdi.setBaudRate(opts.baudRate ?? DEFAULT_BAUD_RATE);

    usb.addEventListener?.('disconnect', (/** @type {any} */ event) => {
      if (event.device === device) {
        ftdi.#device = null;
        ftdi.onDisconnect?.(new Error('USB device disconnected'));
      }
    });

    return ftdi;
  }

  get device() { return this.#device; }
  get bytesPerMs() { return this.#bytesPerMs; }

  /** @param {number} baud */
  async setBaudRate(baud) {
    const { value, index } = encodeBaudRate(baud);
    await this.#control(SIO_SET_BAUDRATE_REQUEST, value, index);
  }

  /**
   * Bytes for `ms` of holding `pinByte`, with the stop byte already appended.
   *
   * In async bitbang the pins latch the value of the LAST byte clocked out and
   * hold it, so one trailing 0x00 is what actually stops the car — this is the
   * `[action × N, 0x00 × M]` of spec §4.2 with M = 1.
   *
   * @param {number} pinByte
   * @param {number} ms
   * @returns {Uint8Array<ArrayBuffer>}
   */
  buildStream(pinByte, ms) {
    const count = Math.max(1, Math.round(ms * this.#bytesPerMs));
    const stream = new Uint8Array(count + 1);
    stream.fill(pinByte, 0, count);
    stream[count] = 0x00;
    return stream;
  }

  /** @param {Uint8Array<ArrayBuffer>} bytes */
  async write(bytes) {
    const device = this.#requireDevice();
    const result = await device.transferOut(this.#endpoint, bytes);
    if (result.status !== 'ok') {
      throw new Error(`bulk write returned status "${result.status}"`);
    }
  }

  /** Drop whatever the chip has queued but not yet clocked out (spec §4.4). */
  async purgeTx() {
    await this.#control(SIO_RESET_REQUEST, SIO_RESET_PURGE_TX, PORT_A);
  }

  /** Instantaneous state of the 8 low pins — ground truth, independent of wiring. */
  async readPins() {
    const device = this.#requireDevice();
    const result = await device.controlTransferIn({
      requestType: 'vendor', recipient: 'device',
      request: SIO_READ_PINS_REQUEST, value: 0, index: PORT_A,
    }, 1);
    if (result.status !== 'ok' || !result.data) {
      throw new Error(`read pins returned status "${result.status}"`);
    }
    return result.data.getUint8(0);
  }

  async close() {
    const device = this.#device;
    this.#device = null;
    if (device) await device.close();
  }

  /** @param {number} request @param {number} value @param {number} index */
  async #control(request, value, index) {
    const device = this.#requireDevice();
    const result = await device.controlTransferOut({
      requestType: 'vendor', recipient: 'device', request, value, index,
    });
    if (result.status !== 'ok') {
      throw new Error(`control request ${request} returned status "${result.status}"`);
    }
  }

  #requireDevice() {
    if (!this.#device) throw new Error('FTDI device is not open');
    return this.#device;
  }
}

/** @param {USBDevice} device @returns {number | null} */
function findBulkOutEndpoint(device) {
  for (const config of device.configurations) {
    for (const iface of config.interfaces) {
      for (const alt of iface.alternates) {
        for (const ep of alt.endpoints) {
          if (ep.direction === 'out' && ep.type === 'bulk') return ep.endpointNumber;
        }
      }
    }
  }
  return null;
}
