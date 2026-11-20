<p align="center"><img src="admin/src/logo.svg" width="128" alt="bot-reborn logo: a little robot hatching from an eggshell"></p>

# bot-reborn

English | [中文](README.zh-CN.md)

> **A brain you configure, and a workbench to build it on.** Turn an ESP32-S3 or
> an old phone into a robot with a voice and a character — wire it, flash it and
> set it up from one local app, before you buy a single part.

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

Ears, mind and voice take any OpenAI-compatible provider; the admin page ships
presets and tests each key as you type it. Reflex is the exception: it wants a
local decision model served at an endpoint, not a chat provider. Keys stay on the computer, in a file under
`~/.bot-reborn/` that only your user can read, and are sent only to the
providers you chose. The robot never sees them: it holds a token that says
which character it is. See [Security](docs/development.md#security).

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
- **Build it for me** leaves the audio build standing; **Demo** shows it going
  together in about forty seconds. Either way you can undo it and do it
  yourself.
- **Mistakes are bounded, and some of them burn a virtual part** — a reversed
  supply is the classic.
- **Ten device families** come with a bilingual five-stage lesson each, and
  there are nine guided projects that build something small and check it.

<p align="center"><a href="https://youtube.com/shorts/0MMilmoEPdo"><img src="docs/media/wire-it-for-me.gif" width="300" alt="The wiring simulator: press Demo and an ESP32 gets a mic, a speaker and a screen"></a></p>

Power, current, level and bus checks are bounded models, not SPICE. Firmware
support is reported separately, and the table below is the honest version of
it. The firmware studio can build and run a sketch against the bench without
touching a board.

## Five minutes, no parts

1. **Start the brain** on a computer on the same Wi-Fi as the body. Three
   commands; Node 20.19+ or 22.12+ first.

   ```bash
   npm install
   npm run setup   # the wake-word and VAD models, a Node check, one build
   npm start
   ```

   `npm run setup` says what is missing and how to fix it. The admin page opens
   in your browser. Open a character to see what is left before the first
   conversation. The card tells you what the brain knows—including whether
   the character has replied out loud since startup—and what this browser
   remembers about flashing a board.
2. **Open the workbench:** <http://localhost:8787/sim/> (or the link in the
   admin sidebar). It opens only on the computer the brain runs on — the
   workbench is the brain's own page.
3. **Open Projects, pick Audio + screen, then Shopping list.** That is what to
   buy, with the spec to check on each listing and a rough price; print it.
   Then press Demo to watch it go together in about forty seconds, or **Build
   it for me** to leave the same bench standing and wire it up by hand.

No parts, no keys, no hardware. When you want the real one, keep reading.
macOS is what this has been walked through on; Windows is untested.

## Real hardware

Every build needs the brain, a computer on the same Wi-Fi as the body, plus
**API keys** for speech-to-text, a chat model and text-to-speech.

The body is an ESP32-S3: it talks, listens, shows a pet dog on a screen, and
runs timed moves on a car's motor driver inputs (GPIO 4–7).

- An **ESP32-S3** dev board, an **INMP441** microphone, a **MAX98357A** amp and
  a speaker, and a small SPI screen. Pin tables are in
  [`firmware/README.md`](firmware/README.md#wiring).
- **Chrome or Edge** and a USB cable. Open the admin page, plug the board into
  the port marked **USB**, and click **Set up a board**: "First time" writes the
  firmware, the Wi-Fi and the character's token, with no ESP-IDF to install. The
  board finds the brain on its own.
- Turn **Barge-in off** for this character. The body has no echo cancellation,
  so it would hear itself and interrupt itself.
- Driving a toy, give the character **Body: Toy on wheels**, wire the four motor inputs,
  and calibrate: `cal drive` if it goes backwards, `cal steer` if it turns the
  wrong way. The board stops the car within a second of losing the brain.

The phone body — an Android phone plus an FT232H, which is what drove the car
in the demos above — still works, but it is not the direction here and the
README does not teach it: [`docs/hardware.md`](docs/hardware.md) does. Without
wheels, open the admin with `?bench` and set a character's body to **Dry run**:
the moves only reach the brain's log. **Voice only** is a robot that just talks.

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
| MPU-6050 (the tarot wand) | yes | reads it, untested on a board | — |

The real firmware still implements only the original body: the INMP441
microphone, the MAX98357A amp and speaker, a screen, four motor pins on GPIO
4–7 for the car, and the MPU-6050 on I²C. Everything else in that table is
something the workbench can teach and the board cannot run yet.

### What a body can do

A body is a template, not a firmware and not the character. There are five, in
[`core/bodies.js`](core/bodies.js): voice only, a pet on a screen, a tarot
reader, a toy on wheels, and a dry run kept out of the picker (open the admin
with `?bench` to see it). The admin's Body tab draws one card per template: the
capabilities it has — hear, speak, show, move — the parts each body costs, and
the actions the model may call.

| Template | Capabilities | Actions the model may call | Parts |
|---|---|---|---|
| Voice only (`none`) | hear, speak | `play_sound` | ESP32 board, mic, amp |
| Pet on a screen (`pet`) | hear, speak, show | `pose`, `play_sound` | ESP32 board, mic, amp, screen |
| Tarot reader (`tarot`) | hear, speak, show | `draw_card` | ESP32 board, mic, amp, screen, wand (optional) |
| Toy on wheels (`toy`) | hear, speak, move | `move`, `cruise`, `stop`, `play_sound` | toy, ESP32 board, mic, amp |
| Dry run (`dry-run`) | hear, speak, move | the toy's four | nothing: every verb is logged, never sent |

A body's actions are yours to edit. The Body tab holds them as JSON, and once
you write your own the body keeps them instead of following the template; the
model is then offered those actions (plus the one fixed language tool) and the
prompt is built from that body's own words. Nothing is compiled and nothing is
flashed for this — an action is a program of the five verbs the hardware already
answers (`drive`, `halt`, `voice`, `pose`, `draw`). The parts list is the other
half: it is what to buy, and it is fixed by the template.

A character with no body chosen is voice only; a character file written before
this setting has no `body` key and is still the toy
([`core/config.js`](core/config.js)). The rest of the account — the verbs, and
what an action may say — is in [`docs/development.md`](docs/development.md#bodies-capabilities-verbs-actions).

## Status and limits

**ESP32 body:** hears, talks, shows a pet dog on a breadboard and drives a toy's
motor inputs, all set up from the admin page. The admin page can also pick the
screen, but no panel model is marked verified yet, so the picker is empty and
says so; until one is lit and recorded, type `screen` in the serial console for
the list, then `screen <id>` and `reboot` — the choice takes effect at boot. The tarot wand works in the simulator; the firmware reads it too, but
that has not been tried on a real board yet.

**Phone body:** works end to end on one robot and one phone, and is kept as it
is. The simple-commands reflex was driven by a real voice on that car and the
0.8 threshold holds up; the bark preset is still on its first guess. The phone
is top-heavy and has tipped the car over backing up.

Some hardware numbers are still unmeasured.

## More

- [bot-reborn.agentlenshq.com](https://bot-reborn.agentlenshq.com) — a 20-second look at the workbench
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
