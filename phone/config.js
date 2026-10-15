// What this phone keeps about itself, and the only phone module that touches
// localStorage. A character's keys, voice and wake word live on the brain
// (server/body split spec §1.1); calibration describes the wiring of the car
// this phone rides on, so it stays here (§1.1, "硬件校准不在这里").

export const CONFIG_KEY = 'botreborn.body';

/** @returns {BodyConfig} */
export function defaultConfig() {
  return {
    // English by default, for the reason core/config.js gives.
    lang: 'en',
    // Which character this body is. Set by scanning the admin page's code.
    token: null,
    // null is "never measured" — see the note on calibration in core/config.js.
    calibration: { steerSwapped: null, driveSwapped: null, bytesPerMs: null },
  };
}

/** @param {StorageLike} [storage] @returns {BodyConfig} */
export function loadConfig(storage = globalThis.localStorage) {
  const d = defaultConfig();
  try {
    const raw = storage?.getItem(CONFIG_KEY);
    if (!raw) return d;
    const p = JSON.parse(raw);
    return {
      lang: p.lang ?? d.lang,
      token: typeof p.token === 'string' ? p.token : null,
      calibration: { ...d.calibration, ...p.calibration },
    };
  } catch {
    return d;
  }
}

/** @param {BodyConfig} cfg @param {StorageLike} [storage] */
export function saveConfig(cfg, storage = globalThis.localStorage) {
  storage?.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

/**
 * The token the admin page's QR code carries: it opens /phone/#token=<hex>.
 * In the fragment, so it never reaches a server log. Exactly what
 * server/characters.js makes — 16 random bytes in lowercase hex — or nothing.
 *
 * @param {string} hash location.hash
 * @returns {string | null}
 */
export function tokenFromHash(hash) {
  const m = /(?:^#|&)token=([0-9a-f]{32})(?:&|$)/.exec(hash);
  return m ? m[1] : null;
}

/**
 * Both answers, not one: a car that knows left from right but not forward
 * from backward drives into the wall behind it on its first command.
 * @param {Calibration} cal
 */
export function directionsTaught(cal) {
  return cal.steerSwapped !== null && cal.driveSwapped !== null;
}

/**
 * @typedef {{ getItem(key: string): string | null, setItem(key: string, value: string): void }} StorageLike
 * @typedef {{ steerSwapped: boolean | null, driveSwapped: boolean | null, bytesPerMs: number | null }} Calibration
 * @typedef {{ lang: 'en' | 'zh', token: string | null, calibration: Calibration }} BodyConfig
 */
