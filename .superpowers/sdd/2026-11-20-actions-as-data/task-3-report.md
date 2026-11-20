# Task 3 report — the five bodies become templates

**Status:** complete. Commit `77b1ef6` (base `858c26f`).
**Files:** `core/bodies.js` (rewritten), `test/bodies.test.js` (rewritten), plus
one line in `admin/src/BodyTab.tsx` (see Deviation 1 — unavoidable).

## What exists now

`core/bodies.js` exports:

- `TEMPLATES: Record<BodyId, Body>` — `none`, `pet`, `tarot`, `dry-run`, `toy`
  (admin order), plus `TEMPLATE_IDS`.
- `resolveBody(id, patch?)` — `patch` is `{ template?, label?, prompts?, actions? }`.
  A body with `actions` is the person's own; otherwise it follows `template ?? id`;
  an unknown id falls back to `none` and does not throw. Everything (label, ways,
  actions, prompts, triggers) is `structuredClone`d, so a resolved body never
  aliases a template (asserted by a test).
- `bodyProblem(body)` — one sentence or `null`; refusals below.
- `labelOf(body, lang)` — unchanged signature; label is now `{ en, zh }`.
- `bodyById(id)` — kept; `admin/src/setup.ts` imports it and no task deletes it.
- `CAPABILITIES` = `hear, speak, show, move` (`sense` gone); `BODY_FIRMWARE` kept.
- `SOURCES`, `NEEDS` are module-local now (nothing imported them); `ACTION_NEEDS`
  is gone.

### Temporary shims (all derived, marked in code)

| Export | Shape | Deleted in |
|---|---|---|
| `BODIES` | `Object.values(TEMPLATES)` | Task 8 (`BodyTab` reads `TEMPLATES`/`hidden`) |
| `CAN_DO` | id → action names **plus** the legacy kind (`play_sound→sound`, `draw_card→draw`) | Task 7/8 |
| `BODY_IDS` | `TEMPLATE_IDS` alias | Task 4 (`config.js` reads `TEMPLATE_IDS`) |

`CAN_DO` carries the legacy kinds because action names alone are not what today's
readers ask for: `core/brain.js` compares `action.kind` (`sound`, `draw`, `move`…)
and `admin/src/reflexEdit.ts` compares `KIND[name]`, while `sim/capabilities.js`
passes action names. With names only, every `play_sound` would be refused by the
brain and `reflexEdit.test.ts` would see `sound` unsupported on every body.
`CAN_DO.tarot` is therefore `['draw_card', 'draw']`. All three exports die with
their readers.

### `draw` and the wand

`tarot.capabilities` = `hear, speak, show`; the wand is
`{ part: 'wand', optional: true }` in `ways[0].needs`;
`triggers: [{ on: 'shake', action: 'draw_card' }]`. A body without `show` is
refused with `… draw_card needs show`.

### `bodyProblem` refusals

Missing capabilities/actions list; action name not `/^[a-z][a-z0-9_]*$/` or
duplicate; every `actionProblem` failure (with `{ poses: POSES, clips: SOUNDS,
has: v => v in VERBS }`); a verb whose `needs` the body lacks; `returns: true`
on anything but a single `draw`; a body with both `pose` and `draw` ("one
screen, one surface"); a trigger naming an action the body lacks; no ways /
unknown source / unknown part; board without firmware and non-board with one;
no preview. All checks run against `any`, so a hand-written row returns a
sentence instead of throwing.

## Verbatim evidence

A throwaway script (not committed) reconstructed the four prompts as
`DEFAULT_PERSONA + '\n\n' + prompts.voice + '\n\n' + prompts.rules.join('\n')`
and compared:

```
toy/none/tarot/pet prompt identical
move/cruise/stop/play_sound/pose/draw_card say identical
move/cruise/stop/play_sound/pose/draw_card args identical   (JSON-equal to TOOLS)
```

All the rule text lives in `prompts.rules`, in today's order — `toy`/`dry-run`:
`[RULES_WHEELS, RULES_SPOKEN, RULE_DURATION]`; `none`: `[RULES_STILL,
RULES_SPOKEN]`; `pet`: `[RULES_PET]`; `tarot`: `[RULES_TAROT]`. No action carries
`rules`: splitting RULES_PET/RULES_TAROT across actions and prompts would make
Task 5's assembler insert the same block twice. Task 5 can rebuild all four
goldens from `prompts` alone; `RULE_DURATION` is built from the same
`MIN_DURATION_MS` import brain.js used, so it cannot drift.

## Tests

`test/bodies.test.js`: 20 tests, every old assertion kept and rewritten to the
new shape (labels are `{en,zh}`, needs are `{part}`, actions are objects), plus
the brief's four new ones (same action names, draw needs a screen, pose+draw
refused, user copy follows its template until it has actions) and three more:
bad/duplicate action names, dangling trigger, resolved body deep-copy, unknown
id falls back to `none`. The one assertion whose *meaning* changed is
`CAN_DO.tarot`: it now expects `['draw_card', 'draw']`; `['draw']` is still
present via the legacy alias. No test was deleted.

```
node --test test/bodies.test.js        20 pass
node --test "test/**/*.test.js"      1766 pass, 0 fail
npm test                             1766 + 185 (vitest) pass
npm run typecheck                    clean
```

## Deviations / concerns

1. **`admin/src/BodyTab.tsx` (one line).** A `Need` is an object per the ruling,
   so `t(NEED[n])` became `t(NEED[n.part])`. Without it `tsc -p admin` fails
   (TS2538) and the card renders nothing. Rendering is identical, so
   `BodyTab.test.tsx` needed no change. This is the only file touched outside
   the brief's two.
2. **`CAN_DO` carries names *and* legacy kinds** — see above; the literal ruling
   (names only) turns the brain's sound handling and `reflexEdit.test.ts` red.
3. **`firmware` stays a string** (`'body.bin'`), not `{ image, sources }`: the
   reference area is explicitly out of this slice, and nothing reads it yet.
   `needs[].why` is likewise deferred to the reference-area slice; only
   `{ part, optional? }` exists.
4. **`bodyById` survives**, though the plan's interface list omits it —
   `admin/src/setup.ts` still calls it and no task removes it.
5. `resolveBody` keeps a template's `triggers` even when a user replaces
   `actions`; a tarot copy that drops `draw_card` is then refused by
   `bodyProblem` (dangling trigger) rather than silently losing the shake. That
   is deliberate but worth a second opinion for Task 4/8.
6. `TEMPLATES` action objects are shared between `toy` and `dry-run` (canonical
   table); nothing mutates them, and `resolveBody` deep-copies. Tests pin the
   copy.

## Round 1 — review fixes

**Status:** complete.

- **`prompts.still` is gone**, from all five templates, the `Prompts` typedef
  and `resolveBody`. It was contradictory dead data (on `toy`/`dry-run`, which
  have wheels) and duplicated `voice` on `none`; "you cannot move" is `none`'s
  `voice`. Task 5 reads `voice` + `rules` only.
- **`resolveBody` drops a trigger whose action the resolved body lacks.** A
  copied tarot body that replaces `draw_card` with pose actions no longer
  carries an unsatisfiable shake and resolves to a body `bodyProblem` accepts.
  `BodyPatch` now accepts `triggers`, and a person's own triggers are filtered
  the same way. `bodyProblem` stays strict for hand-written rows.
- **`bodyProblem` now checks `prompts` and `reply`:** `prompts.voice` must be a
  non-empty string, `prompts.rules` an array of strings, `reply` `tts` or
  `clips`.
- **`bodyProblem` rejects an unknown capability** (`telepathy`) against
  `CAPABILITIES`.
- Tests added: copied tarot sheds/keeps/declares triggers; prompt and reply
  refusals; unknown capability; `reply` on all five (`pet` is the only `clips`);
  exactly `dry-run` is `hidden`; no template still has `prompts.still`.

```
node --test test/bodies.test.js        24 pass
node --test "test/**/*.test.js"      1770 pass, 0 fail
npm run typecheck                    clean
```

Concern: `resolveBody` filters patch triggers as well as template ones, so a
person's trigger naming an action they have not written yet is dropped rather
than refused — consistent with "a copy must resolve to a valid body", but it
means the admin should not use `resolveBody` to validate an in-progress edit.

## Round 2 — review fixes

**Status:** complete.

- `resolveBody` preserves non-array `prompts.rules` values so `bodyProblem`
  refuses them instead of accepting a string split into individual characters.
- Explicitly empty trigger patches remain `triggers: []` and round-trip; absent
  trigger patches still inherit the template. Non-array trigger patches safely
  resolve to no triggers.
- `bodyProblem` refuses triggers with an unknown `on` value.
- Added regression coverage for all four cases, including the `resolveBody`
  entry point and a second resolution of an emptied tarot trigger list.

```
node --test "test/**/*.test.js"   1774 pass, 0 fail
npm run typecheck                 clean
```
