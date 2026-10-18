// Ask a running Unsloth Studio Decision API the robot-command question.
//   UNSLOTH_KEY=sk-unsloth-... node try-studio.mjs
//   UNSLOTH_KEY=... node try-studio.mjs "turn left" "Okay!"   (person said, robot said)
// STUDIO overrides the server (default http://192.168.3.47:8888).

import { readFileSync } from 'node:fs';

const STUDIO = process.env.STUDIO ?? 'http://192.168.3.47:8888';
const KEY = process.env.UNSLOTH_KEY ?? '';

// The question exactly as trained, taken from the test set itself.
const first = JSON.parse(readFileSync(new URL('./data/test.jsonl', import.meta.url), 'utf8').split('\n')[0]);
const questions = JSON.parse(first.questions);

const CASES = [
  ['stop', 'robot, that\'s good, stop there.', 'That\'s right, two plus two is four.'],
  ['forward', 'hey come here', 'Should I come over?'],
  ['backward', 'back up a bit', 'I left my good mood somewhere this morning.'],
  ['left', 'Left please.', 'The cat looked at me again.'],
  ['right', 'alright steer right', 'Okay!'],
  ['keep_going', 'hey, drive until I say stop.', 'Okay, I\'ll speak English from now on.'],
  ['pass', 'hey go forward ten seconds', 'Why did the robot cross the road? Because it was programmed to!'],
  ['pass', 'um what\'s your name?', null],
  ['pass', 'we drove forward for hours on the trip', 'I\'m here.'],
  ['pass', 'um turn the page', 'I left my good mood somewhere this morning.'],
  ['pass', 'What time is it?', null],
];

const state = (heard, said) => (said ? `Robot said: "${said}"\n` : '') + `Person said: "${heard}"`;

async function ask(heard, said) {
  const t0 = performance.now();
  const res = await fetch(`${STUDIO}/v1/systemone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(KEY && { Authorization: `Bearer ${KEY}` }) },
    body: JSON.stringify({ model: 'jev-latest', state: state(heard, said), questions }),
  });
  const ms = Math.round(performance.now() - t0);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return { ms, answer: (await res.json()).answers.action };
}

const runs = process.argv[2] ? [[null, process.argv[2], process.argv[3] ?? null]] : CASES;
let right = 0;
for (const [gold, heard, said] of runs) {
  const { ms, answer } = await ask(heard, said);
  const ok = gold === null || answer.choice === gold;
  if (gold !== null && ok) right++;
  console.log(`${ok ? '✓' : '✗'} ${answer.choice.padEnd(10)} ${answer.confidence.toFixed(2)}  ${String(ms).padStart(5)}ms  ${heard}${gold && !ok ? `  (want ${gold})` : ''}`);
}
if (!process.argv[2]) console.log(`${right}/${runs.length}`);
