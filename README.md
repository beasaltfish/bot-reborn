# bot-reborn

English | [中文](README.zh-CN.md)

**Turn a $4 toy robot into an AI robot, with an old phone as its body and your
computer as its brain.**

[![The robot keeping a child company while the real dog eats](docs/media/demo.gif)](https://youtube.com/shorts/SNA9ok1j0Sg)

*Real dog: busy eating. Robot dog: on duty.* — [watch the Short, with sound](https://youtube.com/shorts/SNA9ok1j0Sg)

[![The robot on a desk answering a child's science questions during homework](docs/media/homework.gif)](https://youtube.com/shorts/3Y984t1W6nc)

*Kid: has questions. Robot: has attitude.* — [watch the Short, with sound](https://youtube.com/shorts/3Y984t1W6nc)

[![The robot driving off a spoken command, with the reflex model's server log beside it](docs/media/reflex.gif)](https://youtube.com/shorts/zPd0V5mH7p4)

*A spoken move, answered in about 200 ms by a 0.8B model on the computer — no LLM call.* — [watch the Short, with sound](https://youtube.com/shorts/zPd0V5mH7p4)

**📖 The whole build story: [I turned a $4 toy robot into an AI robot that talks back](https://agentlenshq.com/maker/four-dollar-robot)**

<table>
  <tr>
    <td align="center"><img src="docs/media/before.jpg" height="320" alt="The toy as sold: a Silverlit Maze Breaker in its box"></td>
    <td align="center"><img src="docs/media/phone-mount.jpg" height="320" alt="A phone held on the headless robot by a cardboard saddle and rubber bands, showing the robot's face"></td>
  </tr>
  <tr>
    <td align="center">Before: a line-following toy</td>
    <td align="center">After: the head is gone, the phone is the face</td>
  </tr>
</table>

## What it does

- **You talk, it drives and answers.** "Go forward two seconds, then turn
  left".
- **Reflexes, before the chat model thinks.** Optionally, a small decision
  model hears each line first and picks one of a few answers you wrote; each
  answer does what you set it to — play a sound, move, stop — or hands the
  turn to the chat model. Two presets come with it: *bark* (bark at it and it
  barks back) and *simple commands* ("stop", "come here", "turn left" act at
  once). Both are just data you can edit on the admin page.
- **It listens while its screen is on.** No wake word needed, though you can
  turn one on. Hit the stop button and the car stops, whatever it was doing.
- **Several characters, one brain.** Each robot is a character with its own
  name, voice, providers and keys, all set up from an admin page in your
  browser, in English or Chinese.

## What you need

- **A cheap toy robot or car** with a drive motor and steering. Ours is a
  Silverlit Maze Breaker. It is the only one tested so far, but
  any toy driven by the same kind of motor driver should work the same way.
- **An FT232H breakout board** — the bridge between the phone's USB port and
  the toy's motor driver.
- **An Android phone with Chrome.** The phone talks to the board over WebUSB,
  which iPhones do not have. Plus a USB-C cable to the board.
- **API keys** for speech-to-text, a chat model and text-to-speech. Any
  OpenAI-compatible provider works; the admin page has presets for common ones.
- **For reflexes (optional):** a decision model — JEV, or one trained with
  [Unsloth](https://github.com/unslothai/unsloth) and served at
  `/v1/systemone`. The simple-commands preset asks exactly the question of the
  model trained on [`training/commands/`](training/commands/).
- A soldering iron, some wire, cardboard and rubber bands.

No car yet? Set a character's body to **Dry run** and the moves are only
written to the brain's log, or to **Cannot move** for a robot that just talks. The
phone then needs no board at all.

## How it works

![The toy's own board with the FT232H wired onto its motor and steering inputs](docs/media/wiring.jpg)

The toy's own line-following chip is cut out of the loop. Four wires from the
FT232H go straight to the inputs of the toy's motor driver and steering coil,
and the phone switches those four pins over USB. The phone is the robot's
body: it listens, plays, drives and shows a face. Everything that decides —
hearing its name, understanding, choosing what to do, talking back — runs in a
small Node server on a computer on the same Wi-Fi, the robot's brain.

The brain started out inside the phone's browser and moved to the computer for
two reasons: everything that hears you can, in time, run locally on your own
machine — the reflex model already does — and the body can shrink to something
much smaller than a phone. An ESP32-S3 body is on its way
([`firmware/`](firmware/README.md)); a phone, it turns out, is heavy enough to
tip the car over when it backs up.

## The reflex model

"Stop" should stop the car now, not after a speech-to-text, chat model and
text-to-speech round trip. So before the chat model sees a line, a 0.8B
decision model reads it and picks one simple move — `stop`, `forward`,
`backward`, `left`, `right`, `keep_going` — or `pass`, which hands the turn to
the chat model. It answers with a probability, not text, which is why it is
fast: about 200 ms from transcript to move on a Mac mini M4, with no voice in
the reply, only the action.

![The reflex server's log: after a 3.6 s first call that loads the model, every request takes 203–220 ms](docs/media/reflex-log.png)

It scores 86.6% on its test set (142 of 164). In use it does better than that
number suggests, because a move fires only above 0.8: anything it is unsure of
is passed to the chat model, which is slower but does not lurch the car off.
Getting a reflex wrong is worse than getting it late.

- **Trained with** Unsloth's decision-model recipe:
  [Train your own decision model with Unsloth](https://unsloth.ai/docs/basics/train-your-own-decision-model-with-unsloth)
- **Dataset:** [`beasaltfish/robot-simple-commands`](https://huggingface.co/datasets/beasaltfish/robot-simple-commands)
  — built by [`training/commands/`](training/commands/)
- **Model:** [`beasaltfish/robot-simple-commands-qwen3.5-0.8b`](https://huggingface.co/beasaltfish/robot-simple-commands-qwen3.5-0.8b)
  ([GGUF](https://huggingface.co/beasaltfish/robot-simple-commands-qwen3.5-0.8b-GGUF))

It is English only. A command in another language should score low and fall
through to the chat model, but that is untested.

## Build your own

1. **Wire it.** Pin map, wiring and measurements are in
   [`docs/hardware.md`](docs/hardware.md). Read its D6/D7 soldering warning
   before you start.
2. **Start the brain** on a computer on the same Wi-Fi as the phone:

   ```bash
   npm install
   server/models/fetch.sh   # the wake-word and VAD models, once
   npm start
   ```

   The admin page opens in your browser. Make a character, pick what body it
   has, and give each layer (ears, mind, voice, and optionally reflex) a
   provider and key; the page tests each one as you type it, and a second
   character can copy providers, keys included, from the first.

   ![The admin page: a character's basic settings and the QR code a phone scans to become its body](docs/media/admin.png)
3. **Let Chrome on the phone use USB and the microphone on that page**, once
   per phone: open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`,
   add the address the admin page shows (`http://<computer>:8787`), set it to
   Enabled and relaunch Chrome. The page is plain http on your own network, and
   Chrome only allows USB and the microphone on a page it treats as secure.
   Giving the computer a fixed address on your router saves redoing this.
4. **Scan the character's QR code** on the admin page with the phone, plug the
   board in, and press Listen. The robot shows what it is still missing, and
   each missing part is a step: plugging in the board, and teaching it which
   way is left. A phone with no board plugged in still listens and talks.

Your keys stay on the computer, in a file under `~/.bot-reborn/` that only your
user can read, and are sent only to the providers you chose. The phone never
sees them: it holds a token that says which character it is. See
[Security](docs/development.md#security).

## Status

It works end to end on one robot and one phone. Some hardware numbers are
still unmeasured. The simple-commands reflex has been driven by a real voice
on the car (the third video above) and the 0.8 threshold holds up; the bark
preset is still on its first guess. The phone is top-heavy and has tipped the
car over backing up, which is part of why an ESP32 body is next.

## More

- [`docs/hardware.md`](docs/hardware.md) — wiring, pin map, every measurement
- [`docs/development.md`](docs/development.md) — reading the code, running it,
  tests, security
- [`docs/instruments.md`](docs/instruments.md) — the calibration page behind
  the gear
- [`docs/ui.md`](docs/ui.md) — the robot's face and what each state means
- [`docs/promo-video.md`](docs/promo-video.md) — what making the video taught us
- [`training/commands/`](training/commands/) — the simple-commands dataset,
  its builder and model card

## License

[MIT](LICENSE). The sounds in `server/sounds/` are CC0 — see their
[credits](server/sounds/CREDITS.md).
