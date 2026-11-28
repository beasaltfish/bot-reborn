// The workbench's half of local behaviors: watch the inputs a body declares,
// run the commands its rules name. Pure on purpose — the caller supplies the
// levels and the command runner — so the same rules can be tested without a
// bench and, later, mirrored by the firmware's engine.
//
// A level rule runs on a change into its level, an edge rule on the named
// transition, and a periodic rule on its interval. The first sample only seeds
// the previous level: `start()` must not fire a rule just because the board
// powered up, or every reset would repeat an output command.

/**
 * @param {{
 *   body: { behaviors?: any[], resources?: { name: string }[] },
 *   read: (resource: string) => 'low' | 'high' | null,
 *   run: (command: string) => unknown | Promise<unknown>,
 *   now?: () => number,
 *   onError?: (error: unknown, behavior: any) => void,
 * }} opts
 */
export function createBehaviorRuntime(opts) {
  const behaviors = Array.isArray(opts.body?.behaviors) ? opts.body.behaviors : [];
  const now = opts.now ?? (() => Date.now());
  const onError = opts.onError ?? ((error) => console.error(error));
  // Per rule, not per resource: two rules may watch the same button, and the
  // first must not consume the transition the second needs.
  /** @type {('low' | 'high' | null)[]} */
  let previous = [];
  /** Last run per periodic rule. */
  /** @type {Map<number, number>} */
  const periodic = new Map();
  let running = false;
  let last = now();

  /** @param {any} behavior */
  async function runBehavior(behavior) {
    for (const step of behavior.run ?? []) {
      try {
        await opts.run(step.command);
      } catch (error) {
        onError(error, behavior);
      }
    }
  }

  /** @param {string} resource */
  function sample(resource) {
    const level = opts.read(resource);
    return level === 'low' || level === 'high' ? level : null;
  }

  /** @param {number} at */
  function tick(at = now()) {
    if (!running) return;
    for (const [index, behavior] of behaviors.entries()) {
      const on = behavior?.on ?? {};
      if (Number.isInteger(on.everyMs)) {
        const previous = periodic.get(index);
        if (previous === undefined) {
          periodic.set(index, at);
        } else if (at - previous >= on.everyMs) {
          periodic.set(index, at);
          void runBehavior(behavior);
        }
        continue;
      }
      if (typeof on.resource !== 'string') continue;
      const level = sample(on.resource);
      if (level === null) continue;
      const before = previous[index] ?? null;
      previous[index] = level;
      if (on.level) {
        if (level === on.level && before !== level) void runBehavior(behavior);
        continue;
      }
      if (!before || before === level) continue;
      if (on.edge === 'change'
        || (on.edge === 'down' && before === 'high' && level === 'low')
        || (on.edge === 'up' && before === 'low' && level === 'high')) {
        void runBehavior(behavior);
      }
    }
    last = at;
  }

  return {
    start() {
      running = true;
      last = now();
      periodic.clear();
      // Seed each rule's input without firing: power-on is not a press.
      previous = behaviors.map((behavior) => {
        const resource = behavior?.on?.resource;
        return typeof resource === 'string' ? sample(resource) : null;
      });
    },
    stop() {
      running = false;
      previous = [];
      periodic.clear();
    },
    /** @param {number} [at] */
    tick,
    get running() { return running; },
    get last() { return last; },
  };
}
