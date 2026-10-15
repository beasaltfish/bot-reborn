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
5. **`core/reflex.js` + `core/ladder.js`** — the shortcut in front of the LLM.
   Every way the judge can fail ends in "ask the LLM as usual"; the ladder is a
   table, not a model, so the same bark gets the same answer every time.
6. **`server/robot.js` and `phone/app.js`** — how each side is wired together.
   Every decision in them was made somewhere else.

`phone/dev.html`, `phone/dev.js` and `phone/panels/` are instruments rather than product; read
`docs/instruments.md` before changing them, and skip them until you need them.

Two habits that pay off here. **The comments carry the argument, not a
description of the code** — where one says why some other approach was rejected,
that rejection is usually load-bearing. And when you want to know what a guard
is for, **delete it and run the tests**: the three nastiest defects found so far
were all found exactly that way.

## Running it

```bash
npm install
server/models/fetch.sh   # once: the wake-word and VAD models
npm start                # the brain on :8787, and the admin page in your browser
```

The admin page is at `http://localhost:8787/` and opens only on that machine.
The phone's page is at `http://<this machine>:8787/phone/`; a phone needs
Chrome's `unsafely-treat-insecure-origin-as-secure` flag set to that origin
before it may use USB or the microphone there (the README has the steps).
`server/fake-body.js` drives the whole brain from a WAV file, with no phone.

```bash
npm test             # node --test and the admin page's vitest — no browser
npm run typecheck    # tsc --noEmit, strict, over core/, server/, phone/, test/ and admin/
```

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
