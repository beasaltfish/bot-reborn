# Roadmap

A person writes this table; machines only read it. One line per item, always the
same shape:

```
- [ ] **N.** title — state
  - done when: how we will know it is done (one or two checkable lines)
```

`state` is exactly one of `ready`, `blocked`, `done`. After `blocked`, say what it
waits for. `scripts/agent-loop.sh --item N` picks up `ready` items only.

- [ ] **1.** A3 hardware record — blocked: needs the board and the panel in hand
  - done when: `docs/hardware/msp2834-ili9341v.md` holds the real monitor lines and a photo,
    `ili9341-ips` and `firmware/main/screen_profile.c` both say verified, `firmware:test` is green

- [x] **2.** A4 setup card — done
  - done when: admin shows the five steps with their source, a phone body skips the board step,
    and the Chinese copy covers titles, notes and source labels

- [ ] **3.** A5 walkthrough — blocked: needs 2
  - done when: `docs/first-build-walkthrough.md` records one end-to-end build with real timings
    and every stop longer than two minutes explained
