// The one status light, with the firmware's own duty table
// (firmware/components/body_logic/led_table.c). `onMs: 1` means steady.
const PATTERNS = {
  NO_WIFI: { onMs: 100, offMs: 100 },
  CONNECTING: { onMs: 100, offMs: 900 },
  REJECTED: { onMs: 1000, offMs: 1000 },
  SLEEPING: { onMs: 50, offMs: 2950 },
  LISTENING: 'solid',
  CAPTURING: { onMs: 50, offMs: 50 },
  THINKING: { onMs: 250, offMs: 250 },
  SPEAKING: 'solid',
};

/** @param {string} mode @returns {{ onMs: number, offMs: number } | 'solid'} */
export function ledPattern(mode) {
  return PATTERNS[mode] ?? PATTERNS.NO_WIFI;
}
