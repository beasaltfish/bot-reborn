// What "this layer works" means, in one place.
//
// Two surfaces ask it now and they ask different versions of the same
// question. setup.html is the instrument: three clips in your own voice, so a
// pass means the chain understands *you*. The setup sheet is the product: one
// clip that ships with the repo, so a pass means the baseURL, the model name
// and the key are right — and nobody has to hold a microphone before they can
// find out their key has a typo.
//
// The difference is the audio, not the assertions. Everything below takes the
// clip, or the provider, as an argument and decides nothing about where it
// came from; the two callers own that. No DOM here (spec §10).

/**
 * The clip that ships. Synthesised, so it is nobody's voice and every clone
 * hears the same take — see web/fixtures/README.md. It code-switches on
 * purpose: one clip then exercises Chinese, English and the seam between them,
 * which is the shape §9.3 says an easy clip would leave untested.
 */
export const SHIPPED_CLIP = 'fixtures/check.wav';

/**
 * The line the TTS check speaks. Both languages in one sentence, because a
 * voice that can only do one of them fails silently otherwise — it reads the
 * half it knows and sounds fine.
 */
export const TTS_CHECK_LINE = '「往前走」的英文是 go forward';

/**
 * Fetch a clip, refusing the page Cloudflare serves instead of a 404.
 *
 * Cloudflare Pages (wrangler pages dev included) answers a missing static path
 * with index.html and status 200. `response.ok` calls that "found" and hands
 * decodeAudioData an HTML document, which fails with a decode error that says
 * nothing about the clip being absent. A real .wav is never text/html.
 *
 * @param {string} path
 * @returns {Promise<Response | null>}
 */
export async function fetchClip(path) {
  const response = await fetch(path);
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok || contentType.includes('text/html')) return null;
  return response;
}

/**
 * @param {AudioBuffer} buffer
 * @returns {{ pcm: Int16Array, sampleRate: number }}
 */
export function toInt16Pcm(buffer) {
  const float = buffer.getChannelData(0);
  const pcm = new Int16Array(float.length);
  for (let i = 0; i < float.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float[i]));
    pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return { pcm, sampleRate: buffer.sampleRate };
}

/**
 * One clip in, one transcript out.
 *
 * @param {{ transcribe: (pcm: Int16Array, rate: number) => Promise<string> }} stt
 * @param {Response} clip
 * @param {AudioContext | OfflineAudioContext} ctx
 * @returns {Promise<string>}
 */
export async function transcribeClip(stt, clip, ctx) {
  const buffer = await ctx.decodeAudioData(await clip.arrayBuffer());
  const { pcm, sampleRate } = toInt16Pcm(buffer);
  return stt.transcribe(pcm, sampleRate);
}

/**
 * The product's STT check: the shipped clip has to come back as *something*.
 *
 * An empty transcript is a failure, not a pass with no text. A provider that
 * accepts the request and returns nothing is exactly the case a key with the
 * wrong scope produces, and reporting it as success would send somebody off to
 * debug their microphone.
 *
 * @param {{ transcribe: (pcm: Int16Array, rate: number) => Promise<string> }} stt
 * @param {AudioContext | OfflineAudioContext} ctx
 * @returns {Promise<string>} the transcript, for showing
 */
export async function checkStt(stt, ctx) {
  const clip = await fetchClip(SHIPPED_CLIP);
  if (!clip) throw new Error(`${SHIPPED_CLIP} is missing from this deployment`);
  const text = (await transcribeClip(stt, clip, ctx)).trim();
  if (!text) throw new Error('the transcript came back empty');
  return text;
}

/**
 * Two assertions, because "can chat" and "can call tools" are different
 * capabilities and a provider can have the first without the second. A model
 * that only chats looks completely healthy right up until the car is told to
 * move and nothing happens.
 *
 * @param {{ chat: (msgs: any[], tools: any) => Promise<{ text: string,
 *   toolCalls: { name: string }[] }> }} llm
 * @param {{ tools: any, systemPrompt: string }} deps
 * @returns {Promise<string>}
 */
export async function checkLlm(llm, deps) {
  const chat = await llm.chat([{ role: 'user', content: 'Reply with exactly: ok' }], deps.tools);
  if (!chat.text) throw new Error('the model returned no text');

  const tool = await llm.chat([
    { role: 'system', content: deps.systemPrompt },
    { role: 'user', content: 'go forward for one second' },
  ], deps.tools);
  if (tool.toolCalls.length === 0) {
    throw new Error('the model can chat but did not call a tool — tool calling is unusable on this provider');
  }
  return `“${chat.text}” · ${tool.toolCalls[0].name}`;
}

/**
 * The one check the code cannot grade. It plays the line; whether both
 * languages were intelligible is a question for ears, and saying so out loud
 * is more honest than a green tick that only means the request returned 200.
 *
 * @param {{ speak: (text: string) => Promise<void> }} tts
 * @returns {Promise<string>}
 */
export async function checkTts(tts) {
  await tts.speak(TTS_CHECK_LINE);
  return TTS_CHECK_LINE;
}
