# 连通性测试用的固定音频

`setup.html` 的 STT 测试要三段 16 kHz 单声道 WAV，各 2–4 秒，放在这个目录下：

| 文件 | 内容 | 测什么 |
|---|---|---|
| `zh.wav` | 「往前开两秒然后左转」 | 中文短指令 |
| `en.wav` | "keep going forward until I say stop" | 英文长句 |
| `mixed.wav` | 「这个 sentence 里的 transition word 用得对吗」 | **句中 code-switching** |

第三段是重点。§9.3：随便一句中文都能让测试通过，而 code-switching 的能力
完全没被验证 —— 而它正是学语言场景下最常见的输入形态。

录制：手机录音 → `ffmpeg -i in.m4a -ar 16000 -ac 1 -c:a pcm_s16le zh.wav`

这三个 `.wav` 不进仓库（见 `.gitignore` 里的 `web/fixtures/*.wav`）——它们是
各人的口音，别人的样本测不出你的问题。`setup.html` 会用相对路径
`fixtures/zh.wav` 等去 fetch 这三个文件；哪个文件不在，STT 测试就会在结果里
显示这份说明，而不是悄悄跳过那一段。
