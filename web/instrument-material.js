// What the instruments say out loud, in the language this robot is set to.
//
// Keyed on lang for the reason web/checks.js already gives: spec §9.3's "test
// the hardest case" is a statement about the input this product actually gets,
// not a difficulty setting. For a Chinese user the hardest case is
// code-switching mid-sentence, and one clip then exercises Chinese, English and
// the seam between them at once. For somebody who will only ever speak English
// to it, that same clip tests something they do not need.
//
// THIS FILE IS THE ONLY PLACE AN INSTRUMENT MAY CARRY CHINESE. Everything else
// under bench.html / setup.html / audio-bench.html is English, and
// test/instrument-language.test.js enforces both halves of that — including
// that the zh arm below still HAS Chinese in it, because translating it away
// would stop ⑩ and ⑪ measuring code-switching without anything going red.

/**
 * @typedef {{ path: string, label: string, say: string }} Fixture
 * @typedef {{
 *   script: string,
 *   readLine: string,
 *   ttsLine: string,
 *   commands: string[],
 *   runOn: string,
 *   fixtures: Fixture[],
 * }} Material
 */

/** @type {Record<'en' | 'zh', Material>} */
export const MATERIAL = {
  en: {
    // Long on purpose: acoustics.js needs ~23 s of continuous speech to walk
    // its five windows, and a passage that runs out mid-window aborts the run.
    script:
      'All right, I will roll forward a little first. Forward is simply the '
      + 'direction the wheels are already pointing, and slowly means the same '
      + 'thing with rather less of it. You can try saying that back to me; '
      + 'there is no hurry, and if it comes out wrong we will go again. From '
      + 'here on I am going to keep reading, so follow whatever the screen '
      + 'asks: stay quiet when it asks for quiet, speak normally when it asks '
      + 'for speech, and never mind where I have got to. Now I am turning a '
      + 'little to the left, then a little to the right, then forward again, '
      + 'and then I stop. Let me count for you twice: one, two, three, four, '
      + 'five, six, seven, eight, nine, ten. And once more: one, two, three, '
      + 'four, five, six, seven, eight, nine, ten. That is about the end of '
      + 'this passage — go and see whether those level readings line up.',
    // The line you read, twice: once in silence and once over the robot. It is
    // also the CER reference, so it has to be a sentence you can say the same
    // way twice.
    readLine: 'Go forward three metres, then turn left, and stop beside the red box.',
    // ⑪ judges TTS voices on what this product actually emits: a short
    // imperative reply carrying a number and a unit.
    ttsLine: 'All right — three metres forward, then a left turn, and I will stop there.',
    commands: ['turn left', 'back up', 'stop there'],
    runOn: 'hey steven turn left',
    fixtures: [
      { path: 'fixtures/en-short.wav', label: 'a short command', say: 'back up' },
      { path: 'fixtures/en-long.wav', label: 'a long sentence', say: 'keep going forward until I say stop' },
      { path: 'fixtures/en-numbers.wav', label: 'numbers and a place', say: 'go forward three metres and stop beside the red box' },
    ],
  },

  zh: {
    // Moved verbatim from acoustics.js's SCRIPT_TEXT. Chinese with English
    // spliced into it on purpose: ⑪ is about how each TTS provider handles
    // code-switching, and a monolingual passage never asks the question.
    script:
      '好的，我先往前走一点。「往前走」的英文是 go forward，走慢一点就是 '
      + 'go forward slowly。你可以试着跟我说一遍，不用着急，说错了我们再来一次。'
      + '接下来我会一直念下去，你照着屏幕上的提示做就行，该安静的时候安静，'
      + '该说话的时候就正常说话，不用管我念到哪里。'
      + '我现在往左边转一点，「向左转」是 turn left，往右边就是 turn right。'
      + '再往前一点点，然后停下来，「停下来」是 stop，或者 hold on。'
      + '给你数两遍：one, two, three, four, five, six, seven, eight, nine, ten。'
      + '一，二，三，四，五，六，七，八，九，十。'
      + '好了，这一段差不多念完了，看看屏幕上那几行电平对不对得上。',
    // Verbatim from acoustics.js's READ_LINE. The sentence ⑩ is about, and the
    // one a phone microphone is worst at.
    readLine: '往前走三米，然后 turn left，停在红色的箱子旁边',
    // Verbatim from providers.js's MIXED_LINE.
    ttsLine: '「往前走」的英文是 go forward',
    // Both open on a consonant, which is what ⑯ needs in order to be able to
    // show a lost onset at all.
    commands: ['往前走', '把灯关了'],
    runOn: 'hey steven 往前走',
    // Verbatim from setup.js's STT_FIXTURES.
    fixtures: [
      { path: 'fixtures/zh.wav', label: 'Chinese', say: '往前开两秒然后左转' },
      { path: 'fixtures/en.wav', label: 'English', say: 'keep going forward until I say stop' },
      { path: 'fixtures/mixed.wav', label: 'mixed in one sentence', say: '这个 sentence 里的 transition word 用得对吗' },
    ],
  },
};

/**
 * `lang` comes from config.js, which reads localStorage — a config written by
 * a future version can carry anything, and a bench that answered `undefined`
 * would abort a run with a type error instead of measuring.
 *
 * @param {string} lang
 * @returns {Material}
 */
export function materialFor(lang) {
  return lang === 'zh' ? MATERIAL.zh : MATERIAL.en;
}
