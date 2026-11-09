// Workers static assets answer a Range request with the whole file and no
// Content-Range, and Safari will not play a video it cannot range. `/media/*`
// is routed here first (see run_worker_first in wrangler.jsonc); everything
// else in the site is still served straight from the asset store.

/** @typedef {{ ASSETS: { fetch(req: Request): Promise<Response> } }} Env */

/** @param {string} range @param {number} size @returns {{ start: number, end: number } | null} */
function parseRange(range, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m) return null;
  const [, first, last] = m;
  if (first === '' && last === '') return null;
  // "bytes=-500": the last 500, or the whole file when that is more than it has.
  if (first === '') {
    const wanted = Number(last);
    if (!Number.isFinite(wanted) || wanted <= 0) return null;
    return { start: Math.max(0, size - wanted), end: size - 1 };
  }
  const start = Number(first);
  const end = last === '' ? size - 1 : Number(last);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

export default {
  /**
   * @param {Request} request
   * @param {Env} env
   */
  async fetch(request, env) {
    const range = request.headers.get('Range');
    if (request.method !== 'GET' || !range) return env.ASSETS.fetch(request);

    // The asset store ignores the header anyway, so take the file whole and cut it.
    const whole = await env.ASSETS.fetch(new Request(new URL(request.url).toString(), { method: 'GET' }));
    if (whole.status !== 200) return whole;

    const body = await whole.arrayBuffer();
    const span = parseRange(range, body.byteLength);
    if (!span) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${body.byteLength}` } });
    }

    const headers = new Headers(whole.headers);
    headers.set('Content-Range', `bytes ${span.start}-${span.end}/${body.byteLength}`);
    headers.set('Content-Length', String(span.end - span.start + 1));
    headers.set('Accept-Ranges', 'bytes');
    return new Response(body.slice(span.start, span.end + 1), { status: 206, headers });
  },
};
