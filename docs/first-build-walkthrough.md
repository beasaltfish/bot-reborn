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
