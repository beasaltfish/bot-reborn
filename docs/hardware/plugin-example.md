# Body plugin example: a servo

A body plugin is a body the brain reads from disk: one directory per body under
`~/.bot-reborn/bodies/` (or `$BOT_REBORN_HOME/bodies/`), with one required file,
`body.json`. Only that file is read today; anything else in the directory is
ignored.

**A plugin is simulator-only for now.** The workbench answers `pin.write` and
`pin.read`; `pwm` is expanded by the brain but has no pulse model on the bench
yet. On the firmware side the protocol 3 contract exists and is host-tested:
`body_logic` parses `cmd` and writes `result`, and `bridge_io` keeps the pin
allowlist and restores each output's `safe` (`test_proto`, `test_bridge_io`,
`test_bridge_loop`). What is missing is the ESP-IDF bridge app that carries
those calls to `driver/gpio.h`, so the shipped body firmware still speaks
protocol 2 and the brain turns a plugin body away from it with `bridge`.

## Install

Create `~/.bot-reborn/bodies/my-servo/body.json`:

```json
{
  "id": "my-servo",
  "label": { "en": "Servo arm", "zh": "舵机摆臂" },
  "parts": ["esp32", "sg90"],
  "resources": [
    { "kind": "gpio", "name": "sig", "gpio": 5, "direction": "output", "safe": 0 }
  ],
  "commands": [
    {
      "name": "point",
      "args": {
        "type": "object",
        "required": ["angle"],
        "properties": { "angle": { "type": "integer", "minimum": 0, "maximum": 180 } }
      },
      "timeoutMs": 500,
      "run": [{
        "op": "pwm",
        "args": { "pin": "sig", "value": "$angle", "map": { "from": [0, 180], "to": [500, 2400] } }
      }]
    }
  ]
}
```

Then restart the brain: plugins are read once, at startup. The `my-servo` card
appears in the **Body** tab, and its `point` command can be called
from an action of your own.

## The fields

- `id` names the body: it must start with a lowercase letter, then lowercase
  `a-z`, digits, `_` or `-`. It may not be one of the five templates (`none`,
  `pet`, `tarot`, `toy`, `dry-run`), nor a plugin that is already loaded. A
  character that picks this body stores the id in `body.template`.
- `label` is the card's name in English and Chinese; both are required.
- `parts` lists the devices the body expects (`esp32`, `sg90`,
  `button-module`, …). The loader requires a non-empty list of names; the
  workbench does not seat them from here yet.
- `resources` is the permission slip: the only pins a command may name. Only
  `kind: "gpio"` is runnable. `direction` is `input` or `output`; an output also
  needs `safe`, the level (0 or 1) the pin returns to when the body disconnects.
  `i2c` and `adc` resources are refused **at load**: the loader says
  `resource "x" is not a gpio pin`, because only gpio is runnable here and their
  contract is not settled.
- `commands` are named IO programs. `args` is the schema of the values the
  caller supplies, `timeoutMs` is required (1–5000 ms), and `run` holds the ops
  in order. `$angle` (any other `$name`) is replaced by that argument, and the
  substituted value is checked against `args` before any op is built. A `pwm`
  step may carry one linear `map`, whose output is clamped to its `to` range. A
  command that ends in a read must also say `"returns": true`, and then it has
  exactly one read, last — that value is what the model reads back.

### The nine ops

| op | args | on | notes |
| --- | --- | --- | --- |
| `pin.write` | `pin`, `level` | a gpio output | `level` is `0`, `1`, or `$argument` resolving to one of those. The op carries the output's `safe`. |
| `pin.read` | `pin` | a gpio input | one level, `0` or `1`. |
| `pwm` | `pin`, `value`, optional `map: { from: [a, b], to: [c, d] }` | a gpio output | `value` is a finite number or `$argument`; with a map the result is `us`, clamped to the `to` range. The bench answers `unavailable` — no pulse model yet. |
| `i2c.write` | — | an `i2c` resource | refused at load: the i2c contract is not settled. |
| `i2c.read` | — | an `i2c` resource | refused at load, same reason. |
| `adc.read` | — | an `adc` resource | refused at load, same reason. |
| `device.sample` | `device` | a `device` resource with a known driver | returns the driver's telemetry; `bme280`, `hc-sr04` and `sonar-servo` today. A real board needs the bridge's driver. |
| `device.measure` | `device` | an input or composed device | triggers a reading; the sonar, and the composed `sonar-servo`/`bme280-display` refresh. A behavior can call it on a timer. |
| `device.write` | `device`, driver payload | an output device | writes a motor command or a strip frame; `tb6612fng` and `ws2812` today. |

A `pin` is the resource's `name`, never a `$argument`: the target is a static
reference, checked once at load, not a value the model chooses.

An action calls a command by name:

```json
[{
  "name": "point_at",
  "label": { "en": "Point the arm", "zh": "转动摆臂" },
  "say": "Point the servo arm at an angle in degrees.",
  "args": {
    "type": "object", "required": ["angle"],
    "properties": { "angle": { "type": "integer", "minimum": 0, "maximum": 180 } }
  },
  "run": [{ "command": "point", "args": { "angle": "$angle" } }]
}]
```

Paste it into the body's **Actions** box. A plugin adds commands, not new
abilities: it hears and speaks like a bare board, and carries no firmware of its
own.

To read a value back, the command ends in a read and says `"returns": true`, and
the action that calls it says `returns: true` too:

```json
{
  "name": "is_pressed",
  "args": { "type": "object", "properties": {} },
  "timeoutMs": 100,
  "returns": true,
  "run": [{ "op": "pin.read", "args": { "pin": "button" } }]
}
```

with the button declared as an input:

```json
{ "kind": "gpio", "name": "button", "gpio": 4, "direction": "input" }
```

An action `{ "run": [{ "command": "is_pressed" }], "returns": true }` then gets
`0` or `1` back as its tool result, and the model is asked again with it — the
same path a tarot body's `draw_card` takes. A read that fails (a timeout, a body
that refuses the op) is text the model reads, not a failed turn.

## What runs today

- The loader, the admin card, an action that writes a pin, and an action that
  reads one all work — the read only on the workbench, which is the only body
  that answers `cmd` today.
- On the workbench, `pin.write` and `pin.read` answer. `pwm` is expanded by the
  brain (a map included) but the bench has no pulse model, so it answers
  `unavailable`; this example loads and appears, and `point` does not move the
  servo. `i2c.*` and `adc.read` never get that far: a manifest that declares an
  `i2c`/`adc` resource is refused at load.
- No shipped board runs plugins. The C side of protocol 3 (parse `cmd`, write
  `result`, the pin allowlist and `safe`) is host-tested, but the ESP-IDF bridge
  app that uses it is not built; the body firmware still speaks protocol 2 and
  the brain rejects a plugin body over it with `bridge`.

A refused plugin is one line in the brain's log at startup:
`plugin <directory>: <what is wrong>`.

## Modules

The repository also ships modules: a plugin manifest plus the parts and links
that make its pins true, in `modules/<id>/module.json`. `examples`, `wiring` and
`note` are optional fields of any manifest: an install copies them into
`bodies/<id>/body.json`, so an installed body still knows the bench it came
from, and the workbench lists it as a project. Install one from the
admin under **Body → Modules** — no restart, the body is registered
as it installs. Then open `/sim/`, pick the module's project (the LED module is
in the **Demo builds** group), and wire it as the steps say; the project starts
from the Audio only bench and adds only the module's own parts. Plug in USB to
pair, say "turn on the light", and the bench LED lights. Only the LED module
ships today, and like a hand-written plugin it runs on the bench only.

The example actions are offered at install, never written into a character
without that confirmation.
