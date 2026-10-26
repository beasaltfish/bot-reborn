// The two reflexes the admin page offers ready-made (configurable reflex
// spec §2.5). Data, not behaviour: picking one copies it into the
// character's config, and from then on it is the admin's to edit.

import { DEFAULT_STATE } from './config.js';

/** @param {'forward'|'backward'} drive @param {'left'|'right'|'straight'} steer */
const move = (drive, steer) =>
  [{ name: /** @type {const} */ ('move'), args: { steps: [{ drive, steer, duration_ms: 600 }] } }];

/**
 * @type {Array<{ id: 'bark' | 'commands' | 'pet', threshold: number, state: string,
 *                 question: import('./config.js').ReflexQuestion }>}
 */
export const REFLEX_PRESETS = [
  {
    // The 2026-09-28 question, as measured: 6/9 teases fired, 0/13 false
    // fires. JEV reads characters, not sound, so it is told the homophones
    // outright, and in the same breath which short replies are never noises.
    // The second half is what keeps 明白 after 你明白吗 from being eaten.
    id: 'bark',
    threshold: 0.8,
    state: 'Robot said: 「{robot}」\nPerson said: 「{person}」',
    question: {
      name: 'intent',
      instructions:
        'A person is talking to a small pet-like robot. "Robot said" is the robot\'s last '
        + 'line, if any; "Person said" is a speech-recognition transcript of the reply. '
        + 'The transcript may use wrong characters with the same sound: a bark 汪汪 can '
        + 'arrive as 忘忘 or 往往, a meow 喵喵 as 苗苗. '
        + 'Only call it an animal noise when the sound is a repeated syllable that makes no '
        + 'sense as an answer to what the robot said. Short real words that answer the robot '
        + '(明白, 好的, 嗯嗯, 对对, 哈哈) are replies, never noises. '
        + 'What is the person doing?',
      options: [
        { choice: 'tease', description: 'Making an animal noise at the robot (bark, meow, howl) — a sound, not words',
          actions: [{ name: 'play_sound', args: { name: 'bark' } }] },
        { choice: 'command', description: 'Telling the robot to move, turn, hurry or stop', actions: [] },
        { choice: 'reply', description: 'Answering, agreeing, laughing, or talking in real words', actions: [] },
      ],
    },
  },
  {
    // beasaltfish/robot-simple-commands-qwen3.5-0.8b's question, word for word
    // as in training/commands/data/train.jsonl: a decision model is only as
    // good as its question matches the one it learned. 0.8 until a real-voice
    // run says otherwise.
    id: 'commands',
    threshold: 0.8,
    state: DEFAULT_STATE,
    question: {
      name: 'action',
      instructions:
        'A person is talking to a small wheeled robot. "Robot said" is the robot\'s last line, '
        + 'if any; "Person said" is a speech-recognition transcript of what the person said. '
        + 'Is the person telling the robot to make one simple move it can carry out right away? '
        + 'Anything else, including questions, chat, complex or multi-step moves, exact distances, '
        + 'and words meant for someone else, is pass.',
      options: [
        { choice: 'stop', description: 'Stop moving now, or stay still.', actions: [{ name: 'stop', args: {} }] },
        { choice: 'forward', description: 'Move forward a little, or come closer.', actions: move('forward', 'straight') },
        { choice: 'backward', description: 'Move backward a little, or back away.', actions: move('backward', 'straight') },
        { choice: 'left', description: 'Turn or steer to the left.', actions: move('forward', 'left') },
        { choice: 'right', description: 'Turn or steer to the right.', actions: move('forward', 'right') },
        { choice: 'keep_going', description: 'Keep driving forward with no set end, until told to stop.',
          actions: [{ name: 'cruise', args: { drive: 'forward', steer: 'straight' } }] },
        { choice: 'pass', description: 'Not a simple move command; let the robot think and answer.', actions: [] },
      ],
    },
  },
  {
    // The pet screen's own question (pet screen spec §4.2): the commands are
    // three tricks and a bark, and everything else — chat, praise, a question —
    // falls through to the LLM, which is where a dog's personality lives.
    id: 'pet',
    threshold: 0.8,
    state: DEFAULT_STATE,
    question: {
      name: 'command',
      instructions:
        'A person is talking to a pet dog that lives on a small screen. "Robot said" is the dog\'s last '
        + 'line, if any; "Person said" is a speech-recognition transcript of what the person said. '
        + 'Is the person giving the dog one of these simple commands right now? Anything else, '
        + 'including questions, chat, praise, other commands and words meant for someone else, is pass.',
      options: [
        { choice: 'sit', description: 'Sit, or sit down (坐下, 坐).', actions: [
          { name: 'pose', args: { name: 'sit' } },
          { name: 'play_sound', args: { name: 'bark' } },
        ] },
        { choice: 'shake', description: 'Shake hands, or give a paw (握手, 给我爪子).', actions: [
          { name: 'pose', args: { name: 'shake' } },
          { name: 'play_sound', args: { name: 'bark' } },
        ] },
        { choice: 'spin', description: 'Spin, turn around once (转圈, 转一圈).', actions: [
          { name: 'pose', args: { name: 'spin' } },
          { name: 'play_sound', args: { name: 'bark' } },
        ] },
        { choice: 'pass', description: 'Not one of these commands; let the dog think and answer.', actions: [] },
      ],
    },
  },
];
