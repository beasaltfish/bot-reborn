// The body firmware's boot, as a list of timed events. Pure: no timers, no
// DOM. docs/superpowers/specs/2026-11-16-firmware-layer-design.md §8 and the
// C in firmware/main/main.c are the authority for the order and the strings.
import { screenById, IDENTITY_CONTROLLERS } from '../../core/screens.js';
import { PROTOCOL } from '../../core/protocol.js';

/**
 * @typedef {'NO_WIFI'|'CONNECTING'|'REJECTED'|'SLEEPING'|'LISTENING'|'CAPTURING'|'THINKING'|'SPEAKING'} LedMode
 * @typedef {{ afterMs: number, line?: string, led?: LedMode, link?: 'open'|'screen' }} BootEvent
 */



/**
 * @param {{
 *   settings: import('../bench.js').Settings,
 *   firmware: import('./index.js').Firmware,
 *   bench: import('../bench.js').Bench,
 *   outcome: Record<string, any>,
 *   profile?: unknown,
 *   now?: number,
 * }} o
 * @returns {BootEvent[]}
 */
export function bodyBoot({ settings, firmware, bench, outcome }) {
  /** @type {BootEvent[]} */
  const events = [];
  /** @param {number} afterMs @param {Omit<BootEvent, 'afterMs'>} e */
  const at = (afterMs, e) => events.push({ afterMs, ...e });

  const selected = settings.screen ? screenById(settings.screen) : undefined;
  let screenReady = false;
  if (!settings.screen) {
    at(0, { line: 'no screen selected: type screen to list models, screen <id> to pick one' });
  } else if (!selected || !firmware.drivers.includes(`screen-${selected.id}`)) {
    at(0, { line: `screen "${settings.screen}" is not a model this firmware knows: type screen for the list` });
  } else {
    screenReady = true;
    // The identity line exists only for the two controllers whose response the
    // firmware actually checks. No MISO, an unknown answer, or a controller the
    // firmware cannot name: the real firmware says nothing, so this says nothing.
    const wired = outcome.screenModel ? screenById(outcome.screenModel) : undefined;
    if (wired && IDENTITY_CONTROLLERS.has(selected.controller) && IDENTITY_CONTROLLERS.has(wired.controller)) {
      at(0, {
        line: wired.controller === selected.controller
          ? `screen: panel identifies as ${selected.label}, as chosen`
          : `screen: you chose ${selected.label} but the panel answers like ${wired.label}`,
      });
    }
  }

  at(0, { line: `body: protocol ${PROTOCOL}, brain at ${settings.url || 'auto (found on the network)'}` });

  if (!settings.ssid || !settings.token) {
    at(0, { line: `not set up: type ${!settings.ssid ? 'wifi <ssid> [pass]' : 'token <32 hex>'}, then reboot (help lists commands)` });
    return events;
  }

  if (firmware.link) {
    at(0, { line: settings.url ? `dialing ${settings.url}` : 'looking for the brain on the network', led: 'CONNECTING' });
    at(500, { link: 'open' });
  }

  const imu = bench.placed.find((part) => part.part === 'mpu6050');
  const awake = imu ? outcome.parts?.[imu.id]?.awake === true : false;
  at(0, awake
    ? { line: 'wand: MPU-6050 found' }
    : { line: 'wand: no MPU-6050 answered on SDA=1 SCL=2; shaking is off' });

  if (firmware.link?.screen && screenReady) at(700, { link: 'screen' });

  return events;
}
