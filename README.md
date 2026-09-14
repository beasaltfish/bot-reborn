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

v1 is still being implemented — the microphone half (wake word, VAD, session
state machine) is not here yet. What ships today is the hardware layer, the
executor, the three providers and the brain, driven from two bring-up pages.

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
    ├── index.html      # links to the two bring-up pages below
    ├── bench.html/.js  # calibration bench: polarity, byte rate, start threshold
    ├── setup.html/.js  # provider config, four connectivity tests, typed drive
    ├── ftdi.js         # FTDI protocol: bitmode, baud rate, byte streams, purgeTx
    ├── executor.js     # actions → byte buffers, renewal loop, generation preemption
    ├── brain.js        # tool definitions, system prompt, validator, one turn
    ├── strings.js      # UI copy and fixed spoken lines (en / zh)
    ├── providers/      # STT / LLM / TTS, all OpenAI-compatible endpoints
    ├── fixtures/       # your own STT test audio (not in git — see its README)
    ├── spike/          # bring-up probes: KWS cost, the audio path, barge-in
    └── style.css
```

## Local development

WebUSB requires a secure context, which includes `http://localhost`:

```bash
npx serve web        # or: python3 -m http.server -d web 8000
```

Then open the printed URL in Chrome or Edge, and start at `bench.html`
(hardware) or `setup.html` (providers and the full chain minus the microphone).

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
