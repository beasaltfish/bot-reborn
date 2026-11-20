# Development

Everything a contributor needs that a builder does not. The project overview,
and how to build one, are in the [README](../README.md).

The design spec is a private working document and is not in this repo, so the
`§` references in the code and in `docs/hardware.md` point at something you
cannot open. `docs/hardware.md` is the published record: everything in it was
measured on the actual hardware.

## Reading the code

About 8000 lines of product code (the brain, the phone and the admin page), 1000 of instruments and 8000 of tests. Read it in this
order — it follows the safety argument the design is built around, not the
order the data flows.

**Start with the test names, not the code.** `npm test` prints all of them
and they are written as sentences, so the output is a behaviour inventory you
can read in fifteen minutes. It is the cheapest map of the codebase there is.

The code is in three places. `core/` is what the brain and a body share — the
protocol, the voice chain, the strings. `server/` is the brain: it runs on a
computer, serves the admin page and the phone's page, and holds every key.
`phone/` is the body: the page the phone opens, which hears, plays, drives and
shows a face. `admin/` is the admin page (React). `test/layout.test.js` holds
the three apart: `core/` imports only `core/`, and the brain and the phone
never import each other.

1. **`phone/ftdi.js` + `phone/executor.js`** — the only code here that moves a
   physical object. `buildStream()` appends the stop byte *inside* the same
   buffer as the drive bytes, so the car stops even if the JS that was driving
   it dies; the renewal loops in `#renew()` and `#holdUntil()` exist to keep
   that guarantee bounded. If you read one thing, read these.
2. **`core/protocol.js`, `phone/body-link.js`, `server/link.js`** — the wire
   between a body and the brain, and the watchdog on each end: a body that
   hears nothing for a second stops the car by itself.
   `server/fake-body.js` is the reference a new body (the ESP32) copies.
3. **`core/brain.js`** — one conversational turn, start to finish: tool
   definitions, the system prompt, the validator that only ever accepts or
   discards (it never silently rewrites what the model asked for), then
   `handle()`.
4. **`core/audio/session.js`** — the state machine, and the only file allowed
   to make a decision. Start at `wantedSubscriptions()`, which is spec §5.3's
   table written as a table.
5. **`core/reflex.js` + `core/reflex-presets.js`** — the shortcut in front of
   the LLM. The question and what each answer does are the character's data,
   not code; the presets are only starting points. Every way the judge can fail
   ends in "ask the LLM as usual", and a fired answer's actions go through the
   same validator and the same body limits as the LLM's.
6. **`server/robot.js` and `phone/app.js`** — how each side is wired together.
   Every decision in them was made somewhere else.

`phone/dev.html`, `phone/dev.js` and `phone/panels/` are instruments rather than product; read
`docs/instruments.md` before changing them, and skip them until you need them.

## Bodies: capabilities, verbs, actions

Three layers; only the actions are a person's to write.

- **Capabilities** are what the body has: `hear`, `speak`, `show`, `move`
  (`CAPABILITIES` in `core/bodies.js`). They describe hardware, not behaviour.
- **Verbs** are the closed set of five things the hardware can be told to do:
  `drive`, `halt`, `voice`, `pose`, `draw` (`core/verbs.js`). Each one names the
  capability it needs (`needs`), the arguments it takes, and the sentence that
  bounds it (`bounded`) — a bound written only in a comment drifts away from the
  code that enforces it.
- **Actions** are the model's vocabulary: a name, the `say` text that teaches
  when to call it, an optional args schema, and a `run` program of verbs
  (`core/actions.js` checks the shape; `expand` fills an argument into each
  step and drops one that does not fit). `toolsOf(body)` in `core/brain.js`
  turns a body's actions into tools, then appends the fixed tools the
  template names in `fixedTools`: only `set_reply_language` exists, and
  `pet` and `tarot` name none.

A **body** is a template (`TEMPLATES` in `core/bodies.js`): its capabilities, its
ways (the source and the parts each one costs), its actions, its prompts, its
triggers and its firmware. There are five — `none`, `pet`, `tarot`, `toy`, and a
hidden `dry-run` (open the admin with `?bench`). `resolveBody(id, patch)` copies
one into the body a character uses: a patch that carries its own `actions` is a
body of its own, one without them follows `template ?? id`, and an id with
neither falls back to `none`. A character written before the setting has no
`body` key and stays `toy` (`bodyOf` in `core/config.js`).

`bodyProblem()` in the same file is the single check on any body, template or
hand-written: it refuses an action that needs a capability the body lacks, a
trigger naming an action that is not there, a missing voice or a malformed rules
list, and a body that both poses and draws (one screen, one surface).
`test/bodies.test.js` runs it on every template.

The dry run is in the table but not in the picker (`?bench` shows it). As far
as the model can tell it is the toy — the same prompt and the same four actions
— but every verb is only written to the brain's log, and no frame reaches the
screen. It is how the orders are read back with nothing to drive.

A character file has no version number. An older brain reading a file written by
a newer one silently drops the keys it does not know — a body's `actions`, for
instance — so a hand-written body comes back as its template with nothing said.
Keep the brain and the characters together; there is no migration to run when
going back a version.

### Adding an action

No code and no firmware. In the admin's Body tab, open **Actions** and edit the
JSON: copy the template's actions first ("Copy this template"), then change one
or add one. The editor validates the edit with `bodyProblem` and shows the
sentence when it refuses; a whole edit is saved and takes effect the next time
the body connects.

An action is `{ name, label, say, args?, run, returns?, rules? }`:

- `name` is what the model calls — lowercase, digits and `_`, and not
  `set_reply_language`, which is reserved.
- `say` is the only thing that teaches the model *when* to call it.
- `run` is a list of steps, each `{ verb, args?, each? }`. `args` values written
  as `$name` are filled from the call's arguments; inside an `each` step,
  `$each.field` is the current element. Only the five verbs may appear.
- Everything it asks for has to exist: a `pose` name in `core/poses.js` or a
  `voice` clip in `core/audio/sfx.js` written literally is checked now.
- `returns: true` is only for a single `draw` step: that is the one result the
  model is asked again with. A `draw` step without it is refused — the brain
  resolves the step and does nothing, so the card would never reach the model.
- `rules` is a paragraph appended to the system prompt after the body's own.

### Adding a verb

This one is hardware. A verb is only real if the firmware can be told to do it,
so the work is three places and a test:

1. A message or frame the firmware already answers — `move`, `stop` and `hush`
   on the body socket (`core/protocol.js`), or a screen frame over
   `server/screen-link.js`. A new one means new firmware; the shared cases in
   `firmware/test/brain-messages.json` are judged by both parsers
   (`test/firmware-vectors.test.js` and `firmware/test/test_proto.c`), so add
   one there.
2. A row in `VERBS` (`core/verbs.js`) with `needs`, `args` and `bounded`.
3. A carrier for it in `makeExecutor`/`CompositeExecutor` (`server/robot.js`),
   which is where each verb is handed to the motors, the screen, or the log.
4. `test/verbs.test.js` pins the five names and what each one needs; it has to
   change with the table. Nothing compares that list to the firmware sources, so
   keeping the two in step is a review duty, not a test.

Adding an action never needs a verb. A verb that no firmware or brain implements
would be a promise with nothing behind it, which is why the layer is closed.

### The prompt

`buildSystemPrompt()` (`core/brain.js`) assembles the prompt from the body, not
from its id: the persona (the admin's, or `DEFAULT_PERSONA`), then
`prompts.voice`, then `prompts.rules` in the order the body keeps them, then each
action's `rules` in `actions` order, then — for a body that answers in `tts` and
has a recorded preference — the line naming the reply language. A body that
answers in clips gets no such line. `test/prompts-golden.js` freezes the prompts
of the toy, the voice-only body, the pet and the tarot reader byte for byte, so
a change to any of those strings is a decision, not a snapshot update. The dry
run has no prompt of its own: it carries the toy's.

Two habits that pay off here. **The comments carry the argument, not a
description of the code** — where one says why some other approach was rejected,
that rejection is usually load-bearing. And when you want to know what a guard
is for, **delete it and run the tests**: the three nastiest defects found so far
were all found exactly that way.

## Running it

```bash
npm install
npm run setup            # once: models, a Node check, one build — says what is missing
npm start                # the brain on :8787, and the admin page in your browser
npm run dev              # the same, for changing the pages: edits show without a build
```

Tested on Node 24.13.1; the floor is what the locked Vite accepts, `^20.19.0 || >=22.12.0`. `npm run setup` is a check, not
an installer: it fetches the two models and builds the pages, and it names the
next step for anything else it finds.

The admin page is at `http://localhost:8787/` and opens only on that machine,
as does the wiring simulator at `/sim/`. The phone's page is at
`http://<this machine>:8787/phone/`; a phone needs Chrome's
`unsafely-treat-insecure-origin-as-secure` flag set to that origin before it
may use USB or the microphone there (the README has the steps).
`server/fake-body.js` drives the whole brain from a WAV file, with no phone.

All three pages are one Vite build (`vite.config.js`, into `dist/`).
`npm start` runs it when any page, `core/` or the config is newer than
`dist/`, and does not start if it fails: the phone runs the built pages, and
an old build would hand it a `core/` the brain no longer speaks.
`npm run build` runs it by hand. `npm run dev` skips it: Vite runs inside the
brain, on the same address and port, so a phone keeps its flag. A saved page
file reloads the page (admin's React components update in place, keeping
their state); a saved file under `server/` or `core/` restarts the brain, and
a connected body reconnects. Which addresses the network may open, in either
mode, is the table in `server/pages.js`.

```bash
npm test             # node --test and the admin page's vitest — no browser
npm run typecheck    # tsc --noEmit, strict, over core/, server/, phone/, sim/, test/ and admin/
```

## Simulator device pack

`sim/parts.js` owns physical pins and seating, `sim/devices/catalog.js` owns
capabilities, properties and the future firmware contract, and
`sim/electrical/evaluate.js` resolves bounded source/regulator/load networks.
Device-specific evaluators (`digital-inputs.js`, `servo.js`, `motor-driver.js`,
`ws2812.js`, `ssd1306.js`, `bme280-evaluate.js`) add state without guessing
firmware pin modes. `sim/lessons/` holds bilingual lesson content and
`sim/projects.js` the guided projects.

To add a device: add a checked-in note under `docs/hardware/`, a `PartDef`, a
catalogue row with properties/firmware contract, a procedural visual, a
capability evaluator and tests, a five-stage lesson and at least one project.
Keep unsupported networks explicitly unsupported; do not treat a missing model
as a working circuit. Solver limits are listed in each hardware note: no SPICE,
no thermal or timing simulation, no charging chemistry, no arbitrary resistor
networks.

The hardware notes are the source of truth for selected variants:
`sim-power-sources.md`, `sim-digital-inputs.md`, `sim-ssd1306.md`,
`sim-sg90.md`, `sim-tb6612-motor.md` and `sim-ws2812.md`.

### Trying Volcengine (`豆包语音`) with a real key

The Volcengine adapters (`server/providers/stt-volcengine.js`,
`server/providers/tts-volcengine.js`) were written from the docs and tested
against fakes. A few things only a real API key (new console, one `X-Api-Key`)
can settle. STT uses `一句话识别` (one-shot recognition) on the 2.0 model, so
first enable **`豆包流式语音识别模型 2.0（小时版）`** in the Volcengine console for
that key. Those are console product names, kept verbatim because that is what the
console shows.
Pick "Volcengine 火山引擎" for STT and TTS on a character, then:

- [ ] **STT Test button** on the admin page shows the check clip's words. If it
      fails, the error names Volcengine's status code. A 401 or 403 straight
      away usually means the 2.0 resource is not enabled for the key.
- [ ] **TTS Test button** plays `小何`, the preset voice, in the browser. Also note whether the last
      line of the answer carries code `20000000`. The docs only describe `0`, and
      the adapter lets `20000000` through just in case; if it never appears, that
      exception can go.
- [ ] **Voices outside the list.** Under "Other", try one 1.0 voice (`…_mars_bigtts`)
      and one `ICL_…` voice. Write down in the preset comment whether each one
      works on `seed-tts-2.0`.
- [ ] **A real turn on the robot.** Speak, hear the answer from the robot's
      speaker, and interrupt it mid-sentence. Check the brain log for `[stt]` and
      `[tts]` faults.

`stt.prompt` is not sent to Volcengine. Sending the robot's last reply as the
recogniser's `context` is planned separately.

## Tarot card pictures

The pictures the tarot screen shows are committed in `server/tarot/cards/`, so running the brain needs nothing below. You only need it to change how they look:

```
node tools/tarot/fetch.js   # once: 78 public-domain Rider-Waite-Smith scans from Wikimedia Commons into tools/tarot/source/, and Noto Sans SC into tools/tarot/fonts/
npm run tarot:render        # redraws every picture for each screen size
```

The scans and the 17 MB font file are git-ignored; the font's licence (SIL OFL) is `tools/tarot/fonts/OFL.txt`. Card names are drawn in Noto Sans SC, never a system font. Commons throttles fast clients, so `fetch.js` may stop part way: run it again, it keeps what it has.

## Security

**Your API keys live on the computer that runs the brain**, in one JSON file
per character under `~/.bot-reborn/characters/`, readable only by your user.
They are sent only to the providers you configured. Anything that can read
your files can read them.

The admin page, which shows keys and tokens, answers only requests from that
machine. The phone's page is open to your network and holds no key; a body is
let in only with a character's token, which the QR code carries in the part of
the URL that is never sent to a server. Anyone on your Wi-Fi who has the token
can be that character's body — replace the token on the admin page if it
leaks.

## Browser support

WebUSB is available in Chromium-based browsers (Chrome, Edge, Opera) only.
Firefox and Safari do not implement it.
