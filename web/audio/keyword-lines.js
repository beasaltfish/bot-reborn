// Keyword lines are validated here BEFORE createKws() ever sees them.
//
// EncodeBase() in sherpa-onnx/csrc/utils.cc parses each line token by token.
// An unknown token makes EncodeKeywords() return false, InitKeywords() answers
// that with SHERPA_ONNX_EXIT(-1), and in wasm that aborts the entire module —
// the page has to be reloaded before anything can try again. It fails loudly
// and takes the runtime with it, so the check has to happen out here.
//
// Pure functions only. This module is the reason `tokens.txt` is copied into
// web/models/kws/ next to the four run-time files even though the .data bundle
// already contains a copy of it.

export const WAKE = 'wake';
export const STOP = 'stop';

/**
 * A token line is "<symbol> <id>"; only the symbol may appear in a keyword.
 * @param {string} tokensText
 * @returns {Set<string>}
 */
export function parseTokens(tokensText) {
  return new Set(
    tokensText.split('\n').map((l) => l.split(' ')[0]).filter(Boolean),
  );
}

/** Anything whose first character is one of these is a flag, not a token:
 *  `:` boost score, `#` triggering threshold, `@` reported label. */
const FLAGS = ':#@';

/**
 * @param {string} lines one or more keyword lines
 * @param {Set<string>} tokens
 * @returns {string[]} every token this model does not know; empty means safe
 */
export function unknownTokens(lines, tokens) {
  return lines
    .split('\n')
    .flatMap((line) => line.trim().split(/\s+/))
    .filter(Boolean)
    .filter((word) => !FLAGS.includes(word[0]))
    .filter((word) => !tokens.has(word));
}

/**
 * @param {string} lines
 * @returns {string[]} the `@label` of each line, without the `@`
 */
export function labelsIn(lines) {
  return lines
    .split('\n')
    .flatMap((line) => line.trim().split(/\s+/))
    .filter((word) => word.startsWith('@'))
    .map((word) => word.slice(1));
}

/**
 * Which of the two words a reported label belongs to. The `_zh` variants are
 * the dual spelling of the SAME word (§11.2) — one word, two ways of saying it
 * — not a second keyword, so they must classify identically.
 *
 * @param {string} label
 * @returns {'wake' | 'stop' | null}
 */
export function classifyLabel(label) {
  return label.startsWith('all_stop') ? STOP
    : label.startsWith('hey_steven') ? WAKE
    : null;
}
