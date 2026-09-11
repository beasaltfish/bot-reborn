// 标定台 — bring-up 台面板，为 spec §12 的 ①②⑧ 服务。
//
// 这是 web/app.js（D4/D5，一次写一个字节）的替身：那套模型做不到「写 3000
// 个字节然后掐秒表」，这里换成 Ftdi.buildStream() 一次性交出整个缓冲区。
// 这个页面不是一次性 demo —— bytesPerMs 会随硬件改动重新标定，所以它常驻仓库。
//
// entry file：允许在顶层触碰 document/navigator（spec §10 的例外）。

import { Ftdi, encodeBaudRate, PIN_MASK, FTDI_VID, FT232H_PID } from './ftdi.js';

const BENCH_BAUD = 1200; // spec §12 ② 指定的标定波特率
const BYTE_RATE_TEST_BYTES = 3000;

/** @type {Ftdi | null} */
let ftdi = null;

// --- 带类型的 DOM 取值 helper（Ruling P2：保持 strict，不用 @ts-nocheck）-----

const el = (/** @type {string} */ id) =>
  /** @type {HTMLElement} */ (document.getElementById(id));

const inputEl = (/** @type {string} */ id) =>
  /** @type {HTMLInputElement} */ (document.getElementById(id));

const statusEl = el('status');
const logEl = el('log');

/** 日志的真实内容存在这个字符串里；`logEl.textContent` 的类型是
 *  `string | null`，用它做读-改-写会在 strict 模式下报错，所以只往上写。 */
let logText = '';

/** @param {string} text */
function setStatus(text) {
  statusEl.textContent = `状态：${text}`;
}

/** @param {string} text */
function log(text) {
  const time = new Date().toISOString().slice(11, 19);
  logText += `[${time}] ${text}\n`;
  logEl.textContent = logText;
  logEl.scrollTop = logEl.scrollHeight;
}

/** @param {number} n @param {number} [width] */
function hex(n, width = 4) {
  return `0x${n.toString(16).padStart(width, '0')}`;
}

/** @param {number} n */
function bin8(n) {
  return `0b${n.toString(2).padStart(8, '0')}`;
}

/** 拿到已连接的 Ftdi，没连接就报状态并返回 null——调用方直接 `if (!dev) return;`。
 *  @returns {Ftdi | null} */
function requireFtdi() {
  if (!ftdi) {
    setStatus('先连接设备');
    return null;
  }
  return ftdi;
}

// --- 从 app.js 搬过来的诊断能力（逐字搬运，只把引脚宽度从 D4/D5 扩到 D4-D7）---

/** @param {USBDevice} d */
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

// 纯诊断用：Ftdi.open() 内部会自己再发现一次 bulk OUT 端点（那份才是协议层
// 真正用来写数据的）。这里重复一次同样的查找，只是为了在连接时把端点号打到
// 日志里，方便排查「板子接上了但端点不对」这类问题。
/** @param {USBDevice} d @returns {number | null} */
function findBulkOutEndpoint(d) {
  for (const config of d.configurations) {
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

/** @param {Ftdi} dev */
async function logPinState(dev) {
  const value = await dev.readPins();
  const d4 = (value >> 4) & 1, d5 = (value >> 5) & 1;
  const d6 = (value >> 6) & 1, d7 = (value >> 7) & 1;
  log(`read pins: ${bin8(value)}  D4=${d4} D5=${d5} D6=${d6} D7=${d7}`);
  return value;
}

function reportEnvironment() {
  log(`secure context: ${window.isSecureContext}`);
  log(`origin: ${location.origin}`);
  log(`WebUSB available: ${'usb' in navigator}`);
  log(`userAgent: ${navigator.userAgent}`);

  if (!navigator.usb) {
    log('');
    log('!! navigator.usb 缺失。WebUSB 需要 Chromium 内核浏览器');
    log('   （Chrome / Edge）。Firefox、Safari、iOS 都不支持。');
    setStatus('此浏览器不支持 WebUSB');
  }
  log('');
}

// --- 连接 --------------------------------------------------------------------

el('connectBtn').addEventListener('click', async () => {
  const usb = navigator.usb;
  if (!usb) {
    setStatus('此浏览器不支持 WebUSB');
    return;
  }

  try {
    log(`请求匹配 ${hex(FTDI_VID)}:${hex(FT232H_PID)} 的设备 ...`);
    const device = await usb.requestDevice({
      filters: [{ vendorId: FTDI_VID, productId: FT232H_PID }],
    });

    log('设备已选择：');
    log(describeDevice(device));

    const endpoint = findBulkOutEndpoint(device);
    log(`bulk OUT 端点（诊断用）：${endpoint === null ? '未找到' : endpoint}`);

    const opened = await Ftdi.open(usb, { baudRate: BENCH_BAUD, device });
    opened.onDisconnect = (err) => {
      ftdi = null;
      log(`!! 设备已断开：${err.message}`);
      setStatus('已断开');
    };
    ftdi = opened;

    // encodeBaudRate 的 actualBaud 是分频器实际能落到的波特率，不一定精确等于
    // 请求值；② 的「理论耗时」是按 BENCH_BAUD 算的，两者差多少这里先摆出来，
    // 免得后面 ms/字节算出来偏差却不知道是不是分频器的锅。
    const { actualBaud } = encodeBaudRate(BENCH_BAUD);
    log(`已连接，波特率 ${BENCH_BAUD} baud（异步 bitbang，D4-D7 输出），` +
      `分频器实际波特率 ${actualBaud}，bytesPerMs=${opened.bytesPerMs}`);
    log('进入 bitbang 模式后的引脚状态：');
    await logPinState(opened);

    setStatus('已连接 FT232H');
  } catch (err) {
    const e = /** @type {Error} */ (err);
    log(`!! ${e.name}: ${e.message}`);
    setStatus(`连接失败：${e.message}`);
  }
});

// --- 急停（spec §4.1 第 2 层）-------------------------------------------------
//
// 这个页面不经过 Executor，所以没有 generation counter 可以抢占——它本来也不
// 需要：这里没有续期循环在跑，危险全部来自「已经交给芯片、还没放完」的那堆
// 字节。所以急停就是 spec §4.4 的第 2、3 步，顺序同样不可变：先 purgeTx 丢掉
// FIFO 里排队的字节，再写一个 0x00 把引脚拉低。反过来的话 0x00 会被 purge
// 一起丢掉。② 的 3000 字节要跑 20 秒，没有这个按钮就只能拔线。

el('stopBtn').addEventListener('click', async () => {
  const dev = requireFtdi();
  if (!dev) return;
  try {
    await dev.purgeTx();
    await dev.write(new Uint8Array([0x00]));
    log('■ 急停：purgeTx 丢掉 FIFO 里排队的字节，再写 0x00 拉低引脚');
  } catch (err) {
    const e = /** @type {Error} */ (err);
    log(`!! 急停失败 ${e.name}: ${e.message} —— 拔线`);
    setStatus(`急停失败：${e.message}`);
  }
});

// --- ① 六种引脚组合：判断 A/B 侧对应左/右 -----------------------------------

for (const button of document.querySelectorAll('[data-pins]')) {
  const btn = /** @type {HTMLElement} */ (button);
  btn.addEventListener('click', async () => {
    const dev = requireFtdi();
    if (!dev) return;

    const pins = Number(btn.dataset.pins);
    log(`--- ${bin8(pins)} 保持 600 ms ---`);
    try {
      // 一次 transferOut，停止字节已经在同一个 buffer 里——spec §4.2。
      await dev.write(dev.buildStream(pins, 600));

      // 注意时机：3000 字节在 1200 波特下要跑十几秒，但这里只写了 600 ms，
      // 在标定波特率下这段很快就放完了，读回时引脚可能已经自然回落到 0x00——
      // 这种情况标「有歧义」而不是直接判 MISMATCH，因为它常常只是正常收尾。
      // 但一颗真的卡在低电平的芯片同样会读到 0x00，所以不能因此整个跳过日志，
      // 只是不能在证据不足时就下 MISMATCH 的结论。
      const readback = await dev.readPins();
      if ((readback & PIN_MASK) === (pins & PIN_MASK)) {
        log('=> 芯片确实在按要求驱动引脚。车不动的话，问题在下游：接线、驱动芯片、或驱动电源。');
      } else if (readback === 0x00) {
        log(`=> ⚠️ AMBIGUOUS：写了 ${bin8(pins)}，读到 0x00。`);
        log('   600 ms 的片段在标定波特率下可能已经自然放完，这不一定是故障；');
        log('   但引脚卡死在低电平也会读到同样的 0x00——光看这一个数分不清，要结合车的实际反应判断。');
      } else {
        log(`=> MISMATCH：写了 ${bin8(pins)}，读到 ${bin8(readback)}。`);
        log('   芯片没在按要求驱动引脚——是 bitbang 模式或波特率的问题，不是接线问题。');
      }
    } catch (err) {
      const e = /** @type {Error} */ (err);
      log(`!! ${e.name}: ${e.message}`);
      setStatus(`写入失败：${e.message}`);
    }
  });
}

// --- ② 字节速率与车速实验 -----------------------------------------------------

el('byteRateBtn').addEventListener('click', async () => {
  const dev = requireFtdi();
  if (!dev) return;

  // spec §12 ② 明确要求这个实验用一个精确的 3000 字节缓冲区，而不是
  // buildStream() 按 bytesPerMs 估算出来的字节数——这里就是在测 bytesPerMs
  // 本身，用估算值反而会让实验测量自己的假设。
  const stream = new Uint8Array(BYTE_RATE_TEST_BYTES + 1);
  stream.fill(0x10, 0, BYTE_RATE_TEST_BYTES);
  stream[BYTE_RATE_TEST_BYTES] = 0x00;

  const theory = (BYTE_RATE_TEST_BYTES * 8) / BENCH_BAUD; // 秒，按 8 bit/字节
  log(`写 ${BYTE_RATE_TEST_BYTES} 字节 @ ${BENCH_BAUD} baud，理论 ${theory.toFixed(1)} s`);
  log('现在掐秒表——从电机开始转到停下。同时量车走了多远。');
  try {
    const t0 = performance.now();
    await dev.write(stream);
    log(`transferOut 返回耗时 ${(performance.now() - t0).toFixed(0)} ms`);
    log('（这个数是 URB 提交的耗时，不是电机转的时间——秒表才是。）');
  } catch (err) {
    const e = /** @type {Error} */ (err);
    log(`!! ${e.name}: ${e.message}`);
    setStatus(`写入失败：${e.message}`);
  }
});

el('computeBtn').addEventListener('click', () => {
  const seconds = Number(inputEl('measuredSeconds').value);
  const metres = Number(inputEl('measuredMetres').value);
  if (!seconds) return;

  const theory = (BYTE_RATE_TEST_BYTES * 8) / BENCH_BAUD;
  const msPerByte = (seconds * 1000) / BYTE_RATE_TEST_BYTES;
  const out = [
    `实测 ${seconds} s / 理论 ${theory.toFixed(1)} s = 倍率 ${(seconds / theory).toFixed(3)}`,
    `每字节 ${msPerByte.toFixed(3)} ms  →  bytesPerMs = ${(1 / msPerByte).toFixed(4)}`,
    msPerByte >= 2 && msPerByte <= 5
      ? '✅ 落在 spec §12 ② 的目标区间 2–5 ms/字节'
      : '⚠️ 不在 2–5 ms/字节的目标区间——波特率或分频器编码可能不对，先别往下走',
  ];
  if (metres) {
    const speed = metres / seconds;
    out.push(`车速 ${speed.toFixed(2)} m/s  →  MAX_COAST_MS=1000 时余程 ${speed.toFixed(2)} m`);
    out.push(Math.abs(speed - 1.5) < 0.7
      ? '✅ 与 spec §4.3「约 1.5 米」相符'
      : '⚠️ 与 spec §4.3「约 1.5 米」差得多——MAX_COAST_MS 要复核');
  }
  el('byteRateResult').textContent = out.join('\n');
  log(out.join('\n'));
});

// --- ⑧ 电机起动阈值 -----------------------------------------------------------

for (const button of document.querySelectorAll('[data-pulse]')) {
  const btn = /** @type {HTMLElement} */ (button);
  btn.addEventListener('click', async () => {
    const dev = requireFtdi();
    if (!dev) return;

    const ms = Number(btn.dataset.pulse);
    try {
      await dev.write(dev.buildStream(0x10, ms));
      log(`⑧ 脉冲 ${ms} ms——车动了吗？（要连试 10 次都动才算数）`);
    } catch (err) {
      const e = /** @type {Error} */ (err);
      log(`!! ${e.name}: ${e.message}`);
      setStatus(`写入失败：${e.message}`);
    }
  });
}

// --- 诊断 ---------------------------------------------------------------------

// 空 filter = 列出浏览器能看到的全部 USB 设备。用来判断板子是否枚举成功、
// 以及在哪个 VID:PID 下枚举——如果 picker 一直是灰的，先看这里。
el('scanAllBtn').addEventListener('click', async () => {
  const usb = navigator.usb;
  if (!usb) return;

  try {
    log('打开无 filter 的 picker（列出全部设备）...');
    const found = await usb.requestDevice({ filters: [] });
    log('设备已选择：');
    log(describeDevice(found));

    if (found.vendorId === FTDI_VID && found.productId === FT232H_PID) {
      log('=> 匹配 FT232H 的 filter；picker 本应列出它。');
    } else {
      log(`=> 不匹配 ${hex(FTDI_VID)}:${hex(FT232H_PID)} 的 filter。`);
      log('   这就是为什么设备没出现——需要更新 filter。');
    }
  } catch (err) {
    const e = /** @type {Error} */ (err);
    log(`!! ${e.name}: ${e.message}`);
    if (e.name === 'NotFoundError') {
      log('   NotFoundError = picker 被关掉、什么都没选。');
      log('   如果列表本身是空的，说明手机根本没枚举到这块板子');
      log('   （OTG 供电 / 数据线 / Android 权限的问题）。');
    }
  }
});

el('readPinsBtn').addEventListener('click', async () => {
  const dev = requireFtdi();
  if (!dev) return;
  try {
    await logPinState(dev);
  } catch (err) {
    const e = /** @type {Error} */ (err);
    log(`!! ${e.name}: ${e.message}`);
    setStatus(`读引脚失败：${e.message}`);
  }
});

el('listGrantedBtn').addEventListener('click', async () => {
  const usb = navigator.usb;
  if (!usb) return;

  const devices = await usb.getDevices();
  log(`此前已授权的设备：${devices.length}`);
  for (const d of devices) log(describeDevice(d));
});

el('copyLogBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(logText);
    setStatus('日志已复制到剪贴板');
  } catch {
    setStatus('复制失败——请手动选中日志文本');
  }
});

reportEnvironment();
