# First build, from nothing: the rehearsal record

This file records what **actually** happened: who walked it, how long it took,
where they stopped. It is not a tutorial — the README is. A5 will write one full
rehearsal here; until then there are the two runs below.

## 2026-11-19 · Install and the shopping list (A2 acceptance, walked by the author)

**Starting line**: a new directory, one `git clone`, no `node_modules`, no
`~/.bot-reborn`, no model files. Node 24.13.1 installed (environment, not part of
the flow, by agreement). Another brain was already holding port 8787 on this machine.

**The three commands**, plus one port variable (see below):

```bash
npm install
PORT=8899 npm run setup
PORT=8899 npm start
```

**Run 1 (before the fixes; a failure record)**: `npm run setup` fetched the 6 MB of
models and built the pages, then reported `port 8787 is already in use` and exited 1.
That is not the default path succeeding — it is a **failure-recovery** record: the
error was named, and the fix (`PORT=<another>`) was printed.

**Run 2 (after the fixes)**: same starting line. `npm run setup` exited 0 (node,
models, port and build all ok). After `npm start`:

- `http://localhost:8899/` → 200, the admin page
- `http://localhost:8899/sim/` → 200, the workbench opens
- no project selected, `Shopping list` in the top bar → the empty-bench list opens,
  so free wiring has an entry too
- Projects → Audio + screen → Shopping list → 9 lines, $33.00–83.00; the screen line
  says its settings are not marked verified; the print preview is one page and the
  last line is the USB-C cable

**Not verified**: the default path on 8787. Another brain has held that port the whole
time, so both runs used `PORT=8899`. Proving the default needs a machine with 8787
free — A5 on a different machine will cover it.

**Small annoyances, not fixed on the spot**:

- `npm run setup` also prints Vite's "chunk larger than 500 kB" warning, which reads
  like an error the first time.
- When a brain is already running here, the port check fails loudly even though the
  running one is fine.

## 2026-11-19 · Setup's failure path (A2 rehearsal)

Two runs, in a fresh clone, with the model files deliberately replaced by junk and
`curl` replaced by a script that exits 22 (so the download cannot rescue them):

```bash
PATH="$TMP/bin:$PATH" PORT=8899 npm run setup   # exit 1
```

```
The fetch script failed; its output is above.
fail  models: the model files in server/models/ look corrupt (a truncated or failed download)
      Run: sh server/models/fetch.sh
Fix the lines marked fail, then run npm run setup again.
```

Then the same clone with a working `curl`:

```bash
PORT=8899 npm run setup                          # exit 0
ok    models: wake-word and VAD models present
next: npm start
```

What this proved, and the one thing it changed: a corrupt model used to be
reported as **missing**, which sends a person looking for a file that is right
there. `setup.js` now separates `missing` from `corrupt`; the rehearsal above is
the before/after.

## A5: what this record still needs (protocol, written before the parts arrive)

The point of A5 is a record nobody can talk themselves out of afterwards. Set it up
before touching a screwdriver.

**Starting line**

- Parts arrived and unboxed; **not one wire connected**.
- A computer that has never run this repo: no `node_modules`, no `~/.bot-reborn`,
  no model files. Node installed is the one allowed head start.
- **No API keys anywhere.** Provider accounts may exist; keys are created during
  the run, so the cost of a wrong turn is visible.
- Only the repository URL.

**The clock**

Start it when the README is opened. Stop it when the robot answers a sentence in
its own voice with a face on the screen. Anything before opening the README
(unboxing, OS updates) is recorded separately, not in the number.

**At every stop longer than two minutes, write four lines**

1. What I was trying to do.
2. What the docs said to do.
3. What I expected to see, and what I saw instead.
4. What I did next.

Do not ask the author mid-run. Write the question down and keep going; the
question is data, the answer is not.

**Record alongside it**

- Every command, verbatim, in the order typed.
- A screenshot at each step that changed the screen — admin, board setup, the
  workbench, the first conversation.
- Which provider was chosen for each of the three layers, and whether its test
  button passed on the first try.
- Wall clock: minutes to a running brain, to a flashed board, to the first reply.

**The same session also closes A3's last task**

Before the walkthrough proper, with the board on USB:

- Flash `firmware/release/`; note the console lines in order: white, red, green,
  blue, then `screen: ready`. Note whether `screen: panel identifies as an
  ILI9341, as chosen` appears (no MISO means it will not).
- Photograph the lit panel; keep the file.
- Then the record lands in `docs/hardware/msp2834-ili9341v.md`, `ili9341-ips` is
  marked `verified: true`, `firmware/main/screen_profile.c` gets the same flag,
  and `npm run firmware:test` must stay green.

**Failure is a result**

If it does not finish, write what happened and where. Fix what it exposed, then
walk A5b: the same path again, fresh machine, no time limit. Only A5b passing
means the path works; a single observed failure is a lead, not a verdict.
