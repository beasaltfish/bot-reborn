# Roadmap

人写这张表，机器只读。每项一行，固定形状：

```
- [ ] **N.** 标题 — state
  - done when: 怎么算完成（一两句，能验证）
```

`state` 只能是 `ready`、`blocked`、`done` 之一；`blocked` 后面写清等什么。
`scripts/agent-loop.sh --item N` 只会取 `ready` 的项。

- [ ] **1.** A3 hardware record — blocked: needs the board and the panel in hand
  - done when: `docs/hardware/msp2834-ili9341v.md` holds the real monitor lines and a photo,
    `ili9341-ips` and `firmware/main/screen_profile.c` both say verified, `firmware:test` is green

- [ ] **2.** A4 setup card — ready
  - done when: admin shows the five steps with their source, a phone body skips the board step,
    and the Chinese copy covers titles, notes and source labels

- [ ] **3.** A5 walkthrough — blocked: needs 2
  - done when: `docs/first-build-walkthrough.md` records one end-to-end build with real timings
    and every stop longer than two minutes explained
