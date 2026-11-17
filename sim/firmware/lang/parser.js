// Recursive-descent parser for the bounded C-like firmware language.
// The top level is only `void setup()` / `void loop()`; statements and
// expressions are the subset the interpreter can actually run.

const TYPES = new Set(['int', 'long', 'float', 'bool']);
const CONSTANTS = new Set(['HIGH', 'LOW', 'INPUT', 'OUTPUT', 'INPUT_PULLUP']);

/** @param {import('./lexer.js').Token[]} tokens */
export function parse(tokens) {
  let i = 0;
  /** @param {import('./lexer.js').Token} token @param {string} message */
  const fail = (token, message) => {
    const error = new SyntaxError(`line ${token.line}, column ${token.column}: ${message}`);
    // @ts-expect-error carry the position for compile()
    error.line = token.line;
    // @ts-expect-error carry the position for compile()
    error.column = token.column;
    throw error;
  };
  const peek = () => tokens[i];
  const at = (/** @type {string} */ value) => peek().value === value;
  const next = () => tokens[i++];
  /** @param {string} value */
  const expect = (value) => {
    if (!at(value)) fail(peek(), `expected '${value}'`);
    return next();
  };

  /** @param {string} message @returns {any} */
  function block(message = "expected '{'") {
    expect('{');
    /** @type {any[]} */
    const body = [];
    while (!at('}')) {
      if (peek().kind === 'eof') fail(peek(), message);
      const statement = parseStatement();
      if (statement) body.push(statement);
    }
    expect('}');
    return { type: 'Block', body };
  }

  /** @returns {any} */
  function parseProgram() {
    /** @type {{ setup: any, loop: any }} */
    const program = { setup: null, loop: null };
    while (peek().kind !== 'eof') {
      expect('void');
      const name = next();
      if (name.kind !== 'ident' || !['setup', 'loop'].includes(name.value)) fail(name, 'only setup() and loop() can be defined');
      expect('(');
      expect(')');
      const body = block();
      if (program[/** @type {'setup'|'loop'} */ (name.value)]) fail(name, `duplicate ${name.value}()`);
      program[/** @type {'setup'|'loop'} */ (name.value)] = body;
    }
    return program;
  }

  /** @returns {any} */
  function parseStatement() {
    const token = peek();
    if (at('{')) return block();
    if (at(';')) { next(); return null; }
    if (TYPES.has(token.value)) return declaration();
    if (at('if')) return ifStatement();
    if (at('while')) return whileStatement();
    if (at('for')) return forStatement();
    if (at('return')) {
      next();
      expect(';');
      return { type: 'Return', line: token.line };
    }
    if (token.kind === 'ident' && tokens[i + 1]?.value === '=') return assignment();
    const expr = expression();
    expect(';');
    return { type: 'ExprStmt', expr, line: token.line };
  }

  /** @returns {any} */
  function declaration() {
    const type = next();
    const name = next();
    if (name.kind !== 'ident') fail(name, 'expected a variable name');
    /** @type {any} */
    const statement = { type: 'VarDecl', typeName: type.value, name: name.value, init: null, line: type.line };
    if (at('=')) { next(); statement.init = expression(); }
    expect(';');
    return statement;
  }

  /** @returns {any} */
  function assignment() {
    const name = next();
    expect('=');
    const value = expression();
    expect(';');
    return { type: 'Assign', name: name.value, value, line: name.line };
  }

  /** @returns {any} */
  function ifStatement() {
    const token = next();
    expect('(');
    const test = expression();
    expect(')');
    /** @type {any} */ const then = parseStatement();
    /** @type {any} */
    let otherwise = null;
    if (at('else')) { next(); otherwise = parseStatement(); }
    return { type: 'If', test, then, else: otherwise, line: token.line };
  }

  /** @returns {any} */
  function whileStatement() {
    const token = next();
    expect('(');
    const test = expression();
    expect(')');
    return { type: 'While', test, body: parseStatement(), line: token.line };
  }

  /** @returns {any} */
  function forStatement() {
    const token = next();
    expect('(');
    /** @type {any} */
    let init = null;
    if (at(';')) next();
    else if (TYPES.has(peek().value)) {
      const type = next();
      const name = next();
      if (name.kind !== 'ident') fail(name, 'expected a variable name');
      init = { type: 'VarDecl', typeName: type.value, name: name.value, init: null, line: type.line };
      if (at('=')) { next(); init.init = expression(); }
      expect(';');
    } else {
      const name = next();
      expect('=');
      init = { type: 'Assign', name: name.value, value: expression(), line: name.line };
      expect(';');
    }
    /** @type {any} */
    let test = null;
    if (!at(';')) test = expression();
    expect(';');
    /** @type {any} */
    let update = null;
    if (!at(')')) {
      const name = next();
      if (name.kind !== 'ident') fail(name, 'expected an assignment in for(...)');
      expect('=');
      update = { type: 'Assign', name: name.value, value: expression(), line: name.line };
    }
    expect(')');
    return { type: 'For', init, test, update, body: parseStatement(), line: token.line };
  }

  /** @returns {any} */
  function expression() { return or(); }
  /** @returns {any} */
  function or() {
    /** @type {any} */ let left = and();
    while (at('||')) { const op = next(); left = { type: 'Binary', op: op.value, left, right: and(), line: op.line }; }
    return left;
  }
  /** @returns {any} */
  function and() {
    /** @type {any} */ let left = equality();
    while (at('&&')) { const op = next(); left = { type: 'Binary', op: op.value, left, right: equality(), line: op.line }; }
    return left;
  }
  /** @returns {any} */
  function equality() {
    /** @type {any} */ let left = relational();
    while (at('==') || at('!=')) { const op = next(); left = { type: 'Binary', op: op.value, left, right: relational(), line: op.line }; }
    return left;
  }
  /** @returns {any} */
  function relational() {
    /** @type {any} */ let left = additive();
    while (at('<') || at('>') || at('<=') || at('>=')) { const op = next(); left = { type: 'Binary', op: op.value, left, right: additive(), line: op.line }; }
    return left;
  }
  /** @returns {any} */
  function additive() {
    /** @type {any} */ let left = multiplicative();
    while (at('+') || at('-')) { const op = next(); left = { type: 'Binary', op: op.value, left, right: multiplicative(), line: op.line }; }
    return left;
  }
  /** @returns {any} */
  function multiplicative() {
    /** @type {any} */ let left = unary();
    while (at('*') || at('/') || at('%')) { const op = next(); left = { type: 'Binary', op: op.value, left, right: unary(), line: op.line }; }
    return left;
  }
  /** @returns {any} */
  function unary() {
    if (at('!') || at('-') || at('+')) {
      const op = next();
      return { type: 'Unary', op: op.value, arg: unary(), line: op.line };
    }
    return primary();
  }
  /** @returns {any} */
  function primary() {
    const token = peek();
    if (token.kind === 'number') { next(); return { type: 'Literal', value: Number(token.value), line: token.line }; }
    if (token.kind === 'string') { next(); return { type: 'Literal', value: token.value, line: token.line }; }
    if (at('true') || at('false')) { next(); return { type: 'Literal', value: token.value === 'true', line: token.line }; }
    if (at('(')) { next(); /** @type {any} */ const expr = expression(); expect(')'); return expr; }
    if (token.kind === 'ident' || CONSTANTS.has(token.value)) {
      next();
      if (at('(')) {
        next();
        /** @type {any[]} */
        const args = [];
        if (!at(')')) {
          args.push(expression());
          while (at(',')) { next(); args.push(expression()); }
        }
        expect(')');
        return { type: 'Call', name: token.value, object: null, args, line: token.line };
      }
      if (at('.')) {
        next();
        const member = next();
        if (member.kind !== 'ident') fail(member, 'expected a member name');
        expect('(');
        /** @type {any[]} */
        const args = [];
        if (!at(')')) {
          args.push(expression());
          while (at(',')) { next(); args.push(expression()); }
        }
        expect(')');
        return { type: 'Call', name: member.value, object: token.value, args, line: token.line };
      }
      return { type: 'Ident', name: token.value, line: token.line };
    }
    return fail(token, 'expected an expression');
  }

  return parseProgram();
}
