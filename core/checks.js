// What "this layer works" means, in one place.
//
// The admin page's Test buttons ask it, through the brain (server/check-api.js):
// one clip that ships with the repo, so a pass means the baseURL, the model
// name and the key are right — and nobody has to hold a microphone before they
// can find out their key has a typo.
//
// Everything below takes the clip, or the provider, as an argument and decides
// nothing about where it came from. No DOM here (spec §10).

/**
 * The clips that ship, and the lines the voice check speaks — one pair per UI
 * language. Synthesised, so they are nobody's voice and every clone hears the
 * same take; see core/fixtures/README.md.
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
 * The product's STT check: the shipped clip has to come back as *something*.
 * The caller reads the clip (server/check-api.js, from core/fixtures/).
 *
 * An empty transcript is a failure, not a pass with no text. A provider that
 * accepts the request and returns nothing is exactly the case a key with the
 * wrong scope produces, and reporting it as success would send somebody off to
 * debug their microphone.
 *
 * @param {{ transcribe: (pcm: Int16Array, rate: number) => Promise<string> }} stt
 * @param {Int16Array} pcm
 * @param {number} rate
 * @returns {Promise<string>} the transcript, for showing
 */
export async function checkStt(stt, pcm, rate) {
  const text = (await stt.transcribe(pcm, rate)).trim();
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
 * The reflex's check is a sentence the admin types: there is no one right
 * answer to test a key against, because the question is the character's.
 * Any verdict but `failed` means the provider answered; the rest of the line
 * says what this robot would do with that sentence.
 *
 * @param {{ judge: (heard: string, robotSaid: string) => Promise<import('./reflex.js').Verdict> }} reflex
 * @param {string} heard
 * @param {string} [robotSaid]
 * @returns {Promise<string>}
 */
export async function checkReflex(reflex, heard, robotSaid = '') {
  const v = await reflex.judge(heard, robotSaid);
  if (v.verdict === 'failed') throw new Error(`${v.detail} after ${v.ms} ms`);
  const did = v.calls?.length ? ` → ${v.calls.map((c) => c.name).join(', ')}` : '';
  return `“${heard}” → ${v.verdict} (${v.detail}, ${v.ms} ms)${did}`;
}
