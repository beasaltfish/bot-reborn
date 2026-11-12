export const SIM_LANGUAGE_KEY = 'botreborn.sim.language';

/** @param {unknown} saved @returns {'en'|'zh'} */
export function simulatorLanguage(saved) {
  return saved === 'zh' ? 'zh' : 'en';
}

/** @param {'en'|'zh'} lang @param {{confirm():boolean, save(lang:'en'|'zh'):void, reload():void}} actions */
export function requestLanguageChange(lang, actions) {
  if (!actions.confirm()) return false;
  try { actions.save(lang); } catch { return false; }
  actions.reload();
  return true;
}
