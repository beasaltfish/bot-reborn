# The instruments

Three pages in this repo are instruments rather than product. They exist to
measure **this phone, this room and this voice**, and their answers expire when
any of the three changes.

> The rule that put them here: **would this question become a problem again on a
> different phone?** Yes = an instrument, and the apparatus has to survive so the
> measurement can be repeated exactly. No = a probe, and the answer goes into a
> document while the code goes away.

Two documents, two jobs:

- **`docs/hardware.md`** — what actually happened, on one device, with one
  provider. Findings, transcripts, numbers.
- **This file** — how the apparatus works and why it is shaped that way. The
  pages themselves carry only what changes which button you press next.

Everything an instrument says out loud — the passage it reads, the line you read
back, the words you shout at it — comes from `web/instrument-material.js`, keyed
on the robot's language. That file is the only place in an instrument where
Chinese is allowed to appear; `test/instrument-language.test.js` enforces it in
both directions, including that the Chinese arm still *has* Chinese in it.

---

## Pin bench — `bench.html`

The bring-up panel for ① ② ⑧. It stands in for `web/app.js`, whose model (D4/D5,
one byte at a time) cannot express "write 3000 bytes and then start a
stopwatch": here `Ftdi.buildStream()` hands the whole buffer over in one go.

### Why there is an emergency stop at the top

② hands over 20 seconds of forward bytes in a single write. For those 20 seconds
JavaScript is doing nothing at all, so the only thing that can interrupt the car
is a button that purges the transmit buffer and pulls the pins low. Without it
the recourse is unplugging the cable.

It doubles as a live demonstration of §4.4's `purgeTx`: the car should stop at
once, not 20 seconds later.

### ① Polarity: is side A left or right?

Each button holds its pins high for 600 ms. Watch which way the wheels turn and
write the answer into `docs/hardware.md`.

**The in-app calibration asks a different question and both are kept.** The
robot's own "teach it left and right" (`web/calibrate.js`) runs an Executor
*without* calibration applied, because calibrating through the setting being
calibrated measures itself. The bench's six buttons are lower than that: they
address pins directly, with no Executor in the path at all, which is what you
want when the question is whether the solder joints are where you think.

### ② Byte rate and road speed

At 1200 baud, 3000 forward bytes plus one stop byte in a single write. Time the
motor with a stopwatch and measure how far the car travelled. The result is
`bytesPerMs`, which is re-calibrated whenever the hardware changes — which is
why this page is permanent rather than a throwaway demo.

### ⑧ The motor's starting threshold

Start at 100 ms and add 50 ms each round, ten tries each. The answer is the
smallest pulse that moves the car **every single time**, not the smallest pulse
that has ever moved it.

---

## Connectivity test — `setup.html`

**This is the instrument, not the way in.** Setting up three providers for the
first time happens in the robot itself now: a sheet with three keys in it and a
test beside each one.

What this page has that the sheet does not:

- **Fixtures in your own voice.** A pass here means the chain understands *you*,
  not merely that the key is valid. The sheet plays a clip that ships with the
  repo, so it can only answer "is this layer reachable at all" — right baseURL,
  right model name, working key — without putting a microphone in front of the
  very first thing somebody does.
- **The typed driver**, which reaches `brain.js` without a microphone: the whole
  v1 chain except for STT.
- **Every field editable at once**, which is what comparing one provider against
  another needs (⑪).

The two write the same config, so either can fix what the other set.

### Why the three clips have to be recorded, and listened back to

Somebody else's accent cannot find your problem. Say each line as written, then
**listen back before trusting it** — a clip where the sentence got cut off still
transcribes into something plausible, and the test will pass on it.

Which three they are depends on the language (`web/fixtures/README.md` has both
sets). In Chinese one of them mixes both languages inside a single sentence,
because that is the hardest input this robot actually receives. In English there
is no mixed clip: §9.3's "test the hardest case" is a claim about the input this
user produces, not a difficulty dial, and a mixed clip would fail a provider that
serves an English-only speaker perfectly well.

**The two arms are therefore not comparable.** Note which one a reading came
from.

---

## Audio bench — `audio-bench.html`

The permanent instrument for every audio-side calibration §12 still wants.
⑤ ⑥ ⑩ were each answered on one phone and every one of those answers expires
when the phone changes, so the apparatus stays. Every engine on the page is the
product's own module: the numbers are only worth taking back to `web/audio/` if
they were measured on the code that runs there.

> **Measuring anything about the background or the battery means no adb, no cable
> and no charger.** A live debug connection stops android from letting the phone
> sleep — that is how ⑤'s freeze result was contaminated.

### Why the two cross-cutting knobs are not a panel

The keep-alive tone and the motor noise are set **after** Start and stay on
across whichever panel is running. That is the point: the measurements that need
them are crossings. ⑬ ⑭ ⑮ are each "keep-alive × some reading", and ⑦ is
"KWS × motor noise". Splitting them into panels is what killed the old
`spike/audio` page, which ended up having to write on itself "this page only
plays the sound; it does not do the keeping-alive".

The keep-alive select ships at `off`, and that is deliberate. The product's
shipped behaviour is the middle option — play only while the screen is off — but
an instrument's default must not smuggle in a confounder: the tone raises the
noise floor by an amount nobody has measured yet, and defaulting it on would
contaminate ⑥'s floor reading before anybody touched anything.

### echoCancellation, and why it locks at Start

Changing it changes the `getUserMedia` constraints, which means a new
`AudioContext`, which means rebuilding the TTS and the earcons hanging off it.
So it locks while anything is running: stop, change it, start again. ⑥ is two
separate runs anyway.

### noiseSuppression, and why it was forbidden until 2026-09-17

The suppressor eats the consonant onsets the wake word is built from, and
`HH EY1 S T IY1 V AH0 N` is nearly all onset. It is on the page because AEC
turned out to hand the VAD spurious bursts in silence — −44 dB down to −96,
against −40 and up for real speech — and five minutes with AEC off produced
none. The suppressor is the stage built to absorb that residue.

The product default has not moved; this asks whether it should. The cost side is
⑦'s twenty shouts per keyword, and **it cannot be replayed from stored samples**:
a microphone constraint changes what gets recorded, so there is no identical
audio to A/B.

### The "flip it on the live track" button

The checkbox is read once, at Start. This button changes the same setting on the
track that is already running, and reports two things the plan for it depends on:
whether Chrome honours the request at all (`applyConstraints` is allowed to
resolve having done nothing), and how many 100 ms frames went missing while it
happened.

The second number is the one that matters. The state machine would flip this at
the SLEEPING → LISTENING edge, which is the instant the wake word fires, so a
hole there falls on the first syllable after the wake word — and §5.3 leaves the
VAD unsubscribed through SLEEPING, so there is no buffer behind it to soften the
loss. **gap 0** means the switch is free.

### Residency — ⑤ ⑫ ⑭ ⑮

One resident run, four readings.

**The three clocks are ⑫'s verdict.** The wall clock always runs. If the audio
clock and the fed count stop *together*, the capture path was closed — not the
main thread frozen. That is what ⑤'s three reproductions (59 / 60 / 65 s)
separated.

- **⑫**: set the keep-alive to `only while the screen is off`, run for 5 minutes
  with the screen off, and compare against `always`.
- **⑭**: `KWS + VAD` with the keep-alive on.
- **⑮**: the same run, 30 minutes, **no cable and no adb**.

### Acoustics — ⑥ ⑬

One window cannot separate three sources — the robot's echo that AEC missed,
your voice, and the room — so this runs to a script and the page says the lines.

Only the comparison between windows means anything: `quiet − floor` is the echo
residue, and `talk − quiet` is the only positive evidence that barge-in can work
here.

- **⑥**: run it once with echoCancellation on and once with it off. Changing it
  needs a stop/start.
- **⑬**: set the keep-alive to `always` and read row ①. The baseline without it
  is −75.5 dBFS.

The passage it reads is long on purpose: the probe needs ~23 s of continuous
speech to walk its five windows, and a passage that runs out mid-window aborts
the run.

### Recognition — ⑦ ⑩ ⑯

**⑯ is the one item here that can overturn product code.** §5.4 hands the
pre-roll to sherpa's own `CircularBuffer` on the strength of documentation and a
silent test. If `vad.front()` loses the head of a real sentence, the 500 ms
hand-rolled ring goes back in.

- **⑦**: turn the motor on, shout each keyword 20 times and count misses; then
  talk at it in ordinary conversation and count `all stop` false triggers.
- **⑩**: record the three sample classes and replay them.
- **⑯**: record once, then sweep `bufferSeconds` 30 → 15 → 10 → 5 over the same
  recordings, and finally record one clip longer than the buffer and see what
  comes out.

Say twenty short commands that **start with a consonant**, and check the first
character survives in the transcript. A command opening on a vowel cannot show a
lost onset, so it cannot fail the test it is for. At least five of them as the
**run-on form** — the wake word and the command in one breath — which presses on
two things at once: §5.5 not clearing the VAD, and §5.6's earcon gate, which is
why `wake` was squeezed to 80 ms.

#### The STT floor

Every segment carries its level, and nothing under the floor is sent to be
transcribed. It ships at −120, which refuses nothing, because the value that
belongs there is a measurement nobody has taken yet: run it open first and read
the dB figures off the log.

**Length cannot do this job.** In one run two real two-syllable commands came out
at 0.3 and 0.4 s while an empty room produced 0.4, 0.5, 0.6 — and 6.4, and 10.6.
The transcripts are in `docs/hardware.md`.

Skipped segments are still logged and still counted under **Segments cut**: the
floor decides who pays to look at one, not what the VAD did.

#### The `wiring` switch

**These two are not the same pipeline, and until 2026-09-17 only the first one
existed here.**

- `both` — both engines fed every frame, always. Every ⑯ reading taken before the
  switch existed was taken on this, and it cannot see the problem below at all.
- `product` — what `session.js` actually does. §5.3 leaves the VAD
  **unsubscribed through SLEEPING**, so on the product's wake path the detector
  never hears the keyword and picks up from whichever frame lands after the
  earcon window shuts. The run-on sentence said in one breath loses far more than
  the single frame the gate drops: it loses everything up to roughly 100 ms past
  the hit, and the first syllable of the command lives in there.

`product` imports `wantedSubscriptions` from `session.js` rather than
reimplementing it, registers the two subscriptions in the same order, and so
inherits the Map-iterator behaviour instead of simulating it. It returns to
SLEEPING after each utterance, because saying the sentence twenty times means
starting from SLEEPING twenty times.

#### The `wake earcon` switch

Run the run-on sentence at all three and the readings separate two different
causes of a lost head, which want opposite fixes.

- **none** — the VAD's own decision latency. If the head goes missing here, §5.4
  is wrong and the 500 ms ring comes back.
- **gated** — the shipped behaviour. What it costs is one whole frame: §5.6 gates
  for 80 ms, but the unsubscribe lands mid-fan-out, so the VAD misses the entire
  100 ms frame the keyword was found in — the one carrying the end of "steven"
  and the attack of the command.
- **ungated** — plays the tone and keeps feeding, which asks whether the gate was
  ever needed. §5.6 already argues a pure tone has no formants for the VAD to
  read as speech, and ⑥ measured the AEC removing the robot's own voice entirely.
  If nothing is lost here, the fix is to delete the gate — one line, and §5.4 is
  left alone.

#### Samples

Recorded into this browser under `calib/`, never into the repo. **One recording,
every sweep**: comparing `bufferSeconds` across twenty freshly-spoken sentences
would be comparing different inputs against different parameters.

### Providers — ⑨ ⑪

**⑨ — twenty turns, with what the model said in full.** Talk to it twenty times
and count how many replies are pure restatement carrying zero information. High
enough to be annoying and §6.3 goes back to discarding `content` — one `if`. The
log shows the transcript, the model's sentence and every dispatched action,
because with only `♪ done` there is nothing to count. It needs the FT232H
connected: the car is what the tool calls drive.

**⑪ — the same line, one provider at a time.** This is the item that can overturn
a *choice* rather than a constant: §8.3's default TTS. `setup.html`'s TTS test
only ever tries the one you have configured; ⑪ is the comparison. Nothing here is
saved — fill it in, listen, change it, listen again.

---

## How the pages are put together

Three rules, the same on all three pages.

**A card is a group, and its order is the navigation.** Header, then what you
do, then what came back — never reordered, in any of the eighteen cards. Looking
for a number you go to the bottom of a card; looking for a button you go to the
middle. `<hr>` used to do this job and all it could say was "the thing above
ended". `test/instrument-ui.test.js` holds the order.

**Red belongs to the emergency stop, and to nothing else.** `docs/ui.md` fixes
four meanings — red for the stop, green for ready or working, amber for your
turn, dim for not yet — and the instruments use the same four. The button that
must be found instantly stops being findable the moment it is one of several red
things. `bench.html` and `setup.html` each have a real stop; `audio-bench.html`
grows one **only while the car is moving**: the moment you start the motor, the
middle of the bottom bar becomes `■ STOP THE CAR` and the Start/Stop pair goes
away. Before that existed, `cruise()` renewed itself forever and the only way to
stop the car was to scroll back to the button that started it.

**The strip at the top says what is on.** Microphone, USB, keep-alive, motor,
which panel is running — every one of those facts was already known somewhere in
the code and none of it was ever shown in one place. It is also the only route
between these three pages; there was none before.

### What the pages keep, and what they hand here

A page says what to press. This file says why it is that.

`test/markup.test.js` holds the line: `audio-bench.html` under 400 words of
prose, `setup.html` under 220, `bench.html` under 140. Raising a number is a
decision, not a fix — the page is read by somebody standing in a quiet room
holding nothing but the phone.
