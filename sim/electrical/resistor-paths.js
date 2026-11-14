/** Follow possible resistor paths only; no voltage or current is inferred.
 * A burnt resistor remains a possible path because its failure mode is unknown.
 * @param {import('../bench.js').Bench} bench
 * @param {import('../netlist.js').Nets} network
 * @param {string} start
 */
export function resistorPaths(bench, network, start) {
  /** @type {Map<string, {next:string, pins:string[]}[]>} */
  const edges = new Map();
  for (const part of bench.placed.filter(p => p.part === 'resistor').sort((a, b) => a.id.localeCompare(b.id))) {
    const pins = [`${part.id}:1`, `${part.id}:2`];
    const a = network.netOf(pins[0]), b = network.netOf(pins[1]);
    if (a === b) continue;
    if (!edges.has(a)) edges.set(a, []);
    if (!edges.has(b)) edges.set(b, []);
    edges.get(a)?.push({ next: b, pins });
    edges.get(b)?.push({ next: a, pins });
  }
  const root = network.netOf(start);
  /** @type {Map<string, string[]>} */
  const paths = new Map([[root, []]]);
  const queue = [root];
  for (let i = 0; i < queue.length; i++) for (const edge of edges.get(queue[i]) ?? []) {
    if (paths.has(edge.next)) continue;
    paths.set(edge.next, [...(paths.get(queue[i]) ?? []), ...edge.pins]);
    queue.push(edge.next);
  }
  return paths;
}
