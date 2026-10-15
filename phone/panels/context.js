// What the pin bench is handed, and nothing more. The audio panels that also
// took a microphone and the wasm engines left with those engines (phone-body
// plan, Task 8).

/**
 * @typedef {'go' | 'wait' | 'dim'} StatusState
 *
 * @typedef {{
 *   log: (msg: string) => void,
 *   status: (id: string, state: StatusState, label: string) => void,
 *   ftdi: import('../ftdi.js').Ftdi | null,
 *   executor: import('../executor.js').Executor | null,
 *   armStop: (on: boolean) => void,
 * }} DevContext
 */

export {};
