---
license: apache-2.0
language:
- en
base_model:
- Qwen/Qwen3.5-0.8B
datasets:
- beasaltfish/robot-simple-commands
tags:
- decision-model
- typed-decisions
- robotics
- unsloth
---

# robot-simple-commands-qwen3.5-0.8b

A small decision model that reads what a person just said to a wheeled robot and picks
one simple move to make at once, or `pass` to hand the turn to the LLM. It is the fast
path in front of the LLM in [bot-reborn](https://github.com/beasaltfish/bot-reborn):
"stop" should stop the robot now, not after a full LLM round trip.

GGUF: [robot-simple-commands-qwen3.5-0.8b-GGUF](https://huggingface.co/beasaltfish/robot-simple-commands-qwen3.5-0.8b-GGUF)

## What it does

Input is the robot's last line (if any) and a speech-recognition transcript of the person:

```
Robot said: "I'm here."
Person said: "hey bear right"
```

Output is one action:

```json
{"action": "right"}
```

Actions: `stop`, `forward`, `backward`, `left`, `right`, `keep_going`, `pass`.

| Person said | Action |
|---|---|
| um nudge forward. | `forward` |
| Lean left. | `left` |
| Turn the TV on. | `pass` |
| okay turn around | `pass` (more than one simple move) |
| i turned left at the light today | `pass` (a story, not a command) |
| Do you ever get tired of driving? | `pass` (a question) |

The prompt follows the `{state, questions}` shape of
[LocalLLaMA/typed-decisions](https://huggingface.co/datasets/LocalLLaMA/typed-decisions);
copy the `questions` field from any row of the dataset.

## Design choice: when unsure, pass

`pass` is the largest class on purpose. Taking chat for a command makes the robot lurch
off; missing a command only costs a slower LLM turn. Hard negatives cover questions
about moving, negations, stories, idioms ("I can't stop laughing"), lines meant for
someone else, and moves too complex or too exact (distances, angles) for a fixed action.

## Training

- Data: [beasaltfish/robot-simple-commands](https://huggingface.co/datasets/beasaltfish/robot-simple-commands),
  490 train / 164 test rows, split by base phrase so no phrase variant leaks into test.
- Method: LoRA fine-tune with Unsloth `FastDecisionModel`, merged to 16-bit.
- 60 steps at effective batch 32 (8 × 4 gradient accumulation), about 4 epochs;
  LoRA rank 16, learning rate 2e-4 with cosine decay.
- Test accuracy: 86.6% (142 / 164).

## Limitations

- English only, phrases distilled with Claude Code. Real speech-recognition errors and unusual
  phrasings outside the dataset may be misread.
- Fixed actions only: no distances, angles or sequences; those go to the LLM via `pass`.
- Made for one hobby robot. Do not use it where a wrong move could hurt someone.
