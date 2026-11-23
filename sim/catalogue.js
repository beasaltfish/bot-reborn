// The modules the brain ships, as the workbench reads them. One request, at
// boot: the catalogue is a list of manifests, and every project they become is
// built from it, so the bench and the install never disagree about a pin.
//
// A brain that cannot be read is not an empty catalogue. The page still has its
// templates and its lessons; what it loses is the modules, and saying so is the
// difference between "nothing here" and "the brain did not answer".

/** @param {unknown} row @returns {boolean} */
function isModule(row) {
  if (typeof row !== 'object' || row === null) return false;
  const m = /** @type {Record<string, any>} */ (row);
  return typeof m.id === 'string' && m.id !== ''
    && typeof m.label === 'object' && m.label !== null
    && typeof m.label.en === 'string'
    && typeof m.wiring === 'object' && m.wiring !== null;
}

/**
 * The modules this brain offers, or a failed read. A malformed row is dropped
 * rather than fatal: one bad manifest must not take the workbench with it.
 * The one call it makes, so a test can stand in for the brain without a socket.
 * @typedef {(path: string) => Promise<{ ok: boolean, json(): Promise<unknown> }>} FetchLike
 * @param {FetchLike} [fetchImpl]
 * @returns {Promise<{ modules: any[], failed: boolean }>}
 */
export async function loadModuleCatalogue(fetchImpl = /** @type {any} */ (fetch)) {
  /** @param {string} path @returns {Promise<any[] | null>} */
  const rowsAt = async (path) => {
    try {
      const res = await fetchImpl(path);
      if (!res.ok) return null;
      const rows = await res.json();
      return Array.isArray(rows) ? rows : null;
    } catch { return null; }
  };
  // Two sources, one list: the modules the repository ships and the bodies a
  // person saved here. The repository wins a shared id, and either half being
  // unreachable is not the whole catalogue being gone.
  const [shipped, saved] = await Promise.all([rowsAt('/api/modules'), rowsAt('/api/bodies')]);
  const modules = [...(shipped ?? []).filter(isModule)];
  const seen = new Set(modules.map((m) => m.id));
  for (const row of (saved ?? []).filter(isModule)) if (!seen.has(row.id)) modules.push(row);
  return { modules, failed: shipped === null && saved === null };
}
