// A cooperative tree-walking interpreter for the bounded C-like language.
// The machine owns the program state; each tick runs setup once, then one
// loop() call. Task 5 adds the time budget, delay and watchdogs.

/** @type {Record<string, number>} */
const CONSTANTS = { HIGH: 1, LOW: 0, INPUT: 0, OUTPUT: 1, INPUT_PULLUP: 2 };

class ReturnSignal {}

class Env {
  /** @param {Env | null} [parent] */
  constructor(parent = null) {
    this.parent = parent;
    /** @type {Map<string, any>} */
    this.vars = new Map();
  }
  /** @param {string} name @returns {any} */
  get(name) {
    if (this.vars.has(name)) return this.vars.get(name);
    if (this.parent) return this.parent.get(name);
    if (Object.hasOwn(CONSTANTS, name)) return CONSTANTS[name];
    throw new Error(`unknown name ${name}`);
  }
  /** @param {string} name @param {any} value */
  set(name, value) {
    /** @type {Env | null} */ let env = this;
    while (env) {
      if (env.vars.has(name)) { env.vars.set(name, value); return; }
      env = env.parent;
    }
    this.vars.set(name, value);
  }
  /** @param {string} name @param {any} value */
  declare(name, value) { this.vars.set(name, value); }
}

/** Truthiness for C-like values; strings are true when non-empty. */
/** @param {any} value @returns {boolean} */
const truthy = (value) => (typeof value === 'string' ? value.length > 0 : Boolean(value));

/** @param {any} value @returns {string} */
const asText = (value) => (typeof value === 'boolean' ? String(value) : String(value));

/**
 * @param {any} ast
 * @param {any} initial
 * @param {any} ctx
 * @param {(entry: any) => void} trace
 */
function runBlock(ast, initial, ctx, trace) {
  const exec = (/** @type {any} */ statement, /** @type {Env} */ env) => {
    const record = (/** @type {Record<string, any>} */ entry) => trace({ line: statement.line, ...entry });
    switch (statement.type) {
      case 'Block': {
        const child = new Env(env);
        for (const item of statement.body) exec(item, child);
        return;
      }
      case 'VarDecl': {
        const value = statement.init ? evaluate(statement.init, env) : 0;
        env.declare(statement.name, value);
        record({ kind: 'statement' });
        return;
      }
      case 'Assign':
        env.set(statement.name, evaluate(statement.value, env));
        record({ kind: 'statement' });
        return;
      case 'ExprStmt':
        record({ kind: 'statement' });
        evaluate(statement.expr, env);
        return;
      case 'If':
        record({ kind: 'statement' });
        if (truthy(evaluate(statement.test, env))) exec(statement.then, env);
        else if (statement.else) exec(statement.else, env);
        return;
      case 'While':
        record({ kind: 'statement' });
        while (truthy(evaluate(statement.test, env))) exec(statement.body, env);
        return;
      case 'For': {
        record({ kind: 'statement' });
        const child = new Env(env);
        if (statement.init) exec({ ...statement.init, line: statement.line }, child);
        while (!statement.test || truthy(evaluate(statement.test, child))) {
          exec(statement.body, child);
          if (statement.update) exec(statement.update, child);
        }
        return;
      }
      case 'Return':
        record({ kind: 'statement' });
        throw new ReturnSignal();
      default:
        throw new Error(`unknown statement ${statement.type}`);
    }
  };

  /** @param {any} expr @param {Env} env @returns {any} */
  function evaluate(expr, env) {
    switch (expr.type) {
      case 'Literal': return expr.value;
      case 'Ident': return env.get(expr.name);
      case 'Unary': {
        const value = evaluate(expr.arg, env);
        if (expr.op === '!') return !truthy(value);
        if (expr.op === '-') return -Number(value);
        return Number(value);
      }
      case 'Binary': {
        if (expr.op === '&&') return truthy(evaluate(expr.left, env)) && truthy(evaluate(expr.right, env));
        if (expr.op === '||') return truthy(evaluate(expr.left, env)) || truthy(evaluate(expr.right, env));
        const a = evaluate(expr.left, env);
        const b = evaluate(expr.right, env);
        switch (expr.op) {
          case '+': return a + b;
          case '-': return Number(a) - Number(b);
          case '*': return Number(a) * Number(b);
          case '/': return Number(a) / Number(b);
          case '%': return Number(a) % Number(b);
          case '==': return a === b;
          case '!=': return a !== b;
          case '<': return Number(a) < Number(b);
          case '>': return Number(a) > Number(b);
          case '<=': return Number(a) <= Number(b);
          case '>=': return Number(a) >= Number(b);
          default: throw new Error(`unknown operator ${expr.op}`);
        }
      }
      case 'Call': {
        const args = expr.args.map((/** @type {any} */ arg) => evaluate(arg, env));
        if (expr.object === 'Serial') {
          if (expr.name === 'begin') return null;
          if (expr.name === 'print' || expr.name === 'println') {
            const text = args.map(asText).join('');
            ctx.log(text);
            trace({ line: expr.line, kind: 'log', text });
            return null;
          }
          throw new Error(`unknown Serial.${expr.name}`);
        }
        switch (expr.name) {
          case 'pinMode':
            return null;
          case 'digitalWrite': {
            const pin = Number(args[0]);
            const level = Number(args[1]) ? 'high' : 'low';
            ctx.pin(`GPIO${pin}`, level);
            trace({ line: expr.line, kind: 'statement', writes: [{ target: `GPIO${pin}`, level }] });
            return null;
          }
          case 'digitalRead': {
            const pin = Number(args[0]);
            const level = ctx.read(pin) === 'LOW' ? 0 : 1;
            trace({ line: expr.line, kind: 'statement', reads: [{ pin, level: level ? 'HIGH' : 'LOW' }] });
            return level;
          }
          case 'delay':
            throw new Error('delay is not available yet');
          case 'millis':
            return 0;
          default:
            throw new Error(`unknown function ${expr.name}`);
        }
      }
      default:
        throw new Error(`unknown expression ${expr.type}`);
    }
  }

  exec(ast, initial);
}

/**
 * @param {{
 *   program: any,
 *   now?: () => number,
 * }} o
 */
export function createMachine({ program, now = () => performance.now() }) {
  let phase = /** @type {'setup'|'loop'|'waiting'|'stopped'} */ ('stopped');
  let tickIndex = 0;
  let startedAt = 0;
  let stopped = false;
  let lastError = /** @type {string | null} */ (null);

  function traceFor(/** @type {any[]} */ records) {
    return (/** @type {any} */ entry) => records.push({ t: now() - startedAt, tick: tickIndex, ...entry });
  }

  return {
    start() {
      phase = 'setup';
      tickIndex = 0;
      startedAt = now();
      stopped = false;
      lastError = null;
    },
    /**
     * @param {any} ctx
     * @returns {any[]}
     */
    tick(ctx) {
      if (stopped) return [];
      tickIndex += 1;
      /** @type {any[]} */ const records = [];
      records.push({ t: now() - startedAt, tick: tickIndex, kind: 'tick' });
      const trace = traceFor(records);
      try {
        if (phase === 'setup') {
          if (program.setup) runBlock(program.setup, new Env(), ctx, trace);
          phase = 'loop';
          return records;
        }
        if (phase === 'loop' && program.loop) runBlock(program.loop, new Env(), ctx, trace);
        return records;
      } catch (error) {
        if (error instanceof ReturnSignal) {
          if (phase === 'setup') phase = 'loop';
          return records;
        }
        stopped = true;
        phase = 'stopped';
        lastError = error instanceof Error ? error.message : String(error);
        records.push({ t: now() - startedAt, tick: tickIndex, kind: 'error', text: lastError });
        return records;
      }
    },
    stop() {
      stopped = true;
      phase = 'stopped';
    },
    get phase() { return phase; },
    get progressTicks() { return 0; },
    get lastError() { return lastError; },
  };
}
