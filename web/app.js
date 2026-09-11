// FT232H async bitbang control over WebUSB.
const FTDI_VID = 0x0403;
const FT232H_PID = 0x6014;

// FTDI vendor requests
const SIO_SET_BITMODE = 0x0b; // 1011
const SIO_READ_PINS = 0x0c;
const BITMODE_ASYNC_BITBANG = 0x01;
const PIN_MASK = 0x30; // D4 + D5 as outputs 00110000
const PORT_A = 1;

const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');

let device = null;
let bulkOutEndpoint = null; // discovered at connect time, not hardcoded

function setStatus(text) {
  statusEl.textContent = `Status: ${text}`;
}

function log(text) {
  const time = new Date().toISOString().slice(11, 19);
  logEl.textContent += `[${time}] ${text}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function hex(n, width = 4) {
  return `0x${n.toString(16).padStart(width, '0')}`;
}

function bin8(n) {
  return `0b${n.toString(2).padStart(8, '0')}`;
}

function describeDevice(d) {
  const lines = [
    `  VID:PID      ${hex(d.vendorId)}:${hex(d.productId)}`,
    `  manufacturer ${d.manufacturerName || '(none)'}`,
    `  product      ${d.productName || '(none)'}`,
    `  serial       ${d.serialNumber || '(none)'}`,
    `  usbVersion   ${d.usbVersionMajor}.${d.usbVersionMinor}`,
    `  configs      ${d.configurations.length}`,
  ];

  for (const config of d.configurations) {
    for (const iface of config.interfaces) {
      for (const alt of iface.alternates) {
        const endpoints = alt.endpoints
          .map((e) => `${e.direction}#${e.endpointNumber}(${e.type})`)
          .join(' ');
        lines.push(
          `  cfg${config.configurationValue} if${iface.interfaceNumber}` +
            ` class=${hex(alt.interfaceClass, 2)} ep: ${endpoints || '(none)'}`
        );
      }
    }
  }

  return lines.join('\n');
}

// Find the first bulk OUT endpoint instead of assuming endpoint 2.
function findBulkOutEndpoint(d) {
  for (const config of d.configurations) {
    for (const iface of config.interfaces) {
      for (const alt of iface.alternates) {
        for (const ep of alt.endpoints) {
          if (ep.direction === 'out' && ep.type === 'bulk') {
            return ep.endpointNumber;
          }
        }
      }
    }
  }
  return null;
}

// --- USB helpers that never fail silently ----------------------------------
//
// WebUSB resolves (does NOT reject) when a transfer is STALLed: the failure
// shows up as result.status === 'stall'. Every transfer goes through these
// wrappers so a stall is logged and thrown instead of being swallowed.

async function controlOut(label, setup) {
  const result = await device.controlTransferOut(setup);
  log(`${label}: status=${result.status} bytesWritten=${result.bytesWritten}`);
  if (result.status !== 'ok') {
    throw new Error(`${label} returned status "${result.status}"`);
  }
  return result;
}

async function bulkOut(label, bytes) {
  const result = await device.transferOut(bulkOutEndpoint, bytes);
  log(`${label}: status=${result.status} bytesWritten=${result.bytesWritten}`);
  if (result.status !== 'ok') {
    throw new Error(`${label} returned status "${result.status}"`);
  }
  return result;
}

// SIO_READ_PINS returns the instantaneous state of the 8 low pins.
// This is the ground truth: it reports what the chip is actually driving,
// independent of any wiring, motor driver or power supply downstream.
async function readPins() {
  const result = await device.controlTransferIn(
    {
      requestType: 'vendor',
      recipient: 'device',
      request: SIO_READ_PINS,
      value: 0,
      index: PORT_A,
    },
    1
  );

  if (result.status !== 'ok') {
    log(`read pins: status=${result.status}`);
    return null;
  }

  const value = result.data.getUint8(0);
  const d4 = (value >> 4) & 1;
  const d5 = (value >> 5) & 1;
  log(`read pins: ${bin8(value)} (${hex(value, 2)})  D4=${d4} D5=${d5}`);
  return value;
}

// --- Environment report, printed on load -----------------------------------

function reportEnvironment() {
  log(`secure context: ${window.isSecureContext}`);
  log(`origin: ${location.origin}`);
  log(`WebUSB available: ${'usb' in navigator}`);
  log(`userAgent: ${navigator.userAgent}`);

  if (!('usb' in navigator)) {
    log('');
    log('!! navigator.usb is missing. WebUSB needs a Chromium browser');
    log('   (Chrome / Edge). Firefox, Safari and iOS do not support it.');
    setStatus('WebUSB is not supported in this browser');
  }
  log('');
}

// --- Connect ---------------------------------------------------------------

document.getElementById('connectBtn').addEventListener('click', async () => {
  if (!navigator.usb) {
    setStatus('WebUSB is not supported in this browser');
    return;
  }

  try {
    log(`requesting device matching ${hex(FTDI_VID)}:${hex(FT232H_PID)} ...`);
    device = await navigator.usb.requestDevice({
      filters: [{ vendorId: FTDI_VID, productId: FT232H_PID }],
    });

    log('device selected:');
    log(describeDevice(device));

    await device.open();
    log('opened');

    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }
    log(`configuration ${device.configuration.configurationValue} selected`);

    await device.claimInterface(0);
    log('interface 0 claimed');

    bulkOutEndpoint = findBulkOutEndpoint(device);
    if (bulkOutEndpoint === null) {
      throw new Error('no bulk OUT endpoint found on this device');
    }
    log(`bulk OUT endpoint: ${bulkOutEndpoint}`);

    // Enter async bitbang mode.
    // FTDI wValue layout is: high byte = mode, low byte = pin direction mask.
    // (libftdi: usb_val = bitmask; usb_val |= (mode << 8);)
    const bitmodeValue = (BITMODE_ASYNC_BITBANG << 8) | PIN_MASK;
    log(`set bitmode wValue = ${hex(bitmodeValue)}` +
        ` (mode=${hex(BITMODE_ASYNC_BITBANG, 2)} mask=${hex(PIN_MASK, 2)})`);
    await controlOut('set bitmode', {
      requestType: 'vendor',
      recipient: 'device',
      request: SIO_SET_BITMODE,
      value: bitmodeValue,
      index: PORT_A,
    });

    log('pin state right after entering bitbang mode:');
    await readPins();

    setStatus('Connected to FT232H');
  } catch (err) {
    log(`!! ${err.name}: ${err.message}`);
    setStatus(`Connection failed: ${err.message}`);
  }
});

// --- Motor control ---------------------------------------------------------

async function setMotor(d4, d5) {
  if (!device) {
    setStatus('Connect the device first');
    return;
  }

  // In bitbang mode each byte written drives the pin states directly.
  const bitValue = (d4 << 4) | (d5 << 5);

  try {
    log(`--- write D4=${d4} D5=${d5} -> ${bin8(bitValue)} ---`);
    await bulkOut('write pins', new Uint8Array([bitValue]));

    // Read back so we can tell a failed write from a wiring problem.
    const readback = await readPins();
    if (readback !== null && (readback & PIN_MASK) === (bitValue & PIN_MASK)) {
      log('=> chip IS driving the pins as requested.');
      log('   If the motor does not move, the fault is downstream:');
      log('   wiring, motor driver, or driver power supply.');
    } else if (readback !== null) {
      log(`=> MISMATCH: wrote ${bin8(bitValue)}, read ${bin8(readback)}.`);
      log('   The chip is not latching the value (bitbang mode / baud rate).');
    }

    setStatus(`D4=${d4}, D5=${d5}`);
  } catch (err) {
    log(`!! write failed: ${err.name}: ${err.message}`);
    setStatus(`Write failed: ${err.message}`);
  }
}

for (const button of document.querySelectorAll('.controls button')) {
  if (button.dataset.d4 === undefined) continue;
  button.addEventListener('click', () => {
    setMotor(Number(button.dataset.d4), Number(button.dataset.d5));
  });
}

// --- Diagnostics -----------------------------------------------------------

// Empty filter list = show every USB device the browser can offer.
// This tells us whether the board enumerates at all, and under which VID:PID.
document.getElementById('scanAllBtn').addEventListener('click', async () => {
  if (!navigator.usb) return;

  try {
    log('opening picker with NO filter (all devices) ...');
    const found = await navigator.usb.requestDevice({ filters: [] });
    log('device selected:');
    log(describeDevice(found));

    if (found.vendorId === FTDI_VID && found.productId === FT232H_PID) {
      log('=> matches the FT232H filter; the picker should have listed it.');
    } else {
      log(`=> DOES NOT match the ${hex(FTDI_VID)}:${hex(FT232H_PID)} filter.`);
      log('   This is why the device never appeared. Update the filter.');
    }
  } catch (err) {
    log(`!! ${err.name}: ${err.message}`);
    if (err.name === 'NotFoundError') {
      log('   NotFoundError = picker closed with nothing chosen.');
      log('   If the list itself was EMPTY, the phone is not enumerating');
      log('   the board at all (OTG power / cable / Android permission).');
    }
  }
});

document.getElementById('readPinsBtn').addEventListener('click', async () => {
  if (!device) {
    setStatus('Connect the device first');
    return;
  }
  await readPins();
});

document.getElementById('listGrantedBtn').addEventListener('click', async () => {
  if (!navigator.usb) return;

  const devices = await navigator.usb.getDevices();
  log(`previously granted devices: ${devices.length}`);
  for (const d of devices) {
    log(describeDevice(d));
  }
});

document.getElementById('copyLogBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(logEl.textContent);
    setStatus('Log copied to clipboard');
  } catch {
    setStatus('Copy failed - select the log text manually');
  }
});

reportEnvironment();
