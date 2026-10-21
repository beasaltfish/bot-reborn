// What a refused request says on screen.
//
// The status alone is rarely enough: over HTTP/2 there is no reason phrase, so
// a provider out of credit showed up as a bare "402". The provider almost
// always says why in the body, and that sentence is the useful part.

/** Reason phrases for the statuses a provider actually sends. */
const REASONS = /** @type {Record<number, string>} */ ({
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  408: 'Request Timeout',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
});

/** Long enough for a sentence, short enough that an HTML error page stays out. */
const MAX_DETAIL = 200;

/**
 * The provider's own explanation: OpenAI's `error.message`, SiliconFlow's flat
 * `message`, FastAPI's `detail` (Unsloth Studio), or the start of whatever
 * text came back.
 * @param {string} text
 * @returns {string}
 */
function detailOf(text) {
  try {
    const json = JSON.parse(text);
    const said = json?.error?.message ?? json?.message ?? (typeof json?.error === 'string' ? json.error : null)
      ?? (typeof json?.detail === 'string' ? json.detail : null);
    if (typeof said === 'string' && said.trim()) return said.trim();
  } catch {
    // Not JSON: fall through to the raw text.
  }
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_DETAIL ? `${flat.slice(0, MAX_DETAIL)}…` : flat;
}

/**
 * @param {string} layer 'STT' | 'LLM' | 'TTS', as it leads the message
 * @param {Response} response a response that was not ok
 * @returns {Promise<Error>}
 */
export async function requestError(layer, response) {
  const reason = response.statusText || REASONS[response.status] || '';
  let detail = '';
  try {
    detail = detailOf(await response.text());
  } catch {
    // A body that cannot be read costs the detail, not the error.
  }
  const head = `${layer} request failed: ${response.status}${reason ? ` ${reason}` : ''}`;
  return new Error(detail ? `${head} — ${detail}` : head);
}
