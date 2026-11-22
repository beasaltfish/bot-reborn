# Body plugin example: a servo

A body plugin is a body the brain reads from disk: one directory per body under
`~/.bot-reborn/bodies/` (or `$BOT_REBORN_HOME/bodies/`), with one required file,
`body.json`. Only that file is read today; anything else in the directory is
ignored.

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
appears under **Basic → Advanced → Body**, and its `point` command can be called
from an action of your own.

## The fields

- `id` names the body: lowercase `a-z`, digits, `_` or `-`. It may not be one of
  the five templates (`none`, `pet`, `tarot`, `toy`, `dry-run`), nor a plugin
  that is already loaded. A character that picks this body stores the id in
  `body.template`.
- `label` is the card's name in English and Chinese; both are required.
- `parts` lists the devices the body expects (`esp32`, `sg90`,
  `button-module`, …). The loader requires a non-empty list of names; the
  workbench does not seat them from here yet.
- `resources` is the permission slip: the only pins a command may name. A GPIO
  output also needs `safe`, the value the pin returns to when the body
  disconnects. `i2c` and `adc` resources are refused until the bridge firmware
  defines them.
- `commands` are named IO programs. `timeoutMs` is required (1–5000 ms). `run`
  holds the ops in order, and `$angle` (any other `$name`) is replaced by that
  argument. A `pwm` step may carry a linear `map`; nothing else is computed. A
  command that ends in a read must say `"returns": true`, and then it has
  exactly one read, last.

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

## What runs today

- The loader, the admin card, and an action that calls a command all work.
- On the workbench, `pin.write` and `pin.read` answer. `pwm`, `i2c.*` and
  `adc.read` refuse with `unavailable`, so this example loads and appears, but
  `point` does not move the servo. A `pin.write` step is what the bench
  exercises today.
- No real board runs plugins. The ESP32 firmware speaks protocol 2 and has no
  `cmd`/`result`; the brain rejects a plugin body over it with `bridge`. The
  bridge firmware (protocol 3) is not written yet, so nothing here changes what
  a flashed board can do.

A refused plugin is one line in the brain's log at startup:
`plugin <directory>: <what is wrong>`.
