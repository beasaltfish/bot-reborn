<p align="center"><img src="admin/src/logo.svg" width="128" alt="bot-reborn logo: a little robot hatching from an eggshell"></p>

# bot-reborn

English | [中文](README.zh-CN.md)

> **A brain you configure, and a workbench to build it on.** Turn an ESP32-S3 or
> an old phone into a robot with a voice and a character — wire it, flash it and
> set it up from one page, before you buy a single part.

<p align="center"><a href="https://youtube.com/shorts/Y80lk1O1Z-0"><img src="docs/media/breadboard.gif" width="440" alt="An ESP32-S3 on a breadboard with a mic and an amp, talking back"></a></p>

*Asked to prove it's alive in three words: "Two copper wires."* — [watch the Short, with sound](https://youtube.com/shorts/Y80lk1O1Z-0)

## What you can build

Three gadgets that have already been built on this platform, plus the route
that needs no parts at all. Each is a different body on the same brain.

- **A desk companion that talks back.** An ESP32-S3, a microphone, an amp and a
  speaker on a breadboard, with a screen for a face.
  [1 min](https://youtube.com/shorts/Y80lk1O1Z-0)
- **A toy car that drives on a spoken command.** A $4 toy, a phone as its body,
  and a reflex model that answers a move in about 200 ms.
  [40 s](https://youtube.com/shorts/zPd0V5mH7p4)
- **A pet on a screen.** It sits, shakes a paw and lies back down when nobody
  talks to it.
  [30 s](https://youtube.com/shorts/zxbSJz2M2tY)
- **Or none of them yet:** [wire the whole thing in a browser first](#five-minutes-no-parts).
  A mistake burns a virtual part, not a real one.

The gadgets came before the platform: [how the first one was built](docs/story.md).

## The brain and its characters

A small Node server on your computer is the brain. It hears, understands,
decides and speaks. Every robot it drives is a **character** — and a character
is data, not code: one page in the admin app, and a second character can copy
providers from the first, keys included.

Four layers, each given its own provider and key:

- **Ears** — speech to text.
- **Mind** — the chat model, plus the persona that decides who it is and how it
  talks, in any language.
- **Voice** — text to speech.
- **Reflex** — optionally, a decision model you supply and serve yourself. It
  sees each line first and picks one action, so "stop" stops the car now rather
  than after a chat round trip.

Any OpenAI-compatible provider works; the admin page ships presets and tests
each key as you type it. Keys stay on the computer, in a file under
`~/.bot-reborn/` that only your user can read, and are sent only to the
providers you chose. The robot never sees them: it holds a token that says
which character it is.

<img src="docs/media/admin.png" width="440" alt="The admin page: a character's basic settings and the QR code a phone scans to become its body">

### Reflex, as an example of a layer

Reflex is one layer like the others, and the model behind it is yours to
choose: a JEV-style decision model, one you trained yourself and serve at
`/v1/systemone`, or a small one running on the same machine. Nothing about the
platform depends on which.

Whatever it is, it reads each line before the chat model and picks one move —
`stop`, `forward`, `backward`, `left`, `right`, `keep_going` — or `pass`, which
hands the turn to the chat model. It answers with a probability, not text, which
is why it can be fast: no voice in the reply, only the action.

The one this project has been using is a 0.8B model. On a Mac mini M4 it
answers about 200 ms after the transcript.

![The reflex server's log: after a 3.6 s first call that loads the model, every request takes 203–220 ms](docs/media/reflex-log.png)

It scores 86.6% on its test set (142 of 164). In use it does better than that
number suggests, because a move fires only above 0.8: anything it is unsure of
is passed to the chat model, which is slower but does not lurch the car off.
Getting a reflex wrong is worse than getting it late.

The example model:

- **Trained with** [Unsloth's decision-model recipe](https://unsloth.ai/docs/basics/train-your-own-decision-model-with-unsloth)
- **Dataset:** [`beasaltfish/robot-simple-commands`](https://huggingface.co/datasets/beasaltfish/robot-simple-commands) — built by [`training/commands/`](training/commands/)
- **Weights:** [`beasaltfish/robot-simple-commands-qwen3.5-0.8b`](https://huggingface.co/beasaltfish/robot-simple-commands-qwen3.5-0.8b)
  ([GGUF](https://huggingface.co/beasaltfish/robot-simple-commands-qwen3.5-0.8b-GGUF))

That example is English only. A command in another language should score low and
fall through to the chat model, but that is untested.

## The workbench

The wiring simulator is a bench in your browser, at `/sim/` on the brain's own
machine. It exists so the first hour of a build costs nothing:

- **Wire it by hand**, hole by hole: a seated pin's wire ends in a free hole on
  the same strip, and the netlist is computed from what you actually built.
- **Wire it for me** does the audio build in about forty seconds, then hands it
  back so you can do it yourself.
- **Mistakes are bounded, and some of them burn a virtual part** — a reversed
  supply is the classic.
- **Eleven device families** come with a bilingual five-stage lesson each, and
  there are nine guided projects that build something small and check it.

<p align="center"><a href="https://youtube.com/shorts/0MMilmoEPdo"><img src="docs/media/wire-it-for-me.gif" width="300" alt="The wiring simulator: click &quot;Wire it for me&quot; and an ESP32 gets a mic, a speaker and a screen"></a></p>

Power, current, level and bus checks are bounded models, not SPICE. Firmware
support is reported separately, and the table below is the honest version of
it. The firmware studio can build and run a sketch against the bench without
touching a board.

## Five minutes, no parts

1. **Start the brain** on a computer on the same Wi-Fi as the body:

   ```bash
   npm install
   server/models/fetch.sh   # the wake-word and VAD models, once
   npm start
   ```

   The admin page opens in your browser.
2. **Open the workbench:** <http://localhost:8787/sim/> (or the link in the
   admin sidebar). It opens only on the computer the brain runs on.
3. **Press Wire it for me.** An ESP32 gets a microphone, an amp and a speaker,
   then a screen, then the dog shows up on it. Undo it, and do it yourself.

No parts, no keys, no hardware. When you want the real one, keep reading.

## Real hardware

Every build needs the brain, a computer on the same Wi-Fi as the body, plus
**API keys** for speech-to-text, a chat model and text-to-speech.

The body is an ESP32-S3: it talks, listens, and shows a pet dog on a screen. It
does not drive a car yet.

- An **ESP32-S3** dev board, an **INMP441** microphone, a **MAX98357A** amp and
  a speaker, and a small SPI screen. Pin tables are in
  [`firmware/README.md`](firmware/README.md#wiring).
- **Chrome or Edge** and a USB cable. Open the admin page, plug the board into
  the port marked **USB**, and click **Set up a board**: "First time" writes the
  firmware, the Wi-Fi and the character's token, with no ESP-IDF to install. The
  board finds the brain on its own.
- Turn **Barge-in off** for this character. The body has no echo cancellation,
  so it would hear itself and interrupt itself.

The phone body — an Android phone plus an FT232H, which is what drove the car
in the demos above — still works, but it is not the direction here and the
README does not teach it: [`docs/hardware.md`](docs/hardware.md) does. Without
wheels, set a character's body to **Dry run** and the moves only reach the
brain's log, or to **Cannot move** for a robot that just talks.

## What runs where

The workbench models more than the real firmware implements — on purpose. This
table is which is which:

| Device | Simulated | On real firmware | Lesson |
|---|---|---|---|
| LED and resistor | yes | — | yes |
| Push button, two-terminal | yes | — | yes |
| Button module (KY-004) | yes | — | yes |
| HC-SR04 distance | yes | — | yes |
| BME280 environment | yes | — | yes |
| SSD1306 OLED | yes | — | yes |
| SG90 servo | yes | — | yes |
| TB6612FNG + DC motor | yes | — | yes |
| WS2812 strip | yes | — | yes |
| Power: USB, 4×AA, bench, MB102 | yes | USB only | yes |

The real firmware still implements only the original body: the INMP441
microphone, the MAX98357A amp and speaker, a screen, and four motor pins on
GPIO 4–7 for the car. Everything else in that table is something the workbench
can teach and the board cannot run yet.

### What a body can do

| Body | Moves | Shows | Needs |
|---|---|---|---|
| Car | drives, cruises, stops | a face | phone + FT232H (the older route) |
| Pet on a screen | poses, barks | a dog | a screen |
| Tarot | no | cards | an MPU-6050 wand |
| Dry run | logged only | a face | nothing |
| Cannot move | no | a face | nothing |

## Status and limits

**ESP32 body:** hears, talks and shows a pet dog on a breadboard, set up from
the admin page. Driving is the next step, along with choosing the screen from
the admin page. The tarot wand works in the simulator; the firmware reads it
too, but that has not been tried on a real board yet.

**Phone body:** works end to end on one robot and one phone, and is kept as it
is. The simple-commands reflex was driven by a real voice on that car and the
0.8 threshold holds up; the bark preset is still on its first guess. The phone
is top-heavy and has tipped the car over backing up.

Some hardware numbers are still unmeasured.

## More

- [`firmware/README.md`](firmware/README.md) — the ESP32 body: pins, flashing, setup
- [`docs/story.md`](docs/story.md) — the gadget this platform came out of
- [`docs/hardware.md`](docs/hardware.md) — the toy car's wiring, pin map, every measurement
- [`docs/esp32-lessons.md`](docs/esp32-lessons.md) — faults the ESP32 board has had
- [`docs/development.md`](docs/development.md) — reading the code, running it, tests, security
- [`docs/instruments.md`](docs/instruments.md) — the calibration page behind the gear
- [`docs/ui.md`](docs/ui.md) — the robot's face and what each state means
- [`docs/promo-video.md`](docs/promo-video.md) — what making the video taught us
- [`training/commands/`](training/commands/) — the simple-commands dataset, its builder and model card

## License

[MIT](LICENSE). The sounds in `server/sounds/` are CC0 — see their
[credits](server/sounds/CREDITS.md).
