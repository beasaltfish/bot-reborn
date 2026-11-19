// The queue the agent loop reads. A person writes it; `scripts/agent-loop.sh`
// only ever reads it, and so does the agent. One shape, so a vague item cannot
// be picked up by accident.

/**
 * @typedef {{ number: number, title: string, status: 'ready' | 'blocked' | 'done', body: string }} Item
 */

const LINE = /^-\s+\[( |x)\]\s+\*\*(\d+)\.\*\*\s+(.+?)\s+—\s+(ready|blocked|done)\b(.*)$/;

/**
 * @param {string} text
 * @returns {Item[]}
 */
export function parseRoadmap(text) {
  /** @type {Item[]} */
  const items = [];
  /** @type {Item | null} */
  let current = null;
  const lines = text.split(/\r?\n/);
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // The file documents its own shape; the example inside a fence is not an item.
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (/^-\s+\[[ x]\]/.test(line)) {
      const m = LINE.exec(line);
      // A checkbox without a state is an item nobody can act on: say so loudly.
      if (!m) throw new Error(`roadmap item has no state (ready|blocked|done): ${line.trim()}`);
      current = {
        number: Number(m[2]),
        title: m[3].trim(),
        status: /** @type {Item['status']} */ (m[4]),
        body: m[5] ? `${m[5].trim()}` : '',
      };
      items.push(current);
      continue;
    }
    // An indented line belongs to the item above it: acceptance criteria live here.
    if (current && /^\s+\S/.test(line)) {
      current.body = current.body ? `${current.body}\n${line.trim()}` : line.trim();
    } else if (!/^\s*$/.test(line)) {
      current = null;
    }
  }
  return items;
}

/**
 * @param {Item[]} items
 * @param {number} number
 * @returns {Item | undefined}
 */
export function itemByNumber(items, number) {
  return items.find((item) => item.number === number);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const number = Number(process.argv[2]);
  const items = parseRoadmap(await (await import('node:fs/promises')).readFile(new URL('../docs/roadmap.md', import.meta.url), 'utf8'));
  const item = itemByNumber(items, number);
  if (!item) {
    console.error(`no roadmap item ${process.argv[2]}`);
    process.exit(2);
  }
  console.log(`${item.status}\t${item.title}`);
  if (item.body) console.log(item.body);
}
