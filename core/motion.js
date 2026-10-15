// Motion timing shared by the phone's executor and the brain server's remote
// one. It lived in executor.js until the server needed it, and importing it
// from there drags ftdi.js — WebUSB — into a process that has no USB to speak
// to (server/body split spec §4).

/** Longest the car may coast with nobody in control (spec §4.3). */
export const MAX_COAST_MS = 1000;

/** How early the next slice is queued so the car does not stutter (spec §4.3). */
export const LEAD_MS = 300;

/**
 * Shortest action the executor will emit.
 *
 * PLACEHOLDER pending calibration item ⑧ (spec §12) — this is the *motor's*
 * static-friction threshold, not yet measured. If ⑧ measures a threshold above
 * 300, raise this.
 *
 * It is NOT coupled to LEAD_MS, whatever spec §6.6 says. That claim rested on
 * `sleep(slice - LEAD_MS)` going negative below LEAD_MS, and it was only ever
 * true of the *first* slice: the slicer emits the remainder as the last slice,
 * so any total in (MAX_COAST_MS, MAX_COAST_MS + LEAD_MS) — move(1200), say —
 * produced a sub-LEAD_MS final slice however high this floor was. The renewal
 * loop below now waits on the tracked queue and clamps at zero, which is what
 * actually removes the negative sleep. Raising or lowering this bound cannot
 * reintroduce it.
 */
export const MIN_DURATION_MS = 300;
