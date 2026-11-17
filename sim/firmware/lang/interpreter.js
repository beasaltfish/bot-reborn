// A cooperative, generator-based interpreter for the bounded C-like language.
// The machine owns the program counter, variables and the delay state; a tick
// runs until the 6 ms budget is spent, then the same generator resumes next
// time. Watchdogs count only ticks that executed something.

const CONSTANTS = /** @type {Record<string, number>} */ ({ HIGH: 1, LOW: 0, INPUT: 0, OUTPUT: 1, INPUT_PULLUP: 2 });
const MAX_LINE = 512;
const MAX_LINES_PER_TICK = 200;
const MAX_BYTES_PER_TICK = 8192;
const ELLIPSIS = '…';
const ELLIPSIS_BYTES = 3;
const MAX_CONTENT_BYTES = MAX_BYTES_PER_TICK - ELLIPSIS_BYTES;
const encoder = new TextEncoder();
/** @param {string} text @returns {number} */
const utf8Bytes = (text) => encoder.encode(text).length;
/** @param {string} text @param {number} maxBytes @returns {string} */
function truncateUtf8(text, maxBytes) {
  if (maxBytes <= 0) return '';
  const chars = Array.from(text);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (utf8Bytes(chars.slice(0, mid).join('')) <= maxBytes) low = mid;
    else high = mid - 1;
  }
  return chars.slice(0, low).join('');
}

class ReturnSignal {}
class BudgetSignal {}

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

/** @param {any} value @returns {boolean} */
const truthy = (value) => (typeof value === 'string' ? value.length > 0 : Boolean(value));

/** @param {any} value @returns {string} */
const asText = (value) => String(value);

/** @param {string} name @param {any[]} args @param {number} count */
function expectArgs(name, args, count) {
  if (args.length !== count) throw new Error(`${name} expects ${count} argument${count === 1 ? '' : 's'}`);
}

/** @param {any} value @param {string} name @param {number} min @param {number} max @returns {number} */
function integerIn(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer ${min}..${max}`);
  return value;
}

/**
 * @param {{
 *   program: any,
 *   now?: () => number,
 *   budgetMs?: number,
 * }} o
 */
export function createMachine({ program, now = () => performance.now(), budgetMs = 6 }) {
  const state = {
    phase: /** @type {'setup'|'loop'|'waiting'|'stopped'} */ ('stopped'),
    kind: /** @type {'setup'|'loop'} */ ('setup'),
    tick: 0,
    simTime: 0,
    startedAt: 0,
    stopped: false,
    lastError: /** @type {string | null} */ (null),
    progress: 0,
    waiting: false,
    resumeAt: 0,
    written: /** @type {Set<number>} */ (new Set()),
    line: '',
    atLine: 1,
    bytesTick: 0,
    linesTick: 0,
    overflowMarked: false,
    /** @type {Generator<any, any, any> | null} */ gen: null,
    /** @type {any} */ ctx: null,
  };
  /** @type {{ current: (entry: any) => void }} */
  const traceRef = { current: () => {} };

  /** @param {number} pin @param {string} level */
  function pinLevel(pin, level) {
    state.written.add(pin);
    state.ctx?.pin(`GPIO${pin}`, level);
  }

  /** @param {string} output @param {number} sourceLine */
  function emit(output, sourceLine) {
    state.linesTick += 1;
    state.bytesTick += utf8Bytes(output);
    state.ctx?.log(output);
    traceRef.current({ line: sourceLine, kind: 'log', text: output });
  }

  /** One marker per tick, and only if it fits inside the byte budget. */
  function markOverflow(/** @type {number} */ line) {
    if (state.overflowMarked) return;
    state.overflowMarked = true;
    if (state.bytesTick + ELLIPSIS_BYTES > MAX_BYTES_PER_TICK) return;
    state.bytesTick += ELLIPSIS_BYTES;
    state.ctx?.log(ELLIPSIS);
    traceRef.current({ line, kind: 'log', text: ELLIPSIS });
  }

  /** @param {string} text */
  function print(text) {
    if (state.linesTick >= MAX_LINES_PER_TICK || state.bytesTick >= MAX_CONTENT_BYTES) return;
    state.line += text;
    const chars = Array.from(state.line);
    if (chars.length > MAX_LINE) state.line = `${chars.slice(0, MAX_LINE - 1).join('')}${ELLIPSIS}`;
  }

  /** @param {string} text @param {number} sourceLine */
  function println(text, sourceLine) {
    if (state.linesTick >= MAX_LINES_PER_TICK || state.bytesTick >= MAX_CONTENT_BYTES) {
      state.line = '';
      markOverflow(sourceLine);
      return;
    }
    print(text);
    const output = state.line;
    state.line = '';
    const remaining = MAX_CONTENT_BYTES - state.bytesTick;
    if (utf8Bytes(output) > remaining) {
      const content = truncateUtf8(output, remaining - ELLIPSIS_BYTES);
      if (content) {
        state.overflowMarked = true;
        emit(`${content}${ELLIPSIS}`, sourceLine);
      } else {
        markOverflow(sourceLine);
      }
      return;
    }
    emit(output, sourceLine);
  }

  /** @param {any} expr @param {Env} env @param {{ trace: any }} local @returns {any} */
  function evaluate(expr, env, local) {
    switch (expr.type) {
      case 'Literal': return expr.value;
      case 'Ident': return env.get(expr.name);
      case 'Unary': {
        const value = evaluate(expr.arg, env, local);
        if (expr.op === '!') return !truthy(value);
        if (expr.op === '-') return -Number(value);
        return Number(value);
      }
      case 'Binary': {
        if (expr.op === '&&') return truthy(evaluate(expr.left, env, local)) && truthy(evaluate(expr.right, env, local));
        if (expr.op === '||') return truthy(evaluate(expr.left, env, local)) || truthy(evaluate(expr.right, env, local));
        const a = evaluate(expr.left, env, local);
        const b = evaluate(expr.right, env, local);
        switch (expr.op) {
          case '+': return a + b;
          case '-': return Number(a) - Number(b);
          case '*': return Number(a) * Number(b);
          case '/':
            if (Number(b) === 0) throw new Error('division by zero');
            return Number(a) / Number(b);
          case '%':
            if (Number(b) === 0) throw new Error('division by zero');
            return Number(a) % Number(b);
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
        const args = expr.args.map((/** @type {any} */ arg) => evaluate(arg, env, local));
        if (expr.object === 'Serial') {
          if (expr.name === 'begin') {
            expectArgs('Serial.begin', args, 1);
            if (!Number.isInteger(args[0]) || args[0] <= 0) throw new Error('Serial.begin baud must be a positive integer');
            return null;
          }
          if (expr.name === 'print' || expr.name === 'println') {
            expectArgs(`Serial.${expr.name}`, args, 1);
            if (expr.name === 'print') { print(asText(args[0])); traceRef.current({ line: expr.line, kind: 'print' }); }
            else println(asText(args[0]), expr.line);
            return null;
          }
          throw new Error(`unknown Serial.${expr.name}`);
        }
        switch (expr.name) {
          case 'pinMode': {
            expectArgs('pinMode', args, 2);
            integerIn(args[0], 'pin', 0, 21);
            if (![0, 1, 2].includes(Number(args[1]))) throw new Error('pinMode mode must be INPUT, OUTPUT or INPUT_PULLUP');
            return null;
          }
          case 'digitalWrite': {
            expectArgs('digitalWrite', args, 2);
            const pin = integerIn(args[0], 'pin', 0, 21);
            const raw = Number(args[1]);
            if (raw !== 0 && raw !== 1) throw new Error('digitalWrite level must be HIGH or LOW');
            const level = raw ? 'high' : 'low';
            pinLevel(pin, level);
            state.atLine = expr.line;
            traceRef.current({ line: expr.line, kind: 'statement', text: `digitalWrite(${pin}, ${level === 'high' ? 'HIGH' : 'LOW'}) \u2192 GPIO${pin}`, writes: [{ target: `GPIO${pin}`, level }] });
            return null;
          }
          case 'digitalRead': {
            expectArgs('digitalRead', args, 1);
            const pin = integerIn(args[0], 'pin', 0, 21);
            const level = state.ctx?.read(pin) === 'LOW' ? 0 : 1;
            state.atLine = expr.line;
            traceRef.current({ line: expr.line, kind: 'statement', text: `digitalRead(${pin}) \u2192 ${level ? 'HIGH' : 'LOW'}`, reads: [{ pin, level: level ? 'HIGH' : 'LOW' }] });
            return level;
          }
          case 'millis':
            expectArgs('millis', args, 0);
            return state.simTime;
          default: throw new Error(`unknown function ${expr.name}`);
        }
      }
      default:
        throw new Error(`unknown expression ${expr.type}`);
    }
  }

  /**
   * @param {any} ast
   * @param {Env} initial
   * @returns {Generator<any, void, any>}
   */
  function* exec(ast, initial) {
    /** @param {any} statement @param {Env} env @returns {Generator<any, void, any>} */
    const run = function* (statement, env) {
      if (typeof statement.line === 'number') state.atLine = statement.line;
      const record = (/** @type {Record<string, any>} */ entry) => {
        if (typeof statement.line === 'number') state.atLine = statement.line;
        traceRef.current({ line: statement.line, ...entry });
      };
      switch (statement.type) {
        case 'Block': {
          const child = new Env(env);
          for (const item of statement.body) yield* run(item, child);
          return;
        }
        case 'VarDecl': {
          const value = statement.init ? evaluate(statement.init, env, { trace: traceRef }) : 0;
          env.declare(statement.name, value);
          record({ kind: 'statement', text: `${statement.name} = ${asText(value)}` });
          yield;
          return;
        }
        case 'Assign': {
          const value = evaluate(statement.value, env, { trace: traceRef });
          env.set(statement.name, value);
          record({ kind: 'statement', text: `${statement.name} = ${asText(value)}` });
          yield;
          return;
        }
        case 'ExprStmt':
          if (statement.expr.type !== 'Call') record({ kind: 'statement' });
          if (statement.expr.type === 'Call' && statement.expr.name === 'delay' && !statement.expr.object) {
            expectArgs('delay', statement.expr.args, 1);
            const ms = integerIn(evaluate(statement.expr.args[0], env, { trace: traceRef }), 'delay', 0, 60000);
            record({ kind: 'statement', text: `delay(${ms})` });
            yield { waiting: ms };
            return;
          }
          evaluate(statement.expr, env, { trace: traceRef });
          yield;
          return;
        case 'If': {
          record({ kind: 'statement', text: 'if' });
          if (truthy(evaluate(statement.test, env, { trace: traceRef }))) yield* run(statement.then, env);
          else if (statement.else) yield* run(statement.else, env);
          return;
        }
        case 'While':
          record({ kind: 'statement', text: 'while' });
          while (truthy(evaluate(statement.test, env, { trace: traceRef }))) {
            yield;
            yield* run(statement.body, env);
          }
          return;
        case 'For': {
          record({ kind: 'statement', text: 'for' });
          const child = new Env(env);
          if (statement.init) yield* run({ ...statement.init, line: statement.line }, child);
          while (!statement.test || truthy(evaluate(statement.test, child, { trace: traceRef }))) {
            yield;
            yield* run(statement.body, child);
            if (statement.update) yield* run(statement.update, child);
          }
          return;
        }
        case 'Return':
          record({ kind: 'statement', text: 'return' });
          throw new ReturnSignal();
        default:
          throw new Error(`unknown statement ${statement.type}`);
      }
    };
    yield* run(ast, initial);
  }

  /** @param {any[]} records @param {any} ctx */
  function stopWith(/** @type {string} */ message, records, ctx) {
    state.stopped = true;
    state.phase = 'stopped';
    state.lastError = message;
    for (const pin of state.written) ctx.pin(`GPIO${pin}`, 'high-z');
    records.push({ t: state.simTime, tick: state.tick, kind: 'error', text: message, line: state.atLine });
  }

  return {
    start() {
      state.phase = 'setup';
      state.kind = 'setup';
      state.tick = 0;
      state.simTime = 0;
      state.startedAt = now();
      state.stopped = false;
      state.lastError = null;
      state.progress = 0;
      state.waiting = false;
      state.resumeAt = 0;
      state.gen = null;
      state.line = '';
      state.atLine = 1;
      state.written.clear();
    },
    /** @param {any} ctx @returns {any[]} */
    tick(ctx) {
      if (state.stopped) return [];
      state.tick += 1;
      state.simTime += 100;
      state.ctx = ctx;
      state.bytesTick = 0;
      state.linesTick = 0;
      state.overflowMarked = false;
      /** @type {any[]} */ const records = [];
      traceRef.current = (entry) => records.push({ t: state.simTime, tick: state.tick, ...entry });
      records.push({ t: state.simTime, tick: state.tick, kind: 'tick' });

      if (state.waiting) {
        if (state.simTime < state.resumeAt) {
          state.phase = 'waiting';
          records.push({ t: state.simTime, tick: state.tick, kind: 'waiting' });
          return records;
        }
        state.waiting = false;
        state.phase = state.kind;
      }

      let ran = false;
      const start = now();
      try {
        if (!state.gen) {
          const ast = state.kind === 'setup' ? program.setup : program.loop;
          if (!ast) {
            if (state.kind === 'setup') { state.kind = 'loop'; state.phase = 'loop'; }
            return records;
          }
          state.progress = 0;
          state.gen = exec(ast, new Env());
        }
        while (true) {
          const step = state.gen.next();
          if (step.done) {
            state.gen = null;
            state.progress = 0;
            state.kind = 'loop';
            state.phase = 'loop';
            return records;
          }
          ran = true;
          const waiting = step.value?.waiting;
          if (typeof waiting === 'number') {
            state.waiting = true;
            state.resumeAt = state.simTime + waiting;
            state.phase = 'waiting';
            records.push({ t: state.simTime, tick: state.tick, kind: 'waiting' });
            return records;
          }
          if (now() - start >= budgetMs) {
            records.push({ t: state.simTime, tick: state.tick, kind: 'budget' });
            state.phase = state.kind;
            return records;
          }
        }
      } catch (error) {
        if (error instanceof ReturnSignal) {
          state.gen = null;
          state.progress = 0;
          state.kind = 'loop';
          state.phase = 'loop';
          return records;
        }
        stopWith(error instanceof Error ? error.message : String(error), records, ctx);
        return records;
      } finally {
        if (!state.stopped) {
          if (ran) state.progress += 1;
          if (state.kind === 'setup' && state.progress >= 300) stopWith('firmware stopped: setup did not finish', records, ctx);
          if (state.kind === 'loop' && state.progress >= 600) stopWith('firmware stopped: loop did not finish', records, ctx);
        }
      }
    },
    stop() {
      state.stopped = true;
      state.phase = 'stopped';
    },
    get phase() { return state.phase; },
    get progressTicks() { return state.progress; },
    get lastError() { return state.lastError; },
  };
}
