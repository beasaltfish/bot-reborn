# Hardware notes

Source of truth for the pin model: spec §3.1–§3.2. The spec is a private
working document and is not published, so the `§` references throughout this
file point at something you cannot open — they are kept because they are how
the two documents are held in sync. If this file and the spec ever disagree,
the spec wins and this file is the bug.

## Device

| | |
|---|---|
| Chip | FT232H |
| USB vendor ID | `0x0403` |
| USB product ID | `0x6014` |
| Mode | async bitbang (`SIO_SET_BITMODE`, mode `0x01`) |
| Output pins | `D4`–`D7` (pin mask `0xF0`) |
| Bulk OUT endpoint | discovered at open time (first bulk OUT on the interface) |

Two driver chips, not one: **U3** drives the wheels, **U5** swings the steering
coil. That is why there are four output pins and not two.

| bit | pin | goes to | meaning |
|---|---|---|---|
| bit4 | `D4` | U3 input A | drive |
| bit5 | `D5` | U3 input B | drive |
| bit6 | `D6` | U5 input A | steer |
| bit7 | `D7` | U5 input B | steer |

## ⚠️ Before you solder D6/D7

> **D6/D7 must go to U5's *input* pins, never straight to the coil — driving
> the coil directly will destroy the FT232H pins.** To find the inputs on the
> SOT-23-6 package, rule out VCC, GND, L1+ and L1−; the remaining two are the
> inputs.

(同一句中文，因为这是站在烙铁前要看的一句：**D6/D7 必须焊到 U5 的输入脚，
不能直接接线圈——会烧 FT232H 引脚。** 找输入脚：SOT-23-6 六个脚里排除 VCC、
GND、L1+、L1-，剩下两个。)

## Wiring

```
FT232H D4 ──► U3 input A     (drive)
FT232H D5 ──► U3 input B     (drive)
FT232H D6 ──► U5 input A     (steer)   ← input pin, never the coil
FT232H D7 ──► U5 input B     (steer)   ← input pin, never the coil
FT232H GND ─► board GND
```

## Action bytes (spec §3.2)

```
drive   forward  = 0x10      backward = 0x20      stop   = 0x00
steer   side A   = 0x40      side B   = 0x80      centre = 0x00
```

A combined action is the bitwise OR: `forward + side A = 0x50`. Everything off
is `0x00`, which is the stop byte the executor appends to every buffer
(spec §4.2).

Steering is a polarised electromagnet that swings the axle; a spring recentres
it when the coil is de-energised. There is no "turn in place" — `drive` has no
`none` value (spec §3.3).

Never raise both bits of the *same* driver at once (`D4`+`D5`, or `D6`+`D7`):
on an H-bridge that is a shoot-through. `pinsFor()` cannot produce it — one
drive bit and one steer bit, never two of either.

## Calibration results (spec §12)

These are measurements, not decisions. Fill them in from the bench page
(`web/bench.html`) and update the constants they feed. **Blank = not measured
yet**; do not treat a blank row as "fine".

| # | What | Measured | Feeds |
|---|---|---|---|
| ① | Which steer byte is left: `0x40` or `0x80` | | `STEER_BITS` in `web/executor.js` |
| ② | Bitbang byte rate at 1200 baud (target 2–5 ms/byte), and the car's speed in m/s | | `DEFAULT_BYTES_PER_MS` in `web/ftdi.js`; cross-checks `MAX_COAST_MS ≈ 1.5 m` |
| ③ | Pull-down resistors on U3/U5 inputs? (power off, measure input-to-GND: tens of kΩ = yes, open = no) | | Spec §4.7's gap. No pull-downs → solder 2 × 10 kΩ to GND, or layer 0 does not hold when USB is unplugged |
| ④ | Board VCC and U3 logic threshold (5 V logic needs ≥ 0.7 × VCC = 3.5 V; the FT232H drives 3.3 V) | | Whether a level shifter is needed at all |
| ⑧ | Shortest pulse that reliably starts the motor (from 100 ms, +50 ms, 10 tries each) | | `MIN_DURATION_MS` in `web/executor.js` |

## USB driver

WebUSB can only claim an interface that is not already claimed by a kernel
driver.

- **Windows** — the FTDI VCP/D2XX driver binds the device by default, so
  `claimInterface()` fails with a security error. Replace the driver with
  **WinUSB** using [Zadig](https://zadig.akeo.ie/).
- **Linux** — unbind `ftdi_sio`, or add a udev rule granting your user access
  to `0403:6014`.
- **macOS** — usually works without changes; if not, unload the Apple FTDI
  driver.

## ⑤ sherpa-onnx KWS assets (measured 2026-09-12)

Spec §11.2 names `sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20`. It exists and
the tarball below is the real URL — but **the WASM half of it is not published
in any form**, which is the finding that matters (see "Blocker" below).

### Model

| File | Size |
|---|---|
| `sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20.tar.bz2` | 32.89 MB |

<https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20.tar.bz2>

The tarball carries two chunk sizes (`chunk-16-left-64`, `chunk-8-left-64`),
fp32 and int8 encoders/joiners, 9 test wavs and a 3.33 MB English G2P lexicon
(`en.phone`). Only four files are needed at run time:

| File (`chunk-16-left-64`) | fp32 | int8 |
|---|---|---|
| `encoder-epoch-13-avg-2-chunk-16-left-64[.int8].onnx` | 11.98 MB | 4.60 MB |
| `decoder-epoch-13-avg-2-chunk-16-left-64.onnx` | 0.76 MB | — (no int8 build) |
| `joiner-epoch-13-avg-2-chunk-16-left-64[.int8].onnx` | 0.34 MB | 0.09 MB |
| `tokens.txt` | 1.9 KB | 1.9 KB |
| **Total** | **13.08 MB** | **5.45 MB** |

`en.phone` is a build-time tool, not a run-time asset: it converts English words
to phonemes. Our wake word is fixed, so we spell it once and ship the phonemes.

### The token set confirms spec §5.5

`tokens.txt` is 263 lines of **CMU ARPAbet phonemes (English) + toned pinyin
initials/finals (Chinese)** — not BPE. Keywords are supplied at run time as
token sequences, one per line, `<tokens> @<label>`:

```
L AY1 T AH1 P @LIGHT_UP
x iǎo ài t óng x ué @小爱同学
```

So §5.5's dual-spelling redundancy is expressible exactly as argued: the same
wake word gets an English-phoneme line and a pinyin line, both mapping to one
label. Note the plan's placeholder keyword `▁ste ven` is BPE syntax from the
older gigaspeech model and does not apply here.

`createKws(Module, myConfig)` takes a full config override, so model filenames
(hence int8 vs fp32), `keywords`, `keywordsThreshold` (default 0.25) and
`keywordsScore` (default 1.0) are all set from JS. Nothing is frozen at build
time except the files baked into the bundle.

### No prebuilt WASM exists — we build it ourselves

Checked the last 30 releases (v1.12.27 -> v1.13.8). Prebuilt
`sherpa-onnx-wasm-simd-*` tarballs ship for ASR, VAD, TEN-VAD, TTS, speech
enhancement and speaker diarization. **None for KWS, in any release.** The
docs' WebAssembly section has no KWS page, and none of k2-fsa's 17 Hugging Face
Spaces is a KWS demo. `build-wasm-simd-kws.sh` is the only route.

Built 2026-09-13. The recipe, so it is reproducible:

```bash
git clone https://github.com/emscripten-core/emsdk.git   # ~/Projects/my/emsdk
cd emsdk && ./emsdk install 4.0.23 && ./emsdk activate 4.0.23
# 4.0.23 is what build-wasm-simd-kws.sh says it needs; other versions may fail.

git clone https://github.com/k2-fsa/sherpa-onnx.git      # ~/Projects/my/sherpa-onnx
cd sherpa-onnx/wasm/kws/assets
# assets/ is baked into the binary wholesale, so put in exactly four files:
cp $MODEL/encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx ./
cp $MODEL/decoder-epoch-13-avg-2-chunk-16-left-64.onnx      ./
cp $MODEL/joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx  ./
cp $MODEL/tokens.txt ./

# wasm/kws/CMakeLists.txt hard-codes the OLD model's name in an existence
# check. Ours is epoch-13, so patch it or the build aborts:
sed -i '' 's/decoder-epoch-12-/decoder-epoch-13-/' ../../../wasm/kws/CMakeLists.txt

cd ../../.. && source ../emsdk/emsdk_env.sh && ./build-wasm-simd-kws.sh
```

Takes a few minutes, not the hour you might expect: onnxruntime is downloaded
prebuilt (`cmake/onnxruntime-wasm-simd.cmake`), and the KWS build switches off
TTS, websocket, portaudio and the Python bindings.

### Build output, measured

`build-wasm-simd-kws/install/bin/wasm/`:

| File | Raw | gzip | brotli |
|---|---|---|---|
| `sherpa-onnx-wasm-kws-main.wasm` (engine) | 12.75 MB | 3.45 MB | 2.21 MB |
| `sherpa-onnx-wasm-kws-main.data` (model) | 5.45 MB | 4.12 MB | 3.79 MB |
| `sherpa-onnx-wasm-kws-main.js` + `sherpa-onnx-kws.js` (glue) | 0.09 MB | 0.02 MB | 0.02 MB |
| **Total** | **18.29 MB** | **7.59 MB** | **6.02 MB** |

Pages serves brotli, so **first load is ~6 MB**. Spec §9.1's "tens of MB" does
not hold; whether a progress bar is worth building can be reconsidered.

Note the engine compresses 5.8x and the model only 1.4x — int8 weights are
near-random, so there is nothing left to squeeze. Any future size work should
target the wasm, not the model.

`app.js` and `index.html` also land in that directory. They are the upstream
demo and get replaced by our own page.

### Trap: `createKws()`'s defaults point at the old model

`sherpa-onnx-kws.js` ships defaults naming `encoder-epoch-12-...onnx` (fp32).
Our `.data` contains `epoch-13` int8 files and nothing else, so calling
`createKws(Module)` with no second argument fails to load. Always pass an
explicit config:

```js
createKws(Module, {
  featConfig: { samplingRate: 16000, featureDim: 80 },
  modelConfig: {
    transducer: {
      encoder: './encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx',
      decoder: './decoder-epoch-13-avg-2-chunk-16-left-64.onnx',
      joiner:  './joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx',
    },
    tokens: './tokens.txt',
    provider: 'cpu', numThreads: 1, debug: 1,
  },
  maxActivePaths: 4, numTrailingBlanks: 1,
  keywordsScore: 1.0, keywordsThreshold: 0.25,
  keywords: '...',
})
```

`debug: 1` makes the engine print `decode_chunk_len` and `T` at load time —
that is where the chunk-16 figure turns into an actual millisecond number.

### Keyword lines: the syntax, and the failure that kills the module

`EncodeBase()` in `sherpa-onnx/csrc/utils.cc` parses each line token by token.
Anything not in `tokens.txt` is read as a flag by its first character:

| Prefix | Meaning |
|---|---|
| `:` | boost score for this keyword alone |
| `#` | triggering threshold for this keyword alone |
| `@` | the label reported back in the result |

So spec §5.5's asymmetry — a conservative wake word next to an aggressive stop
word — is one file, no second spotter:

```
HH EY1 S T IY1 V AH0 N @hey_steven
h ēi s ī t í w én @hey_steven_zh
AO1 L S T AA1 P #0.15 @all_stop
ào s ī t ā p ǔ #0.15 @all_stop_zh
```

All four lines validate against this model's `tokens.txt` (checked token by
token). The pinyin line for the wake word is §5.5's dual spelling; the pinyin
line for `all stop` is the same idea applied to a Chinese speaker's rendering.

**Anything else on the line is fatal, not ignored.** An unknown token makes
`EncodeKeywords()` return false, and `InitKeywords()` answers that with
`SHERPA_ONNX_EXIT(-1)` — in wasm that aborts the whole module, and the page has
to be reloaded before it can try again. This corrects an earlier guess that a
wrong spelling would fail silently: it fails loudly and takes the runtime with
it. Since the wake word is still being chosen by typing into a box, the box has
to be validated in JS against `tokens.txt` *before* `createKws()` sees it —
which is why `tokens.txt` is copied into `web/models/kws/` alongside the four
runtime files even though the `.data` already contains it.

`modelingUnit` does not enter into this. `EncodeKeywords()` takes only the
symbol table; the upstream default `'cjkchar'` is irrelevant to keyword lines.

### Chunk size and a desktop baseline (2026-09-13)

With `debug: 1` the engine prints, at load:

```
decode_chunk_len=32   T=45
```

Feature frames are 10 ms, so **the encoder runs once per 320 ms of audio** and
needs 45 frames of context to do it. Cost is therefore lumpy: feeding 100 ms
frames, roughly every third one pays for an encoder pass and the others are
nearly free. Only the average over many frames means anything.

Measured in Chrome on the dev Mac (int8, `numThreads: 1`, `provider: 'cpu'`,
100 ms frames of silence, after warm-up):

| | |
|---|---|
| Average per 100 ms frame | **19.9 ms** (≈ 20% of one core) |
| Worst single frame | 99 ms (the encoder pass, plus first-touch) |
| First load, uncompressed | 17.45 MiB in 1.8 s |

**This is the laptop, not the phone** — it is only here as the comparison point
for the phone numbers below. A phone core doing worse than 3x this would put
the frame cost over the frame length.

### Adding VAD to the same binary (2026-09-13)

The KWS and VAD C APIs live in the same `sherpa-onnx-c-api` static library, so
a second engine does **not** mean a second 12 MB wasm. The VAD symbols were
simply being dropped by the linker as unreferenced. Listing them in
`wasm/kws/CMakeLists.txt`'s `exported_functions` (copy the VAD block from
`wasm/vad-asr/CMakeLists.txt`) and dropping `silero_vad.onnx` into
`wasm/kws/assets/` is the entire change — no new subdirectory, no new build
script, no new CMake option. Rebuild with the same `./build-wasm-simd-kws.sh`.

```bash
cd wasm/kws/assets
curl -LO https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx
# sha256 9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6
```

| File | KWS only | + VAD | Delta |
|---|---|---|---|
| `...-main.data` | 5,449,826 | 6,093,680 | +643,854 (the model) |
| `...-main.wasm` | 12,750,066 | 12,793,140 | **+43,074** (engine code) |
| `...-main.js` | 81,810 | 84,617 | +2,807 |
| **Total** | **18,281,702** | **18,971,437** | **+689,735** |

43 KB of engine for a whole VAD is the evidence that the code was already
linked in. **Budget ~0.7 MB for VAD, not 12 MB.**

Two things the JS side has to know:

- `vad.acceptWaveform()` wants **exactly `windowSize` (512) samples** per call.
  Frames of 1600 do not divide evenly, so something must hold the remainder.
  Sherpa ships a `CircularBuffer` for this, but it is a top-level `class` in a
  classic script — it lands in the global lexical environment and never on
  `window`, so a module script cannot see it. A plain `Float32Array` leftover
  buffer is simpler and avoids the trap entirely.
- `vad.front()` returns the **whole speech segment including its beginning**,
  because the detector buffers internally (`bufferSizeInSeconds: 30`). Spec §5.4
  was rewritten on 2026-09-15 to depend on this and the separate 500 ms pre-roll
  ring buffer was dropped — but this still comes from the docs and from silence
  runs, not from real speech. Confirming it (and picking the buffer size) is
  calibration item ⑯.

Dev-Mac cost, both engines in one module, 100 ms frames of silence:

| | per 100 ms frame |
|---|---|
| KWS | 22.3 ms |
| VAD | 4.0 ms |
| **Total** | **26.3 ms** |

VAD is ~18% of KWS's cost. Scaling from the phone's measured 8.55 ms for KWS,
the pair should land near **10 ms per frame — about 10% of one core.** To be
confirmed by `web/spike/audio/`.

### Two knobs left for later

- `-s INITIAL_MEMORY=512MB` is the stock link flag in `wasm/kws/CMakeLists.txt`.
  `ALLOW_MEMORY_GROWTH` is already on, so a much smaller initial value is worth
  trying once we have a baseline to compare against.
- The chunk size is an encoder-only choice. `decoder-*-chunk-16-*` and
  `decoder-*-chunk-8-*` are **byte-identical**, and so are the two joiners
  (verified by sha256) — the decoder never sees the time axis. Trying chunk-8
  means swapping one file and rebuilding.

### The phone run, first pass (2026-09-13, 8 min 46 s)

> **The freeze half of this run is void — see "The freeze result was an
> artifact" below. The CPU, download and keyword findings stand.**

Page: `web/spike/kws/index.html` (a probe, not product code; kept in the repo
and deployed with the rest of `web/`). It holds the mic open under spec §5.1's exact constraints, feeds
100 ms frames to a resident spotter, takes a screen Wake Lock and re-takes it on
every `visibilitychange`, and writes its counters to `localStorage` every 2 s so
they survive the tab being killed.

It separates three clocks, which is the only way to tell a freeze from a stall:

| Clock | Stops when |
|---|---|
| wall (`Date.now`) | never |
| audio (`AudioContext.currentTime`) | the audio graph itself is suspended |
| fed (frames × 100 ms) | KWS stopped being driven |

A frozen main thread does not lose frames — they queue on the worklet port and
land in a burst — so the page also reports the worst backlog and counts delivery
gaps over 2 s.

**It works.** Eight detections, both keywords, no false positives in the run:

```
{"wall":525.894,"audio":525.88,"fed":525.8,"avg":8.55,"max":66.8,
 "frameMs":100,"hits":8,"slow":0,"maxLag":0.024,"gaps":0,"battDrop":2.0}
```

| Metric | Value | Reading |
|---|---|---|
| Download, first load | **8.18 MB** | see below — not the 6.02 MB predicted |
| Per-frame cost / frame length | **8.55 ms / 100 ms = 8.6%** | worst single frame 66.8 ms, still inside the frame; `slow` = 0 |
| Battery | 2% over 8.8 min | **contaminated, see below** |
| Still running | wall − fed = **0.09 s** over 8.8 min | no drift, no gaps, worst backlog 24 ms |

**The CPU number passes with room to spare.** 8.6% of one core leaves the
budget for VAD, capture, STT and TTS that §5.3 needs, and it is *better* than
the dev Mac's 19.9% — the laptop figure was measured by looping frames
back-to-back with no idle, so treat it as a stress number, not a comparison.

**The freeze result is encouraging but not yet the answer.** The phone was
screen-off for 5 min 32 s of the 8 min 46 s, in stretches up to 2 min 26 s, and
the audio clock never fell behind the wall clock. Wake Lock behaved exactly as
§5.7 assumes: released on `hidden`, re-acquired on `visible`, every time. But
Android's aggressive freezing is a function of *how long* a tab stays
backgrounded, and 2.5 minutes does not probe it. **The 30 minute run still has
to happen, and it has to be 30 uninterrupted minutes.**

**The battery number is not usable.** The screen was on for 37% of the run, and
on a phone the screen usually outdraws everything else — 2% over 8.8 min
(≈ 14%/h if extrapolated) mostly measures the display. Needs a clean run.

#### Why the download is 8.18 MB and not 6.02 MB

The offline brotli figures above were `brotli -q11`. Cloudflare does not
reproduce them:

| File | Offline brotli | What Pages actually sends |
|---|---|---|
| `...-main.wasm` | 2.21 MB | 3.10 MB (`content-encoding: br`, lower quality on the fly) |
| `...-main.data` | 3.79 MB | **5.45 MB — no `content-encoding` at all** |

The `.data` file is served uncompressed because its type is not in Cloudflare's
compressible set. Fixing that would recover at most 1.7 MB (§ above: int8
weights barely compress), so **~8 MB is close to the floor** for this model.
Still nowhere near spec §9.1's "tens of MB", so the conclusion there is
unchanged: a progress bar is optional, not required.

#### §5.5's dual spelling: the pinyin lines never fired

All eight hits came from the ARPAbet lines — `hey_steven` ×5, `all_stop` ×3.
`hey_steven_zh` and `all_stop_zh` never matched, and never produced a false
positive either.

So for this speaker the English spelling alone is sufficient, and §5.5's worry
that a Mandarin rendering of the `/st/` cluster would fall outside the model's
English distribution did not materialise. That is **not** a reason to delete the
pinyin lines: they cost one line each in the same spotter, they have shown no
false-trigger tendency, and they are insurance for a different speaker or a
sloppier day. Recorded as: waiting item ⑦ answered for the primary speaker,
dual spelling retained as cheap redundancy.

#### Still to measure

A single uninterrupted 30 minute run, phone off the charger, screen locked, not
touched, **with a keep-alive running** (see below) — without one the tab is
dead after a minute and the run measures nothing. The number that comes out is
battery drain per hour.

---

## The freeze result was an artifact (2026-09-14)

**Retracted:** "the audio clock never fell behind the wall clock … Wake Lock
behaved exactly as §5.7 assumes". That run had an active wireless adb session
to the laptop, which is what kept the phone from sleeping. It was there because
deployment was blocked that evening and `adb reverse` was the way round it — the
workaround changed the thing being measured.

With no adb session and the page served from Pages, the real behaviour shows up
immediately, on both spike pages, three times:

| Run | Page | Fed / wall | Audio stopped after |
|---|---|---|---|
| 2026-09-13 | kws, **adb connected** | 525.8 / 525.9 s | never (5 min 32 s hidden) |
| 2026-09-14 | audio, no adb | 549 / 823 s | ~59 s hidden |
| 2026-09-14 | audio, no adb | 90 / 438 s | ~60 s hidden |
| 2026-09-14 | kws, no adb | 65 / 400 s | ~65 s hidden |

**About 60 seconds after the page goes hidden, listening stops.** Battery saver
was off for all of these, and moving Chrome to "unrestricted" in the battery
settings changed nothing — this is Android's normal behaviour, not a setting.

**The rule for any future measurement of background behaviour: no adb, no cable, no
charger.** Anything that keeps a debug session open keeps the phone awake and
invalidates the run.

### Which clock stops tells you the failure mode

The third clock on the kws page earns its keep here. In the 65 s run the audio
clock and the fed clock **stopped together**:

| wall | audio | fed | Meaning |
|---|---|---|---|
| runs | runs | stops | main thread frozen; frames queue and land in a burst |
| runs | **stops** | **stops** | **the capture pipeline itself was shut down** |

The second row is what happens. This is not Chrome freezing a tab, it is
Android not giving the microphone to an app that is not in the foreground. The
distinction matters because it rules out anything that only wakes the main
thread, and it points at the one lever that does work.

### The keep-alive: a tab that is playing audio keeps its microphone

A tab producing audio makes Chrome hold a media session, which is enough
foreground standing to keep the mic. Measured 2026-09-14 on the kws page with a
keep-alive sound playing: **all three clocks full over a 5 minute screen-off
run.** Screen-off listening is recoverable.

The spike plays two things at once, because the first run asked "is this
possible at all", not "which half did it":

- an `<audio>` element on a loop with `MediaSession` metadata — Chrome hangs
  its media notification on this, and it does not live on the capture
  `AudioContext`, so it survives that context being suspended;
- an oscillator on the capture context itself.

Level and shape have to clear Chrome's silence threshold (about −60 dBFS) or
the tab stops counting as audible. −40 dBFS is the working value.

### What it sounds like, and what was chosen

Held to the ear, the phone hisses. Dropping the level from −40 to −58 dBFS —
an 8× cut — did not make it quieter, which means **what is audible is almost
certainly not the signal**: playing anything powers up the phone's amplifier,
and an idle amplifier hisses on its own. If so, no waveform removes it; it is
the physical cost of keeping the mic.

Two ten-second tests would confirm it and have **not** been run yet (they need
a quiet room and a fresh ear): does the hiss survive *stopping* playback, and
is the breath shape's 4 s swell audible at −40 dBFS at all.

Chosen anyway, because both answers point the same way:

- **Shape: the breath** — 220 Hz, amplitude swelling on a 4 s cycle, trough at
  30% so it never dips under the silence threshold. 220 Hz is inside what a
  phone speaker can actually reproduce, unlike the 60 Hz first version, which
  comes out as distortion instead of as a tone. And if it is ever audible it
  reads as "the thing is alive" rather than as a fault — the design goal is not
  to hide the sound but to make it unmistakably intentional.
- **Only while hidden** — silent whenever the screen is on and the phone might
  be in someone's hand; the sound starts on `visibilitychange` and stops on the
  way back. A car driving across the floor with its screen off is never next to
  an ear.

Both are now the spike's defaults.

#### Open on the keep-alive

1. **Re-verify with "only while hidden".** The passing 5 minute run played the
   sound from the start. Starting playback *after* the page is already hidden is
   a different thing to ask of the autoplay policy, and it has not been tested.
   The page logs a failure if `play()` is rejected.
2. **The noise floor it adds.** §7.3's floor window measured −75.5 dBFS with
   nothing playing. An amplifier that is now permanently on raises that, and the
   floor is what the wake word and the VAD have their margin against. The audio
   spike can now play the same sound (sound only — the probe runs screen-on and
   needs no keep-alive), so the measurement is: turn it on, run the probe, read
   row ①. There is a built-in verdict — the probe voids any run where the VAD
   fires during the floor window.
3. **Battery.** An amplifier that never sleeps costs something, and the 30
   minute run now has to be done with the keep-alive on anyway.

---

## The audio spike: barge-in, VAD and transcription (2026-09-14)

Page: `web/spike/audio/index.html` (a probe, kept). One `getUserMedia` feeding KWS
and VAD from the same wasm module, VAD segments going to STT, transcripts read
back by TTS. It was built to answer five questions; this run answered three.

### §7.3 barge-in: pass, on both halves, with margin

The probe runs to a script and buckets each window separately, because one
window cannot separate the robot's echo, the user's voice and the room. Only
the comparison between windows means anything.

| Window | What it is | Mean level |
|---|---|---|
| floor | no TTS, user silent | **−75.5 dBFS** |
| control | no TTS, user reads the line | −29.3 dBFS |
| warmup | TTS on, user silent, first 1.5 s (discarded) | −46.0 dBFS |
| quiet | TTS on, user silent | **−52.9 dBFS** |
| talk | TTS on, user reads the line | −24.0 dBFS |

Both halves pass, and both are needed:

- **It does not hear itself.** Zero VAD frames in the `quiet` window, against
  zero in `floor` — the guard that voids a run made in a noisy room.
- **The user still gets in.** +28.9 dB over `quiet` (threshold is 6), with 50
  VAD frames in `talk`.

The residue reads as "+22.6 dB over the floor", which sounds alarming and is
not: the room floor was −75.5 dBFS, exceptionally quiet, and −52.9 dBFS in
absolute terms is far below speech. **AEC is working** — this is §7.3's first
diagnostic row, not its fourth. Corroborating: `warmup` at −46.0 dBFS is
*louder* than `quiet`, which is AEC converging over the first second or so,
exactly as the probe assumed when it discarded that window.

`talk` at −24.0 dBFS is 5 dB above `control`: the user raised their voice over
the robot without being asked to. Even at the control volume the margin over
the residue is ~24 dB.

Also, in 27.6 s of its own speech the spotter never fired once (`selfKws` = 0).

**So: `ttsPath = 'webaudio'`, `bargeIn = true`, and §7.2's WebRTC loopback does
not need to be written.** Waiting item ⑥ is answered — for this phone, in this
room. The diagnostic table in §7.3 stays, since it is what will catch a device
where this is not true.

### Transcription survived the playback (⑩)

A level in dB says how much of the voice got through, not whether what got
through is still transcribable — AEC routinely leaves something that clears the
VAD threshold but lands in STT as word errors. So the same code-switched line
was read twice and both windows went to STT:

```
reference  往前走三米，然后 turn left，停在红色的箱子旁边
control    往前走三米,然后turn left,停在红色的箱子旁边。   CER 0%
over TTS   往前走三米,然后 Turn Left,停在红色的箱子旁边。  CER 0%
```

No degradation at all, on a phone mic in a live room, on the sentence ⑩ is
actually about. **Listening straight through the robot's own speech is viable;
there is no need to wait for TTS to stop.**

STT round-trip was 7.9 s and 6.5 s for 8 s windows — untouched by this
question, but a number the voice loop will have to answer for.

### VAD in the same binary: yes, and it is free

Both created from one wasm module, no conflict. **0.49 ms per 100 ms frame** —
next to nothing beside KWS.

### The CPU number from this run is not usable

KWS cost 19.03 ms/frame here against 8.55 ms/frame in the ⑤ run, same model,
same `provider`/`numThreads`/`maxActivePaths`. Not a configuration difference.
Either thermal throttling or an average poisoned by the frames around the
freeze; the run cannot tell. It still fits the budget either way (19.5% of one
core with VAD included), so nothing is threatened — but **the honest state of
"KWS + VAD together" is unmeasured**, and it needs a clean run with the
keep-alive on.

### One log line to ignore

`⚠️ the VAD cut a segment during playback (5.02 s) — the quiet window, so it
can only be itself` is a mislabel, not a contradiction. A VAD segment is only emitted 0.8 s after speech
ends, so the user's `talk` utterance is popped once the script has moved on to
`settle`, and the label is taken from the phase at pop time. The verdict itself
counts per-frame, per-window, and is unaffected.

### Still unanswered by this spike

**⑪, TTS code-switching.** The passage mixes `go forward`, `turn left` and a
count in both languages on purpose, and nothing on the page can score it. It
needs someone to listen and say whether the English inside the Chinese sounds
like speech or like assembly.

## What expires when the phone changes

Every figure in this file was measured on one phone, in one room, by one
person. Most of them are about that combination rather than about the code, so
swapping any part of it retires them. There is no way to tell from a number
whether it still holds; this table is the substitute.

Re-run all of these on `audio-bench.html`. The hardware items above them
(D6/D7 polarity, byte rate, the motor's starting threshold) expire on a change
of *car*, not of phone, and are measured on `bench.html`.

| Reading | Why it expires | Panel |
|---|---|---|
| KWS cost per frame | CPU, thermal ceiling, how the browser schedules the worklet | Residency |
| Battery drain | battery size and the OS's own power policy | Residency |
| Screen-off survival, and whether the keep-alive tone rescues it | android version and Chrome's autoplay policy, both of which have changed this behaviour before | Residency |
| The barge-in verdict (`bargeIn`, `ttsPath`) | the phone's echo canceller is the thing under test | Acoustics |
| Noise floor, with and without the keep-alive | the room, and the phone's own amplifier | Acoustics |
| Keyword miss rate and false triggers | the microphone, and the speaker's accent | Recognition |
| Whether `vad.front()` keeps the head of a sentence | the mic's onset response — and it decides whether §5.4's ring comes back | Recognition |
| Transcription quality without a locked `language` | the provider and its model version, which move without notice | Recognition |
| TTS on a code-switched line | same | Providers |
| How often a tool call's `content` is pure restatement | the LLM and its version | Providers |

What does **not** expire, because it is a fact about the code or the build
rather than about the device: that the VAD and KWS can share one wasm module
(the binary is vendored in `web/models/`), that keywords are spelled in ARPAbet
and toned pinyin rather than BPE, and that an unknown token aborts the module
via `SHERPA_ONNX_EXIT(-1)` instead of failing quietly.
