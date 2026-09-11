// LLM over the OpenAI-compatible /v1/chat/completions endpoint.
//
// This module does NOT validate anything: spec §6.1 puts validation in
// brain.js, on the grounds that v2's local models will be less reliable and
// the validator has to live somewhere every provider shares. What comes out of
// here is what the model said, parsed just far enough to be inspectable.

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * @typedef {{ id: string, name: string, args: object | null, rawArguments: string }} ParsedToolCall
 */

export class OpenAiCompatLlm {
  #cfg;
  #fetch;
  #timeoutMs;

  /**
   * @param {{ baseURL: string, apiKey: string, model: string }} cfg
   * @param {{ fetch?: typeof fetch, timeoutMs?: number }} [opts]
   */
  constructor(cfg, opts = {}) {
    this.#cfg = cfg;
    this.#fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * @param {object[]} messages
   * @param {object[]} tools
   * @returns {Promise<{ text: string, toolCalls: ParsedToolCall[], rawMessage: object }>}
   */
  async chat(messages, tools) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(`${this.#cfg.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.#cfg.apiKey}`,
        },
        body: JSON.stringify({ model: this.#cfg.model, messages, tools }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`LLM request failed: ${response.status} ${response.statusText}`);
      }
      const json = await response.json();
      const message = json.choices?.[0]?.message ?? {};

      return {
        text: (message.content ?? '').trim(),
        toolCalls: (message.tool_calls ?? []).map(toParsedCall),
        rawMessage: message,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** @param {any} call @returns {ParsedToolCall} */
function toParsedCall(call) {
  const rawArguments = call.function?.arguments ?? '';
  let args = null;
  try {
    args = rawArguments === '' ? {} : JSON.parse(rawArguments);
  } catch {
    // Leave args null; brain.js drops this call. Throwing would lose the turn.
  }
  return { id: call.id, name: call.function?.name ?? '', args, rawArguments };
}
