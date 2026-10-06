# Development

Everything a contributor needs that a builder does not. The project overview,
and how to build one, are in the [README](../README.md).

The design spec is a private working document and is not in this repo, so the
`§` references in the code and in `docs/hardware.md` point at something you
cannot open. `docs/hardware.md` is the published record: everything in it was
measured on the actual hardware.

## Reading the code

About 6100 lines of product code, 3800 of instruments and 6300 of tests. Read it in this
order — it follows the safety argument the design is built around, not the
order the data flows.

**Start with the test names, not the code.** `npm test` prints all 478 of them
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
5. **`reflex.js` + `ladder.js`** — the shortcut in front of the LLM. Every way
   the judge can fail ends in "ask the LLM as usual"; the ladder is a table, not
   a model, so the same bark gets the same answer every time.
6. **`app.js`** — how it is all wired together. Every decision in it was made
   somewhere else.

`dev.html`, `dev.js` and `panels/` are instruments rather than product; read
`docs/instruments.md` before changing them, and skip them until you need them.

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

Then open the printed URL in Chrome or Edge. `index.html` is the robot, and
its setup sheet takes the provider keys; `dev.html` is the instrument page —
the hardware bench, connectivity tests in your own voice, and the typed driver
that runs the whole chain without a microphone.

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
