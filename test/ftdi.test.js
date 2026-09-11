import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeBaudRate, PIN_MASK } from '../web/ftdi.js';

// FT232H 的分频器基准是 120 MHz / 10 = 12 MHz，且必须关掉 divide-by-5。
// 关掉的方式是给 encoded divisor 或上 0x20000，它最终体现为 wIndex 的高字节 0x02。
// 所以 index 恒为 0x0201（0x0200 = /5 off，0x01 = port A），value 才是分频值。

test('encodeBaudRate: 1200 baud (the rate used by calibration item 2)', () => {
  // 12_000_000 / 1200 = 10000，整除，无小数部分
  assert.deepEqual(encodeBaudRate(1200), {
    value: 10000,          // 0x2710
    index: 0x0201,
    actualBaud: 1200,
  });
});

test('encodeBaudRate: 9600 baud divides exactly', () => {
  // 12_000_000 / 9600 = 1250
  assert.deepEqual(encodeBaudRate(9600), {
    value: 1250,           // 0x04e2
    index: 0x0201,
    actualBaud: 9600,
  });
});

test('encodeBaudRate: the three special divisors at the top of the range', () => {
  assert.equal(encodeBaudRate(12_000_000).value, 0);     // divisor 0 = 12 MHz
  assert.equal(encodeBaudRate(8_000_000).value, 1);      // divisor 1 = 8 MHz
  assert.equal(encodeBaudRate(6_000_000).value, 2);      // divisor 2 = 6 MHz
});

test('encodeBaudRate: a rate needing the fractional divisor keeps index stable', () => {
  const r = encodeBaudRate(115200);
  assert.equal(r.index, 0x0201);
  // 12_000_000 / 115200 = 104.1666… → 分数部分落在 frac_code 的某一档
  assert.ok(Math.abs(r.actualBaud - 115200) / 115200 < 0.03,
    `actualBaud ${r.actualBaud} should be within 3% of 115200`);
});

test('encodeBaudRate: rejects nonsense', () => {
  assert.throws(() => encodeBaudRate(0), RangeError);
  assert.throws(() => encodeBaudRate(-1), RangeError);
  assert.throws(() => encodeBaudRate(1.5), RangeError);
});

test('PIN_MASK is D4-D7', () => {
  assert.equal(PIN_MASK, 0xf0);
});

import { Ftdi } from '../web/ftdi.js';

/**
 * A fake USBDevice that records every transfer in submission order.
 * This is the point of the whole test file: spec §4.4 requires purgeTx()
 * (a CONTROL transfer) to complete before write([0x00]) (a BULK transfer),
 * and those are different pipes — the browser does not order them for us.
 */
function fakeDevice() {
  /** @type {any[]} */
  const calls = [];
  return {
    calls,
    opened: false,
    pinValue: 0x00,
    configuration: { configurationValue: 1 },
    configurations: [{
      configurationValue: 1,
      interfaces: [{
        interfaceNumber: 0,
        alternates: [{
          interfaceClass: 0xff,
          endpoints: [
            { direction: 'in', endpointNumber: 1, type: 'bulk' },
            { direction: 'out', endpointNumber: 2, type: 'bulk' },
          ],
        }],
      }],
    }],
    async open() { this.opened = true; calls.push({ op: 'open' }); },
    async close() { this.opened = false; calls.push({ op: 'close' }); },
    /** @param {number} v */
    async selectConfiguration(v) { calls.push({ op: 'selectConfiguration', v }); },
    /** @param {number} n */
    async claimInterface(n) { calls.push({ op: 'claimInterface', n }); },
    /** @param {any} setup */
    async controlTransferOut(setup) {
      calls.push({ op: 'control', request: setup.request, value: setup.value, index: setup.index });
      return { status: 'ok', bytesWritten: 0 };
    },
    /** @param {any} setup */
    async controlTransferIn(setup) {
      calls.push({ op: 'controlIn', request: setup.request, value: setup.value, index: setup.index });
      return { status: 'ok', data: new DataView(new Uint8Array([this.pinValue]).buffer) };
    },
    /** @param {number} ep @param {any} data */
    async transferOut(ep, data) {
      calls.push({ op: 'bulk', ep, bytes: Array.from(new Uint8Array(data)) });
      return { status: 'ok', bytesWritten: data.byteLength };
    },
  };
}

/** @param {any} device @returns {any} a fake USB, deliberately not a full USB implementation */
function fakeUsb(device) {
  return {
    async requestDevice() { return device; },
    async getDevices() { return [device]; },
    addEventListener() {},
  };
}

test('open(): claims the interface and enters async bitbang with mask 0xf0', async () => {
  const dev = fakeDevice();
  await Ftdi.open(fakeUsb(dev), { baudRate: 1200 });

  const bitmode = dev.calls.find((c) => c.op === 'control' && c.request === 0x0b);
  assert.ok(bitmode, 'expected a SIO_SET_BITMODE control transfer');
  // wValue high byte = mode, low byte = direction mask
  assert.equal(bitmode.value, (0x01 << 8) | 0xf0);

  const baud = dev.calls.find((c) => c.op === 'control' && c.request === 0x03);
  assert.ok(baud, 'expected a SIO_SET_BAUDRATE control transfer');
  assert.equal(baud.value, 10000);
  assert.equal(baud.index, 0x0201);
});

test('open(): discovers the bulk OUT endpoint instead of assuming 2', async () => {
  const dev = fakeDevice();
  // move the OUT endpoint so a hardcoded 2 would fail
  dev.configurations[0].interfaces[0].alternates[0].endpoints[1].endpointNumber = 6;
  const ftdi = await Ftdi.open(fakeUsb(dev), { baudRate: 1200 });
  await ftdi.write(new Uint8Array([0x10]));
  const bulk = dev.calls.find((c) => c.op === 'bulk');
  assert.equal(bulk.ep, 6);
});

test('buildStream(): the stop byte is already in the buffer (spec §4.2)', async () => {
  const dev = fakeDevice();
  const ftdi = await Ftdi.open(fakeUsb(dev), { baudRate: 1200, bytesPerMs: 0.5 });

  const stream = ftdi.buildStream(0x10, 600);
  // 600 ms at 0.5 bytes/ms = 300 action bytes, then the stop byte
  assert.equal(stream.length, 301);
  assert.equal(stream[0], 0x10);
  assert.equal(stream[299], 0x10);
  assert.equal(stream[300], 0x00, 'the stream MUST end with the stop byte');
});

test('buildStream(): always emits at least one action byte', async () => {
  const dev = fakeDevice();
  const ftdi = await Ftdi.open(fakeUsb(dev), { baudRate: 1200, bytesPerMs: 0.5 });
  const stream = ftdi.buildStream(0x10, 1);
  assert.deepEqual(Array.from(stream), [0x10, 0x00]);
});

test('purgeTx() uses SIO_RESET_REQUEST with wValue 2 (spec §4.4)', async () => {
  const dev = fakeDevice();
  const ftdi = await Ftdi.open(fakeUsb(dev), { baudRate: 1200 });
  dev.calls.length = 0;
  await ftdi.purgeTx();
  assert.deepEqual(dev.calls, [{ op: 'control', request: 0x00, value: 2, index: 1 }]);
});

test('write() throws on a stalled transfer instead of resolving quietly', async () => {
  const dev = fakeDevice();
  const ftdi = await Ftdi.open(fakeUsb(dev), { baudRate: 1200 });
  dev.transferOut = async () => ({ status: 'stall', bytesWritten: 0 });
  await assert.rejects(() => ftdi.write(new Uint8Array([0x10])), /stall/);
});

test('readPins(): issues SIO_READ_PINS on port A and decodes the returned byte', async () => {
  const dev = fakeDevice();
  const ftdi = await Ftdi.open(fakeUsb(dev), { baudRate: 1200 });
  dev.calls.length = 0;
  dev.pinValue = 0xf0; // D4-D7 all high, D0-D3 low

  const value = await ftdi.readPins();

  assert.equal(value, 0xf0);
  const readIn = dev.calls.find((c) => c.op === 'controlIn');
  assert.ok(readIn, 'expected a controlTransferIn call');
  assert.equal(readIn.request, 0x0c); // SIO_READ_PINS_REQUEST
  assert.equal(readIn.index, 1);      // PORT_A
});

test('readPins(): throws instead of returning undefined when the transfer fails', async () => {
  const dev = fakeDevice();
  const ftdi = await Ftdi.open(fakeUsb(dev), { baudRate: 1200 });
  dev.controlTransferIn = async () => ({ status: 'stall', data: new DataView(new ArrayBuffer(1)) });
  await assert.rejects(() => ftdi.readPins(), /stall/);
});
