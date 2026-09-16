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
