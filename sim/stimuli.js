// Session-only environment inputs; these are deliberately not bench properties.
export const STIMULUS_LIMITS = /** @type {const} */ ({
  temperatureC: [-40, 85], humidityPct: [0, 100], pressureHpa: [300, 1100],
});

export function defaultStimuli() {
  return { temperatureC: 22, humidityPct: 50, pressureHpa: 1013.25 };
}

/** @param {ReturnType<typeof defaultStimuli>} state @param {string} key @param {unknown} value */
export function setStimulus(state, key, value) {
  if (!Object.hasOwn(STIMULUS_LIMITS, key) || typeof value !== 'number' || !Number.isFinite(value)) return state;
  const [min, max] = STIMULUS_LIMITS[/** @type {keyof typeof STIMULUS_LIMITS} */ (key)];
  return { ...state, [key]: Math.min(max, Math.max(min, value)) };
}
