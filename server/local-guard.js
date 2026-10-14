// The admin page and its API are this machine's only (admin spec §4). The
// brain listens on every interface for bodies, so "only here" is checked per
// request, twice: where the request came from, and what it thinks it is
// talking to. A domain rebound to 127.0.0.1 passes the first and fails the
// second — its Host is still the domain.

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const SELF = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * @param {{ socket: { remoteAddress?: string }, headers: { host?: string } }} req
 */
export function isLocalRequest(req) {
  const host = (req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
  return LOOPBACK.has(req.socket.remoteAddress ?? '') && SELF.has(host);
}
