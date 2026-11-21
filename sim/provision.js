// What a plan still needs typed into the firmware console. Pure; the serial
// panel is the only place that types it.
/** @param {import('./plan.js').Plan} plan @returns {string | null} */
export function planScreen(plan) {
  const part = plan.parts.find((p) => p.part.startsWith('screen-'));
  return part ? part.part.slice('screen-'.length) : null;
}

/** @param {import('./plan.js').Plan | null} plan @param {import('./bench.js').Settings} settings */
export function provisionPlan(plan, settings) {
  /** @type {('token'|'screen')[]} */
  const missing = [];
  if (plan?.connection === 'body' && !settings.token) missing.push('token');
  const screen = plan ? planScreen(plan) : null;
  if (screen && !settings.screen) missing.push('screen');
  return { missing, screen };
}

/**
 * The characters that could be paired right now: ready and not already online.
 * Capability is deliberately not a filter here; it only affects the last step
 * of a demo, never pairing.
 * @param {{ id: string, name: string, ready?: boolean, online?: boolean, motion?: string }[]} list
 */
export function tokenCandidates(list) {
  return (Array.isArray(list) ? list : []).filter((c) => c.ready && !c.online);
}

/**
 * A bench wired by hand has no demo to say which character it means, so the
 * serial panel offers the list itself. Only an unpaired local body qualifies.
 * @param {{ firmware: string, settings: { token?: string }, remote: boolean,
 *            characters: { id: string, name: string, ready?: boolean, online?: boolean }[] }} o
 * @returns {{ show: boolean, list: { id: string, name: string, ready?: boolean, online?: boolean }[] }}
 */
export function manualPairing(o) {
  const show = o.firmware === 'body' && !o.remote && !o.settings.token;
  return { show, list: tokenCandidates(o.characters) };
}

/**
 * Withdraw the manual picker: hidden helper and no choices. Used when the board
 * is not a booted local body, including while the ROM bootloader is open.
 * @param {{
 *   setCharacterHelper(enabled: boolean): void,
 *   setCharacters(list: { id: string, name: string }[]): void,
 * }} panel
 */
export function withdrawManualPairing(panel) {
  panel.setCharacterHelper(false);
  panel.setCharacters([]);
}

/**
 * Show the serial panel for the ROM bootloader. It is not a booted body, so an
 * earlier boot's pairing choices are withdrawn before the panel appears.
 * @param {{
 *   show(visible: boolean): void,
 *   setCharacterHelper(enabled: boolean): void,
 *   setCharacters(list: { id: string, name: string }[]): void,
 * }} panel
 */
export function showBootloader(panel) {
  withdrawManualPairing(panel);
  panel.show(true);
}

/**
 * Paint the manual picker for the board as it is now. A board that no longer
 * qualifies — paired, remote, or another firmware — gets a hidden, empty
 * picker so choices from an earlier boot cannot be used.
 * @param {{
 *   firmware: string,
 *   settings: { token?: string },
 *   remote: boolean,
 *   characters: { id: string, name: string, ready?: boolean, online?: boolean }[],
 *   panel: {
 *     setCharacterHelper(enabled: boolean): void,
 *     setCharacters(list: { id: string, name: string }[]): void,
 *   },
 * }} o
 * @returns {'shown'|'empty'|'ineligible'}
 */
export function paintManualPairing(o) {
  const manual = manualPairing(o);
  if (!manual.show) {
    withdrawManualPairing(o.panel);
    return 'ineligible';
  }
  o.panel.setCharacterHelper(!o.remote);
  o.panel.setCharacters(manual.list.map((c) => ({ id: c.id, name: c.name })));
  return manual.list.length ? 'shown' : 'empty';
}

/**
 * The manual pairing branch of a boot: ask the brain for its characters, then
 * paint the picker only if this boot is still current and the board still
 * qualifies. A late answer from a boot the user has left is dropped.
 * @param {{
 *   characters(): Promise<{ id: string, name: string, ready?: boolean, online?: boolean }[]>,
 *   isCurrent(): boolean,
 *   board(): { firmware: string, settings: { token?: string, url: string } },
 *   origin: string,
 *   panel: {
 *     show(visible: boolean): void,
 *     setCharacterHelper(enabled: boolean): void,
 *     setCharacters(list: { id: string, name: string }[]): void,
 *   },
 * }} o
 * @returns {Promise<'shown'|'empty'|'stale'|'ineligible'>}
 */
export async function bootManualPairing(o) {
  const characters = await o.characters();
  if (!o.isCurrent()) return 'stale';
  const board = o.board();
  const status = paintManualPairing({
    firmware: board.firmware,
    settings: board.settings,
    remote: isRemote(board.settings.url, o.origin),
    characters,
    panel: o.panel,
  });
  if (status !== 'ineligible') o.panel.show(true);
  return status;
}

/** @param {string} url @param {string} origin */
export function isRemote(url, origin) {
  if (!url) return false;
  try { return new URL(url, origin).host !== new URL(origin).host; } catch { return true; }
}

/** @param {import('./plan.js').Plan | null} plan @param {import('./bench.js').Settings} settings */
export function screenMismatch(plan, settings) {
  const screen = plan ? planScreen(plan) : null;
  return Boolean(screen && settings.screen && settings.screen !== screen);
}

/**
 * The console lines the plan needs, given the token the helper found. The
 * firmware requires a reboot after `token`/`screen`, which the caller types
 * next; nothing here writes settings directly.
 * @param {import('./plan.js').Plan | null} plan
 * @param {import('./bench.js').Settings} settings
 * @param {{ token?: string, replaceScreen?: boolean }} [o]
 * @returns {{ commands: string[], missing: ('token'|'screen')[], screen: string | null, mismatch: boolean }}
 */
export function provisionSteps(plan, settings, { token = '', replaceScreen = true } = {}) {
  const { missing, screen } = provisionPlan(plan, settings);
  const mismatch = screenMismatch(plan, settings);
  /** @type {string[]} */ const commands = [];
  if (missing.includes('token') && token) commands.push(`token ${token}`);
  if (screen && (missing.includes('screen') || (mismatch && replaceScreen))) commands.push(`screen ${screen}`);
  return { commands, missing, screen, mismatch };
}

/**
 * Type a plan's commands into the serial console, reboot once, and wait a
 * bounded window (15 s) for the board to reach the brain. The four ways to
 * hand control back are the plan's: welcomed, gave-up, still-retrying and
 * skipped. Cancelling stops the waiting only; the firmware keeps retrying.
 * @param {{
 *   commands: string[],
 *   panel: { type(line: string): void },
 *   reboot(): void,
 *   timeoutMs?: number,
 *   timers?: { setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout },
 *   onDone?(result: 'welcomed'|'gave-up'|'still-retrying'|'skipped'|'cancelled'): void,
 * }} o
 */
export function createProvisioning(o) {
  const timers = o.timers ?? { setTimeout, clearTimeout };
  let started = false;
  let settled = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;

  /** @param {'welcomed'|'gave-up'|'still-retrying'|'skipped'|'cancelled'} result */
  function finish(result) {
    if (settled) return false;
    settled = true;
    if (timer !== undefined) timers.clearTimeout(timer);
    o.onDone?.(result);
    return true;
  }

  return {
    start() {
      if (started || settled) return;
      started = true;
      for (const line of o.commands) o.panel.type(line);
      if (o.commands.length) o.reboot();
      timer = timers.setTimeout(() => finish('still-retrying'), o.timeoutMs ?? 15000);
    },
    welcomed: () => finish('welcomed'),
    gaveUp: () => finish('gave-up'),
    skip: () => finish('skipped'),
    cancel: () => finish('cancelled'),
    get done() { return settled; },
  };
}
