# Fixed audio for the connectivity test

`setup.html`'s STT test wants three 16 kHz mono WAV files of 2–4 seconds each,
in this directory:

| File | Contents | What it tests |
|---|---|---|
| `zh.wav` | 「往前开两秒然后左转」 | a short Chinese command |
| `en.wav` | "keep going forward until I say stop" | a long English sentence |
| `mixed.wav` | 「这个 sentence 里的 transition word 用得对吗」 | **code-switching mid-sentence** |

The third one is the point. Per §9.3, any old Chinese sentence will pass the
test while leaving code-switching entirely unverified — and code-switching is
the most common shape of input in the language-learning case this project is
partly for.

Recording: record on the phone, then
`ffmpeg -i in.m4a -ar 16000 -ac 1 -c:a pcm_s16le zh.wav`

These three `.wav` files stay out of the repo (see `web/fixtures/*.wav` in
`.gitignore`) — they are your own accent, and somebody else's samples cannot
find your problem. `setup.html` fetches them by relative path
(`fixtures/zh.wav` and so on); when one is missing, the STT test shows this
file in its result instead of quietly skipping that clip.
