// The word-level half of the C-like firmware language. No DOM, no state.
// Positions are 1-based line/column so parse and runtime messages can point at
// the same place the editor shows.

const KEYWORDS = new Set([
  'void', 'int', 'long', 'float', 'bool', 'if', 'else', 'while', 'for', 'return',
  'true', 'false', 'HIGH', 'LOW', 'INPUT', 'OUTPUT', 'INPUT_PULLUP',
]);
const TWO = ['==', '!=', '<=', '>=', '&&', '||'];
const ONE = '=<>+-*/%!';
const PUNCT = '{}();,.';

/**
 * @typedef {{ kind: 'ident'|'number'|'string'|'keyword'|'operator'|'punct'|'eof', value: string, line: number, column: number }} Token
 */

/**
 * @param {string} source
 * @returns {Token[]}
 */
export function tokenize(source) {
  /** @type {Token[]} */
  const tokens = [];
  let i = 0;
  let line = 1;
  let column = 1;
  const advance = () => {
    const ch = source[i++];
    if (ch === '\n') { line += 1; column = 1; } else { column += 1; }
    return ch;
  };

  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) { advance(); continue; }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') advance();
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const startLine = line;
      advance(); advance();
      let closed = false;
      while (i < source.length) {
        if (source[i] === '*' && source[i + 1] === '/') { advance(); advance(); closed = true; break; }
        advance();
      }
      if (!closed) throw new SyntaxError(`line ${startLine}: unterminated comment`);
      continue;
    }

    const startLine = line;
    const startColumn = column;

    if (/[A-Za-z_]/.test(ch)) {
      let value = '';
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) value += advance();
      tokens.push({ kind: KEYWORDS.has(value) ? 'keyword' : 'ident', value, line: startLine, column: startColumn });
      continue;
    }

    if (/\d/.test(ch)) {
      let value = '';
      while (i < source.length && /[0-9]/.test(source[i])) value += advance();
      if (source[i] === '.' && /\d/.test(source[i + 1] ?? '')) {
        value += advance();
        while (i < source.length && /[0-9]/.test(source[i])) value += advance();
      }
      tokens.push({ kind: 'number', value, line: startLine, column: startColumn });
      continue;
    }

    if (ch === '"') {
      advance();
      let value = '';
      let closed = false;
      while (i < source.length) {
        const c = source[i];
        if (c === '"') { advance(); closed = true; break; }
        if (c === '\\') {
          advance();
          const escaped = advance();
          value += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped;
          continue;
        }
        value += advance();
      }
      if (!closed) throw new SyntaxError(`line ${startLine}: unterminated string`);
      tokens.push({ kind: 'string', value, line: startLine, column: startColumn });
      continue;
    }

    const pair = source.slice(i, i + 2);
    if (TWO.includes(pair)) {
      advance(); advance();
      tokens.push({ kind: 'operator', value: pair, line: startLine, column: startColumn });
      continue;
    }
    if (ONE.includes(ch)) {
      advance();
      tokens.push({ kind: 'operator', value: ch, line: startLine, column: startColumn });
      continue;
    }
    if (PUNCT.includes(ch)) {
      advance();
      tokens.push({ kind: 'punct', value: ch, line: startLine, column: startColumn });
      continue;
    }
    throw new SyntaxError(`line ${startLine}, column ${startColumn}: unexpected '${ch}'`);
  }

  tokens.push({ kind: 'eof', value: '', line, column });
  return tokens;
}
