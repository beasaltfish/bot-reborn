// What every panel is handed, and nothing more.
//
// Its own module rather than a typedef in the entry file: a panel that imported
// the entry file for a type would make the dependency point the wrong way — the
// page knows about its panels, never the other way round.
//
// `pipeline` and `sherpa` are nullable because two of the panels run before
// either exists. The pin bench and the connectivity test are what you reach for
// when nothing works yet — a fresh clone, a just-soldered board, no key typed —
// so they must not wait on a microphone or on 18 MB of wasm.

/**
 * @typedef {'go' | 'wait' | 'dim'} StatusState
 *
 * @typedef {{
 *   pipeline: import('../audio/pipeline.js').AudioPipeline | null,
 *   sherpa: import('../audio/sherpa.js').Sherpa | null,
 *   keywords: string,
 *   config: import('../config.js').Config,
 *   log: (msg: string) => void,
 *   status: (id: string, state: StatusState, label: string) => void,
 *   exclusion: ReturnType<typeof import('./knobs.js').createExclusion>,
 *   ftdi: import('../ftdi.js').Ftdi | null,
 *   executor: import('../executor.js').Executor | null,
 *   knobs: { readonly executor: import('../executor.js').Executor | null },
 *   armStop: (on: boolean) => void,
 * }} DevContext
 *
 * What the four audio panels get instead. They only ever start after the
 * microphone is open and the model is in, so their two nullable fields are not
 * nullable for them — and narrowing once here beats a null check in every panel
 * that could only ever be dead code.
 *
 * @typedef {DevContext & {
 *   pipeline: import('../audio/pipeline.js').AudioPipeline,
 *   sherpa: import('../audio/sherpa.js').Sherpa,
 * }} AudioContext
 */

export {};
