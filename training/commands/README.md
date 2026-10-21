---
license: mit
language:
- en
task_categories:
- text-classification
tags:
- decision-model
- typed-decisions
- robotics
configs:
- config_name: default
  data_files:
  - split: train
    path: data/train.jsonl
  - split: test
    path: data/test.jsonl
---

# Robot simple commands

Speech-recognition transcripts spoken to a small wheeled robot, labelled with the one
simple move to make at once, or `pass` to hand the turn to the LLM. Built for
[bot-reborn](https://github.com/beasaltfish/bot-reborn) as a fast path in front of the LLM.

Rows follow the `{state, questions, gold}` shape of
[LocalLLaMA/typed-decisions](https://huggingface.co/datasets/LocalLLaMA/typed-decisions),
so Unsloth's `FastDecisionModel.build_dataset` takes them unchanged:

```python
from datasets import load_dataset
train = load_dataset("beasaltfish/robot-simple-commands", split="train")
items, report = FastDecisionModel.build_dataset(train, tokenizer, model)
```

Labels: `stop`, `forward`, `backward`, `left`, `right`, `keep_going`, `pass`.

- `state` is the person's line, usually with the robot's last line before it, as at run
  time. Most of those robot lines are unrelated and must be ignored, some on purpose
  mention "stop" or "left"; short replies ("Yes.", "Left.") are labelled by what the
  robot asked.
- `pass` is the largest class on purpose. Taking chat for a command makes the robot
  lurch off; missing a command only costs a slower LLM turn. Its hard negatives cover
  questions about moving, negations, stories, idioms ("I can't stop laughing"), lines
  meant for someone else, and moves too complex or too exact for a fixed action.
- The split is by base phrase: every surface variant of a phrase (lower case, no
  punctuation, a leading "um" or "hey robot") lands on the same side.
- English only. Phrases were distilled with Claude Code; `build.py` and `phrases.py`
  regenerate the files.
