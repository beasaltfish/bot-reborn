// The firmware console, exactly as firmware/main/console.c replies. Pure: a
// new state comes back, the caller decides when to apply and reboot.
import { SCREENS, screenById } from '../../core/screens.js';

const HELP = [
  '  wifi <ssid> [pass]   quote either to hold spaces; empty pass = open network',
  '  token <32 hex>       from the admin page',
  '  url ws://<ip>:8787/body | url auto   (auto: find the brain on the network)',
  '  cal                  show calibration',
  '  cal drive            swap forward/backward (decide this first)',
  '  cal steer            swap left/right',
  '  screen               list the screen models; screen <id> picks one, screen off removes it',
  '  show                 print what is stored (Wi-Fi password and token included)',
  '  reboot',
];

/** Split a console line into words; a quoted word may contain spaces. */
/** @param {string} line @returns {string[]} */
function words(line) {
  /** @type {string[]} */ const out = [];
  let word = '';
  let quoted = false;
  for (const ch of line.trim()) {
    if (ch === '"') { quoted = !quoted; continue; }
    if (!quoted && /\s/.test(ch)) {
      if (word) out.push(word);
      word = '';
      continue;
    }
    word += ch;
  }
  if (word) out.push(word);
  return out;
}

const yes = (/** @type {boolean} */ b) => (b ? 'yes' : 'no');

/**
 * @param {{ settings: import('../bench.js').Settings, firmware: import('./index.js').Firmware }} state
 * @param {string} line
 * @returns {{ settings: import('../bench.js').Settings, lines: string[], reboot?: boolean }}
 */
export function consoleCommand(state, line) {
  if (state.firmware.id !== 'body') return { settings: state.settings, lines: ['no console on this firmware'] };
  const [command, ...args] = words(line);
  const settings = state.settings;
  /** @type {string[]} */ const out = [];
  const save = (/** @type {string} */ what) => out.push(what ? `${what} saved` : 'saved');
  const rebootHint = () => out.push('type reboot to use it');

  switch (command) {
    case 'help':
      out.push(...HELP);
      break;
    case 'wifi': {
      if (!args[0]) { out.push('error: wifi needs an SSID'); break; }
      const next = { ...settings, ssid: args[0], pass: args[1] ?? '' };
      save('wifi');
      rebootHint();
      return { settings: next, lines: out };
    }
    case 'token': {
      if (!/^[0-9a-fA-F]{32}$/.test(args[0] ?? '')) { out.push('error: token needs 32 hex characters'); break; }
      out.push(`token ${args[0].slice(0, 4)}…`);
      save('');
      rebootHint();
      return { settings: { ...settings, token: args[0].toLowerCase() }, lines: out };
    }
    case 'url': {
      if (!args[0]) { out.push('error: url needs an address or auto'); break; }
      const url = args[0] === 'auto' ? '' : args[0];
      save('url');
      rebootHint();
      return { settings: { ...settings, url }, lines: out };
    }
    case 'cal': {
      if (args[0] === 'drive') {
        const next = { ...settings, calib: { ...settings.calib, driveSwapped: !settings.calib.driveSwapped } };
        save('calibration');
        out.push(`drive swapped: ${yes(next.calib.driveSwapped)}, steer swapped: ${yes(next.calib.steerSwapped)}`);
        return { settings: next, lines: out };
      }
      if (args[0] === 'steer') {
        const next = { ...settings, calib: { ...settings.calib, steerSwapped: !settings.calib.steerSwapped } };
        save('calibration');
        out.push(`drive swapped: ${yes(next.calib.driveSwapped)}, steer swapped: ${yes(next.calib.steerSwapped)}`);
        return { settings: next, lines: out };
      }
      if (args[0]) { out.push(`error: unknown cal command ${args[0]}`); break; }
      out.push(`drive swapped: ${yes(settings.calib.driveSwapped)}, steer swapped: ${yes(settings.calib.steerSwapped)}`);
      break;
    }
    case 'screen': {
      if (!args[0]) {
        for (const screen of SCREENS) {
          out.push(`  ${screen.id.padEnd(14)} ${screen.label.padEnd(22)} ${screen.verified ? 'verified' : 'unverified'}${settings.screen === screen.id ? '   <- selected' : ''}`);
        }
        if (!settings.screen) out.push('no screen selected');
        break;
      }
      if (args[0] === 'off') {
        save('screen');
        rebootHint();
        return { settings: { ...settings, screen: '' }, lines: out };
      }
      if (!screenById(args[0])) { out.push(`error: unknown screen ${args[0]}`); break; }
      save('screen');
      rebootHint();
      return { settings: { ...settings, screen: args[0] }, lines: out };
    }
    case 'show':
      out.push(
        `board.ssid=${settings.ssid}`,
        `board.pass=${settings.pass}`,
        `board.token=${settings.token}`,
        `board.url=${settings.url}`,
        `board.screen=${settings.screen}`,
        'board.end',
      );
      break;
    case 'reboot':
      return { settings, lines: out, reboot: true };
    case '':
      break;
    default:
      out.push('error: unknown command');
  }
  return { settings, lines: out };
}
