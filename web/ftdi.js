// FTDI protocol layer. Bytes only — this module knows nothing about driving,
// steering or the car. See spec §3.1, §4.2, §4.4.

export const FTDI_VID = 0x0403;
export const FT232H_PID = 0x6014;

/** The one description of what the car looks like to WebUSB. Exported because
 *  pairing and opening are two different moments — the picker needs a user
 *  gesture and open() happens seconds later — and they must not drift into two
 *  different filters, or the device a person picked is not the one we open. */
export const USB_FILTERS = /** @type {const} */ ([
  { vendorId: FTDI_VID, productId: FT232H_PID },
]);

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
// The /5 is switched off here the way libftdi does it — and ② measured that on
// this part the bit changes nothing either way, which is why there is no option
// for it: a knob that provably does nothing is worse than no knob. The base is
// 60 MHz regardless, which is where the ×5 in BYTES_PER_BAUD_TICK comes from.
//
// Caveat: this covers only the 12 MHz-base path. The divisor field is 14
// integer bits plus 3 fractional ones, so the largest divisor it can hold is
// about 16384 and the slowest baud it can express is 12 MHz / 16384 ≈ 732 —
// that is where the wall is, not at anybody's choice of threshold. Going below
// it means slowing the base clock instead, by leaving the /5 prescaler on
// (2.4 MHz base, down to roughly 146 baud); real libftdi switches paths there.
// Not implemented, and ② removed the reason to want it: the only motive was to
// land a MAX_COAST_MS slice in a few hundred bytes, and at 1200 baud it is
// 1200 bytes, which is 1.2 KB per write and costs nothing.

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

const DEFAULT_BAUD_RATE = 1200;

/**
 * Bytes clocked out per baud tick in async bitbang mode — FIVE, measured.
 *
 * A byte here is a pin pattern rather than a character being serialised, so the
 * baud generator clocks out a whole byte each period rather than a bit; that
 * much was already known, and is why the ÷8 this once used was ten times too
 * slow. What was not known is that the period is not the one that was asked
 * for. `encodeBaudRate` computes its divisor against a 12 MHz base, mirroring
 * libftdi; this part's generator runs from 60 MHz. 60 / 12 = 5, and the pins
 * move five times faster than every duration in this project assumed.
 *
 * Measured by ② on 2026-09-21, on the phone, against the chip's own pin
 * read-back rather than a stopwatch:
 *
 *   1500 / 3000 / 6000 bytes @ 1200 baud → 0.25 / 0.52 / 1.00 s (the rate is a
 *   rate: the run scales with the byte count, and the host wrote every byte)
 *   3000 bytes @ 732 / 1200 / 2400 baud → 5.12 / 5.00 / 4.81 × the baud
 *   ACTUALLY set (5.0 within the ±25 ms the read-back can resolve)
 *
 * The ÷5 prescaler bit is not the mechanism: setting it either way changes
 * nothing on this part, which is itself a finding — libftdi switches it off and
 * computes as if it were on.
 *
 * The stopwatch reading this replaces (2026-09-20, "about 2 s against a
 * theoretical 2.5 s") was not a small error. A 0.5 s run timed by hand off a
 * motor that keeps turning after the pins drop reads as 2 s, and it agreed with
 * the assumption, which is why it stood for a day.
 */
export const BYTES_PER_BAUD_TICK = 5;

/**
 * 6.0 bytes/ms at 1200 baud. A calibration in config.calibration.bytesPerMs
 * still overrides it — this is the theoretical value for a part that behaves
 * like the one ② measured, not a measurement of yours.
 */
export const DEFAULT_BYTES_PER_MS = DEFAULT_BAUD_RATE * BYTES_PER_BAUD_TICK / 1000;

export class Ftdi {
  /** @type {USBDevice | null} */
  #device = null;

  /** @type {number} */
  #endpoint = 0;

  /** @type {number} */
  #bytesPerMs = DEFAULT_BYTES_PER_MS;

  /** Whether #bytesPerMs came from a measurement rather than from the model. */
  #calibrated = false;

  /** @type {((reason: Error) => void) | null} */
  onDisconnect = null;

  /**
   * @param {USB} usb navigator.usb, or a fake in tests
   * @param {{ baudRate?: number, bytesPerMs?: number, device?: USBDevice }} [opts]
   */
  static async open(usb, opts = {}) {
    const ftdi = new Ftdi();
    const device = opts.device ?? await usb.requestDevice({ filters: [...USB_FILTERS] });

    await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);
    await device.claimInterface(0);

    const endpoint = findBulkOutEndpoint(device);
    if (endpoint === null) throw new Error('no bulk OUT endpoint on this device');

    ftdi.#device = device;
    ftdi.#endpoint = endpoint;
    ftdi.#calibrated = opts.bytesPerMs !== undefined;
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

  /**
   * The baud the chip was ACTUALLY set to, which is not always the one asked
   * for: the divisor field saturates near 732 baud, and below that the request
   * is silently clamped. It used to be computed and dropped on the floor, which
   * is how ② came to compare a 732-baud run against a 600-baud expectation and
   * report a multiplier that had not moved as one that had.
   *
   * @param {number} baud
   * @returns {Promise<number>} the baud actually set
   */
  async setBaudRate(baud) {
    const { value, index, actualBaud } = encodeBaudRate(baud);
    await this.#control(SIO_SET_BAUDRATE_REQUEST, value, index);
    // A baud change moves the byte rate with it, so a stream built afterwards
    // from the old rate would be the wrong length. Not applied over a
    // calibration the caller supplied: that is a measurement of this board, and
    // it outranks the model.
    if (!this.#calibrated) this.#bytesPerMs = actualBaud * BYTES_PER_BAUD_TICK / 1000;
    return actualBaud;
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

  /** @param {Uint8Array<ArrayBuffer>} bytes
   *  @returns {Promise<number>} what the host says it actually wrote */
  async write(bytes) {
    const device = this.#requireDevice();
    const result = await device.transferOut(this.#endpoint, bytes);
    if (result.status !== 'ok') {
      throw new Error(`bulk write returned status "${result.status}"`);
    }
    // Returned rather than checked here. A short write is a real fault — the
    // stop byte is the LAST byte, so a truncated stream is a car that never
    // stops — but ② has to be able to report the count rather than have it
    // thrown at it: "the chip is five times faster than assumed" and "only a
    // fifth of the bytes arrived" produce the same short run, and the count is
    // what separates them.
    return result.bytesWritten;
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
