// Compile the C-like firmware source into an AST plus positioned errors.
import { tokenize } from './lexer.js';
import { parse } from './parser.js';
import { createMachine } from './interpreter.js';

/** @typedef {{ line: number, column: number, message: string }} CompileError */

export { createMachine };

/**
 * @param {string} source
 * @returns {{ program: any | null, errors: CompileError[] }}
 */
export function compile(source) {
  try {
    const program = parse(tokenize(source));
    return { program, errors: [] };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    const position = text.match(/^line (\d+)(?:, column (\d+))?: /);
    return {
      program: null,
      errors: [{
        line: /** @type {any} */ (error).line ?? (position ? Number(position[1]) : 1),
        column: /** @type {any} */ (error).column ?? (position?.[2] ? Number(position[2]) : 1),
        message: text.replace(/^line \d+(?:, column \d+)?: /, ''),
      }],
    };
  }
}
