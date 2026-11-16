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
