# bot-reborn

A voice-controlled toy car. A phone rides on the car and drives an **FT232H**
breakout over WebUSB in FTDI async bitbang mode; the car's own line-following
brain is gone. Pins `D4`–`D7` (pin mask `0xF0`) carry the two motor-driver
inputs and the two steering-coil inputs — see [`docs/hardware.md`](docs/hardware.md),
and read the D6/D7 soldering warning there before wiring anything.

The design spec is a private working document and is not in this repo, so the
`§` references in `docs/hardware.md` point at something you cannot open. That
file is the published record: everything in it was measured on the actual
hardware.

The voice loop works end to end: a wake word opens a session, a VAD cuts each
utterance, STT and an LLM turn it into car actions and a spoken reply, and a
local emergency stop word can interrupt any of it. What is **not** built yet is
the settings page, the first-run wizard and the barge-in calibration (spec §7.3)
— for now the providers are configured on `setup.html`. Five hardware
calibration figures are also still unmeasured; `docs/hardware.md` marks them.

## Project layout

```
.
├── README.md
├── package.json        # `npm test`, `npm run typecheck` — no build step
├── tsconfig.json       # JSDoc types checked with tsc --checkJs, strict
├── wrangler.jsonc      # Cloudflare Pages project config
├── docs/
│   └── hardware.md     # pin map, wiring, calibration results, measurements
├── test/               # node:test, no browser needed
└── web/                # Pages output directory (deployed as-is)
    ├── index.html      # the robot itself
    ├── app.js          # entry point: wiring only, no logic
    ├── ui.js           # log, state lamp, start/stop, the emergency button
    ├── config.js       # the only module that touches localStorage
    ├── strings.js      # UI copy and fixed spoken lines (en / zh)
    ├── ftdi.js         # FTDI protocol: bitmode, baud rate, byte streams, purgeTx
    ├── executor.js     # actions → byte buffers, renewal loop, generation preemption
    ├── brain.js        # tool definitions, system prompt, validator, one turn
    ├── audio/
    │   ├── session.js  # the session state machine — every policy decision
    │   ├── pipeline.js # one getUserMedia, 100 ms frames, many subscribers
    │   ├── sherpa.js   # loads the wasm and isolates what it puts on the global
    │   ├── kws.js      # keyword spotter: frames in, labels out
    │   ├── vad.js      # voice detector, plus the 512-sample window carry
    │   ├── earcon.js   # the five prompt sounds
    │   ├── keepalive.js# the keep-alive tone, and the detector for when it fails
    │   ├── keyword-lines.js # validates keywords before the wasm can abort on them
    │   └── pcm.js      # Float32 ↔ Int16
    ├── keywords/       # the two keyword files (ARPAbet + pinyin)
    ├── models/         # the vendored sherpa-onnx KWS+VAD wasm bundle
    ├── providers/      # STT / LLM / TTS, all OpenAI-compatible endpoints
    ├── bench.html/.js  # calibration bench: polarity, byte rate, start threshold
    ├── setup.html/.js  # provider config, four connectivity tests, typed drive
    ├── fixtures/       # your own STT test audio (not in git — see its README)
    ├── spike/          # bring-up probes: KWS cost, the audio path, barge-in
    └── style.css
```

## Reading the code

About 2100 lines of product code and 2600 lines of tests. Read it in this
order — it follows the safety argument the design is built around, not the
order the data flows.

**Start with the test names, not the code.** `npm test` prints all 173 of them
and they are written as sentences, so the output is a behaviour inventory you
can read in fifteen minutes. It is the cheapest map of the codebase there is.

1. **`ftdi.js` + `executor.js`** — the only code here that moves a physical
   object. `buildStream()` appends the stop byte *inside* the same buffer as the
   drive bytes, so the car stops even if the JS that was driving it dies; the
   renewal loop in `#renew()` exists to keep that guarantee bounded. If you read
   one thing, read these two functions.
2. **`brain.js`** — one conversational turn, start to finish: tool definitions,
   the system prompt, the validator that only ever accepts or discards (it never
   silently rewrites what the model asked for), then `handle()`.
3. **`audio/session.js`** — the state machine, and the only file allowed to make
   a decision. Start at `wantedSubscriptions()`, which is spec §5.3's table
   written as a table.
4. **`audio/sherpa.js`, `kws.js`, `vad.js`, `pipeline.js`** — four wrappers with
   no branches anywhere in them, on purpose: none of this is reachable from
   `node:test`, so a decision hidden in here would be untestable by
   construction. Read them fast; the point is how little they contain.
5. **`app.js`** — how it is all wired together. Every decision in it was made
   somewhere else.

`bench.js` and `setup.js` are instruments rather than product, and `spike/` is
throwaway probe code kept because it is already calibrated against one specific
phone. Skip all three until you need them.

Two habits that pay off here. **The comments carry the argument, not a
description of the code** — where one says why some other approach was rejected,
that rejection is usually load-bearing. And when you want to know what a guard
is for, **delete it and run the tests**: the three nastiest defects found so far
were all found exactly that way.

## Local development

WebUSB requires a secure context, which includes `http://localhost`:

```bash
npx serve web        # or: python3 -m http.server -d web 8000
```

Then open the printed URL in Chrome or Edge. `index.html` is the robot;
`setup.html` configures the providers and drives the whole chain by typing, and
`bench.html` is the hardware bench.

Note that `localhost` is enough for WebUSB but **not** for testing on a phone:
the phone needs a real secure context, so deploy first (see below).

```bash
npm test             # node --test — the whole suite, no browser
npm run typecheck    # tsc --noEmit, strict, over web/ and test/
```

## Security

**Your API keys are stored in plaintext in the browser's `localStorage`** on
the device you configure — this is a bring-your-own-key app with no server and
no proxy, so the keys have nowhere else to live. Anything with access to that
browser profile can read them.

A hosted copy of this page carries the trust problem inherent to every BYOK web
app: you type your keys into a page someone else serves, and whoever serves it
could ship a version that sends them somewhere. That cannot be fixed
technically. The mitigation is that this project is open source and deploys as
a folder of static files — read the code, then serve it yourself (`npx wrangler
pages deploy web`, or any static host) and use your own copy.

## Deploy to Cloudflare Pages

Direct upload:

```bash
npx wrangler pages project create bot-reborn   # first time only
npx wrangler pages deploy web
```

Git integration (dashboard): leave the build command empty and set the
**build output directory** to `web`.

## Browser support

WebUSB is available in Chromium-based browsers (Chrome, Edge, Opera) only.
Firefox and Safari do not implement it.
