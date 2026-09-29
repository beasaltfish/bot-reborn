// What "this layer works" means, in one place.
//
// Two surfaces ask it now and they ask different versions of the same
// question. dev.html is the instrument: three clips in your own voice, so a
// pass means the chain understands *you*. The setup sheet is the product: one
// clip that ships with the repo, so a pass means the baseURL, the model name
// and the key are right — and nobody has to hold a microphone before they can
// find out their key has a typo.
//
// The difference is the audio, not the assertions. Everything below takes the
// clip, or the provider, as an argument and decides nothing about where it
// came from; the two callers own that. No DOM here (spec §10).

/**
 * The clips that ship, and the lines the voice check speaks — one pair per UI
 * language. Synthesised, so they are nobody's voice and every clone hears the
 * same take; see web/fixtures/README.md.
 *
 * There are two pairs because §9.3's "test the hardest case" is a statement
 * about the input this product actually gets, not a difficulty setting. For a
 * Chinese user the hardest case is code-switching mid-sentence, and one clip
 * then exercises Chinese, English and the seam between them at once. For
 * somebody who will only ever speak English to it, that same clip tests
 * something they do not need and can fail a provider that serves them
 * perfectly well — a false negative, which is worse than no check at all,
 * because it sends them away from a setup that worked.
 *
 * Keyed on `lang` because it is the only signal there is. It is the UI
 * language rather than a declaration of what somebody will say out loud, so it
 * can be wrong; the sheet shows the transcript it got, which makes a mismatch
 * legible rather than mysterious.
 *
 * @type {Record<'en' | 'zh', { clip: string, line: string }>}
 */
export const MATERIAL = {
  en: {
    clip: 'fixtures/check-en.wav',
    line: 'Left wheel, right wheel, and a long straight road.',
  },
  zh: {
    clip: 'fixtures/check-mixed.wav',
    // Both languages in one sentence, because a voice that can only do one of
    // them fails silently otherwise — it reads the half it knows and sounds
    // perfectly fine doing it.
    line: '「往前走」的英文是 go forward',
  },
};

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
 * @param {'en' | 'zh'} [lang]
 * @returns {Promise<string>} the transcript, for showing
 */
export async function checkStt(stt, ctx, lang = 'zh') {
  const path = MATERIAL[lang].clip;
  const clip = await fetchClip(path);
  if (!clip) throw new Error(`${path} is missing from this deployment`);
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
 * The one check the code cannot grade. It plays the line; whether it was
 * intelligible is a question for ears, and saying so out loud is more honest
 * than a green tick that only means the request returned 200.
 *
 * @param {{ speak: (text: string) => Promise<void> }} tts
 * @param {'en' | 'zh'} [lang]
 * @returns {Promise<string>}
 */
export async function checkTts(tts, lang = 'zh') {
  const line = MATERIAL[lang].line;
  await tts.speak(line);
  return line;
}

/**
 * The reflex (reflex spec §7). judge() never rejects — a bad key, a wrong
 * model or a timeout all arrive as `failed` — so that verdict is the failure.
 * Any other verdict means the key works; `fired` is what a bark should get.
 * English on purpose: barking is not Chinese, and dev.html's source carries
 * no CJK (test/instrument-language.test.js).
 *
 * @param {{ judge: (heard: string, robotSaid: string) => Promise<{ verdict: string, detail: string, ms: number }> }} reflex
 * @returns {Promise<string>}
 */
export async function checkReflex(reflex) {
  const v = await reflex.judge('woof woof', '');
  if (v.verdict === 'failed') throw new Error(`${v.detail} after ${v.ms} ms`);
  return `“woof woof” → ${v.verdict} (${v.detail}, ${v.ms} ms)`;
}
