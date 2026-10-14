// The admin page and its API are this machine's only (admin spec §4). The
// brain listens on every interface for bodies, so "only here" is checked per
// request, twice: where the request came from, and what it thinks it is
// talking to. A domain rebound to 127.0.0.1 passes the first and fails the
// second — its Host is still the domain.

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const SELF = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * A tunnel or reverse proxy connects from this machine, so the address check
 * passes for everything it forwards — and one told to rewrite Host (a common
 * cloudflared and ngrok recipe) passes the Host check too. Every one of them
 * adds at least one of these; nothing a browser sends directly does.
 */
const FORWARDED = ['cf-connecting-ip', 'x-forwarded-for', 'forwarded', 'x-real-ip'];

/**
 * @param {{ socket: { remoteAddress?: string }, headers: Record<string, string | string[] | undefined> & { host?: string } }} req
 */
export function isLocalRequest(req) {
  if (FORWARDED.some((h) => req.headers[h] !== undefined)) return false;
  const host = (req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
  return LOOPBACK.has(req.socket.remoteAddress ?? '') && SELF.has(host);
}
