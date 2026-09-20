# Fixed audio for the connectivity test

`setup.html`'s STT test reads three clips of 2–4 seconds each:

| File | Contents | What it tests |
|---|---|---|
| `zh.wav` | 「往前开两秒然后左转」 | a short Chinese command |
| `en.wav` | "keep going forward until I say stop" | a long English sentence |
| `mixed.wav` | 「这个 sentence 里的 transition word 用得对吗」 | **code-switching mid-sentence** |

The third one is the point. Per §9.3, any old Chinese sentence will pass the
test while leaving code-switching entirely unverified — and code-switching is
the most common shape of input in the language-learning case this project is
partly for. The sentences themselves live in `STT_FIXTURES` in `setup.js`;
this table follows it.

## The two clips that do ship

The setup sheet asks a narrower question than this page does — **is this layer
reachable at all**: right baseURL, right model name, working key. That question
does not need your accent, and making somebody record before they can find out
whether their key works puts a microphone in front of the very first thing they
do.

| File | Contents | Used when |
|---|---|---|
| `check-mixed.wav` | 「这个 sentence 里的 transition word 用得对吗」 | the UI is in Chinese |
| `check-en.wav` | "keep going forward until I say stop" | the UI is in English |

**Two, not one, and that is not politeness.** §9.3's "test the hardest case" is
a statement about the input this product actually gets, not a difficulty
setting. For a Chinese user the hardest case is code-switching mid-sentence.
For somebody who will only ever speak English to their robot, the same clip
tests a capability they do not need and can fail a provider that serves them
perfectly well — a false negative, which is worse than no check at all, because
it sends them away from a setup that worked.

They are **synthesised, not recorded**: nobody's voice, and every clone hears
the same take. Regenerate them with

    say -v Tingting -r 170 -o mixed.aiff '这个 sentence 里的 transition word 用得对吗'
    say -v Samantha -r 170 -o en.aiff 'keep going forward until I say stop'
    ffmpeg -i mixed.aiff -ar 16000 -ac 1 -c:a pcm_s16le check-mixed.wav
    ffmpeg -i en.aiff   -ar 16000 -ac 1 -c:a pcm_s16le check-en.wav

**They can only answer "is the layer reachable".** Synthetic speech is easier
to recognise than a person in a room, so a pass proves the wiring and nothing
about accuracy. "Does it understand *me*" is what the three recorded clips
below are for, and they stay out of the repo.

## Recording them

**In the Fixtures section of `setup.html`.** It records straight to 16 kHz
mono, plays the clip back so you can hear whether the sentence survived, and
keeps the result in the browser's Cache API under the same path the test
fetches (`fixtures/zh.wav`). That is the only route that exists on a phone,
where there is no repo to put a file into.

They are kept per browser and per origin, and the cache is best-effort storage
the browser may evict (spec §9.2). Losing them costs a re-record, and the STT
test says so rather than passing on two clips out of three.

## Putting a file here instead

A `.wav` in this directory is used when there is no recording, so the route
still works:

    ffmpeg -i in.m4a -ar 16000 -ac 1 -c:a pcm_s16le zh.wav

It is worth it for one thing the browser recordings cannot do: **a fixed
baseline**. Comparing two STT providers is only meaningful while both heard
the same take, and a file on disk cannot be re-recorded by accident.

These `.wav` files stay out of the repo (see `web/fixtures/*.wav` in
`.gitignore`) — they are your own accent, and somebody else's samples cannot
find your problem.
